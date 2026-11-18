import { type Page, expect } from '@playwright/test';
import { loadAuth } from '../setup/api-client.ts';

interface SeedArgs {
  base: string;
  token: string;
  userId: string;
  serverId: string;
}

/**
 * Seeds auth state into localStorage before page scripts execute.
 * Using LastConnectionMode = 2 (Manual) ensures the web client connects
 * directly via ManualAddress.
 */
function seedCredentials(a: SeedArgs): void {
  localStorage.setItem(
      'jellyfin_credentials',
      JSON.stringify({
        Servers: [
          {
            Id: a.serverId,
            Name: 'jfw-e2e',
            ManualAddress: a.base,
            LocalAddress: a.base,
            RemoteAddress: a.base,
            AccessToken: a.token,
            UserId: a.userId,
            DateLastAccessed: Date.now(),
            LastConnectionMode: 2,
            IsLocalServer: true,
          },
        ],
      }),
  );
  localStorage.setItem('enableAutoLogin', 'true');
}

/**
 * Pre-authenticates the session and opens the plugin configuration page.
 */
export async function openDashboard(page: Page): Promise<void> {
  const auth = loadAuth();
  const base = auth.baseUrl.replace(/\/$/, '');

  const infoRes = await page.request.get(`${base}/System/Info/Public`);
  const { Id: serverId } = (await infoRes.json()) as { Id: string };

  const seedArg: SeedArgs = {
    base,
    token: auth.token,
    userId: auth.userId,
    serverId,
  };

  await page.addInitScript(seedCredentials, seedArg);

  const configUrl = `${base}/web/index.html#!/configurationpage?name=${encodeURIComponent('jellyfin-watchback')}`;
  await page.goto(configUrl);

  const tabBar = page.locator('#cfgYearlyRewindEnabled');

  try {
    await expect(tabBar).toBeVisible({ timeout: 12_000 });
  } catch {
    await page.evaluate((url) => {
      window.location.hash = new URL(url).hash;
    }, configUrl);

    await expect(tabBar).toBeVisible({ timeout: 15_000 });
  }
}
