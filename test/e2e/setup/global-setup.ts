/** * Playwright global setup - runs once before any test, after scripts/run.sh has * brought the stack up and generated the fake media. */
import { request as pwRequest, type FullConfig } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { authHeader, runLibraryScan } from './api-client.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.JELLYFIN_URL ?? 'http://localhost:8098';
const ADMIN_USER = process.env.JELLYFIN_ADMIN_USER ?? 'e2eadmin';
const ADMIN_PASS = process.env.JELLYFIN_ADMIN_PASS ?? 'E2ePassw0rd!';
const NORMAL_USER = process.env.JELLYFIN_USER ?? 'e2euser';
const NORMAL_PASS = process.env.JELLYFIN_USER_PASS ?? 'E2eUserPass1!';

async function globalSetup(_config: FullConfig): Promise<void> {
  const ctx = await pwRequest.newContext({ baseURL: BASE_URL });

  // Small helper: run a startup step, log its status, and don't hard-fail on a 4xx (a re-used server returns those) - but DO surface the status so a real wizard failure is visible in CI instead of silently swallowed.
  const step = async (label: string, fn: () => Promise<{ status: () => number; text: () => Promise<string> }>) => {
    try {
      const res = await fn();
      const s = res.status();
      // eslint-disable-next-line no-console
      console.log(`[global-setup] ${label} -> ${s}`);
      if (s >= 500) {
        // eslint-disable-next-line no-console
        console.log(`[global-setup]   body: ${(await res.text()).slice(0, 300)}`);
      }
      return s;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`[global-setup] ${label} -> threw: ${(e as Error).message}`);
      return -1;
    }
  };

  // --- 1. startup wizard --------------------------------------------------- Source-verified JF12 flow: POST /Startup/User does NOT create a user - it configures the pre-existing default admin (renames it + sets its password).

  // GET forces _userManager.InitializeAsync() so the default user exists, and
  // tells us its current name.
  const firstUserRes = await ctx.get('/Startup/User');
  // eslint-disable-next-line no-console
  console.log(`[global-setup] GET Startup/User -> ${firstUserRes.status()}`);

  await step('Startup/Configuration', () =>
    ctx.post('/Startup/Configuration', {
      headers: { 'Content-Type': 'application/json' },
      data: {
        UICulture: 'en-US',
        MetadataCountryCode: 'US',
        PreferredMetadataLanguage: 'en',
        ServerName: 'jfw-e2e',
      },
    }),
  );

  // Configure the first user. 204 = success on a fresh container.
  const userRes = await ctx.post('/Startup/User', {
    headers: { 'Content-Type': 'application/json' },
    data: { Name: ADMIN_USER, Password: ADMIN_PASS },
  });
  // eslint-disable-next-line no-console
  console.log(`[global-setup] POST Startup/User -> ${userRes.status()}`);
  const wizardAlreadyDone = userRes.status() === 401 || userRes.status() === 403;
  if (userRes.status() !== 204 && !userRes.ok() && !wizardAlreadyDone) {
    throw new Error(`Startup/User failed: ${userRes.status()} ${await userRes.text()}`);
  }
  if (wizardAlreadyDone) {
    // eslint-disable-next-line no-console
    console.log('[global-setup] wizard already complete (reused container) - skipping to auth');
  }

  if (!wizardAlreadyDone) {
    // EnableAutomaticPortMapping was removed - send only EnableRemoteAccess.
    await step('Startup/RemoteAccess', () =>
      ctx.post('/Startup/RemoteAccess', {
        headers: { 'Content-Type': 'application/json' },
        data: { EnableRemoteAccess: true },
      }),
    );

    // Finish the wizard LAST - after this, Startup/* stop accepting anon calls.
    await step('Startup/Complete', () => ctx.post('/Startup/Complete'));
  }

  // --- 2. authenticate (retry: Startup/Complete may need a moment) ---------
  const authenticate = () =>
    ctx.post('/Users/AuthenticateByName', {
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      data: { Username: ADMIN_USER, Pw: ADMIN_PASS },
    });

  const authRes = await authenticateWithRetry(authenticate, 5);
  if (!authRes.ok()) {
    // Dump the current user list to help diagnose (which users actually exist?).
    const usersDump = await ctx
      .get('/Users/Public')
      .then((r) => r.text())
      .catch(() => '<none>');
    throw new Error(
      `AuthenticateByName failed: ${authRes.status()} ${await authRes.text()}\n` +
        `Public users on server: ${usersDump.slice(0, 500)}`,
    );
  }
  const auth = (await authRes.json()) as { AccessToken: string; User: { Id: string; Name: string } };
  const token = auth.AccessToken;
  const userId = auth.User.Id;

  // Authenticated context for the remaining setup calls.
  const admin = await pwRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Authorization: authHeader(token), Accept: 'application/json' },
  });

  // --- 3. create libraries -------------------------------------------------
  await ensureLibrary(admin, 'Movies', 'movies', '/media/Movies');
  await ensureLibrary(admin, 'Shows', 'tvshows', '/media/Shows');

  // --- 4. scan and wait ----------------------------------------------------
  await runLibraryScan(admin);

  const normalUser = await provisionNormalUser(admin, ctx, {userName: NORMAL_USER, password: NORMAL_PASS});
  if (!normalUser) throw new Error('The non-admin fixture must be provisioned.');
  writeFileSync(join(__dirname, 'auth.json'), JSON.stringify({baseUrl: BASE_URL, token, userId, userName: ADMIN_USER, normalUser}));
  const plugins = await (await admin.get('/Plugins')).json();
  if (!plugins.some((plugin: any) => plugin.Id.replaceAll('-', '') === '16f5f0be353b48c4a5f1d41d9b08b264' && plugin.Status === 'Active')) throw new Error('Watchback was not loaded as an active plugin.');
  await ctx.dispose();
  await admin.dispose();
}

type ProvisionCtx = Awaited<ReturnType<typeof pwRequest.newContext>>;
type AuthResponse = Awaited<ReturnType<ProvisionCtx['post']>>;

/** Resolve after `ms`, without an inline Promise executor at the call site. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Authenticate, retrying up to `remaining` more times with a 2s backoff while
 * the response is not ok. The retry is intentionally sequential (the server may
 * need a moment after Startup/Complete); expressing it as bounded recursion
 * keeps that ordering without an await-in-loop.
 */
async function authenticateWithRetry(
  authenticate: () => Promise<AuthResponse>,
  remaining: number,
): Promise<AuthResponse> {
  const res = await authenticate();
  if (res.ok() || remaining <= 0) {
    return res;
  }
  // eslint-disable-next-line no-console
  console.log(`[global-setup] auth attempt -> ${res.status()}; retrying (${remaining} left)...`);
  await delay(2000);
  return authenticateWithRetry(authenticate, remaining - 1);
}

/**
 * Create (or reuse) a non-admin test user and authenticate as it. Returns the captured token/userId, or null
 * if provisioning failed. The caller fails the setup when the normal user is missing.
 */
async function provisionNormalUser(
  admin: ProvisionCtx,
  ctx: ProvisionCtx,
  opts: { userName: string; password: string },
): Promise<{ token: string; userId: string; userName: string } | null> {
  const { userName, password } = opts;
  try {
    const created = await admin.post('/Users/New', {
      headers: { 'Content-Type': 'application/json' },
      data: { Name: userName, Password: password },
    });
    // On a warm/reused container the user already exists and Users/New returns a 4xx (e.g. 400 "user already exists").
    const createdOk = created.ok();
    const alreadyExists = !createdOk && created.status() >= 400 && created.status() < 500;
    if (!createdOk && !alreadyExists) {
      // eslint-disable-next-line no-console
      console.log(`[global-setup] Users/New (${userName}) -> ${created.status()} (unexpected; dependent tests will skip)`);
      return null;
    }
    // eslint-disable-next-line no-console
    console.log(`[global-setup] Users/New (${userName}) -> ${created.status()} (${createdOk ? 'created' : 'already exists - authenticating existing user'})`);
    const nAuth = await ctx.post('/Users/AuthenticateByName', {
      headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
      data: { Username: userName, Pw: password },
    });
    if (!nAuth.ok()) {
      // Could not authenticate - do NOT report success silently. Log the rejection so a broken provisioning path is visible; dependent tests skip (return null) rather than run against a half-provisioned user.
      console.log(
        `[global-setup] non-admin auth failed for ${userName} (Users/New was ${created.status()}): ` +
          `${nAuth.status()} ${(await nAuth.text()).slice(0, 200)} (dependent tests will skip)`,
      );
      return null;
    }
    const nj = (await nAuth.json()) as { AccessToken: string; User: { Id: string } };
    // eslint-disable-next-line no-console
    console.log(`[global-setup] non-admin user ${userName} ready (${nj.User.Id})`);

    return { token: nj.AccessToken, userId: nj.User.Id, userName };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.log(`[global-setup] non-admin user provisioning failed (${userName}): ${(e as Error).message}`);
    return null;
  }
}

async function ensureLibrary(
  admin: Awaited<ReturnType<typeof pwRequest.newContext>>,
  name: string,
  collectionType: string,
  path: string,
): Promise<void> {
  const existing = await admin.get('/Library/VirtualFolders');
  if (existing.ok()) {
    const folders = (await existing.json()) as Array<{ Name: string }>;
    if (folders.some((f) => f.Name === name)) return; // already created (re-run)
  }
  const qs = new URLSearchParams({ name, collectionType, refreshLibrary: 'false' });
  qs.append('paths', path);
  const res = await admin.post(`/Library/VirtualFolders?${qs.toString()}`, {
    headers: { 'Content-Type': 'application/json' },
    data: { LibraryOptions: { PathInfos: [{ Path: path }] } },
  });
  if (!res.ok() && res.status() !== 204) {
    throw new Error(`Create library "${name}" failed: ${res.status()} ${await res.text()}`);
  }
}

export default globalSetup;
