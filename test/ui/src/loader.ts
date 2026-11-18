import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInstrumenter } from 'istanbul-lib-instrument';
const NATIVE_TABS_MODULE = 'native-tabs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..', '..', '..');
const CONFIG_JS_DIR = join(REPO_ROOT, 'Jellyfin.Plugin.Watchback', 'PluginPages', 'js');
const DISCOVERY_DIR = join(REPO_ROOT, 'Jellyfin.Plugin.Watchback', 'js');

export type UiBridge = Record<string, any>;

// Local behavioral runs can explicitly disable instrumentation and report writes; the pipeline default is unchanged.
const instrumenter = process.env.JFW_UI_NO_COVERAGE === '1' ? null : createInstrumenter({ esModules: false, produceSourceMap: false });

// Instruments for per-file coverage, then strips strict mode so the bundle
// evaluates exactly like the shipped IIFE scope. The optional label overrides
// the coverage key: the discovery guard test and the unwrapped behavioral
// bundle are different code for the same file, so they must report under
// different keys or the merge collides on mismatched statement maps.
function prepared(absPath: string, label?: string): string {
  const rel = label ?? relative(REPO_ROOT, absPath).replaceAll('\\', '/');
  const src = readFileSync(absPath, 'utf8');
  return (instrumenter ? instrumenter.instrumentSync(src, rel) : src).replace(/^[ \t]*'use strict';[ \t]*\r?$/m, '');
}

// The shipped client scripts are self-running IIFEs, so their inner helpers are
// unreachable from the shared scope. For behavioral tests we unwrap the IIFE at
// the source level (before instrumentation) so the helpers become top-level
// declarations the bridge can expose. The listed bootstrap lines are dropped so
// evaluation only declares - tests drive each function explicitly, and no stray
// timers or listeners leak into other specs. The prod file is never touched;
// only this in-memory copy is reshaped.
function preparedUnwrapped(absPath: string, drops: Array<[RegExp, string]>): string {
  const rel = relative(REPO_ROOT, absPath).replaceAll('\\', '/');
  const name = absPath.split(/[\\/]/).pop();
  let src = readFileSync(absPath, 'utf8');
  const open = src.indexOf('(function () {');
  if (open === -1) {
    throw new Error(`${name} IIFE markers not found - prod shape changed?`);
  }
  src = src.slice(0, open) + src.slice(open + '(function () {'.length);
  const close = src.lastIndexOf('})();');
  if (close === -1) {
    throw new Error(`${name} IIFE markers not found - prod shape changed?`);
  }
  src = src.slice(0, close) + src.slice(close + '})();'.length);
  for (const [re, what] of drops) {
    if (!re.test(src)) {
      throw new Error(`${name} ${what} not found - prod shape changed?`);
    }
    src = src.replace(re, (m) => '\n'.repeat(m.split('\n').length - 1));
  }
  return (instrumenter ? instrumenter.instrumentSync(src, rel) : src).replace(/^[ \t]*'use strict';[ \t]*\r?$/m, '');
}

const NATIVE_TABS_DROPS: Array<[RegExp, string]> = [
  [/if \(window\.WatchbackTabs\) \{\s*return;\s*}/, 'double-load guard'],
  [/^[ \t]*window\.WatchbackTabs = \{[\s\S]*?};[ \t]*\r?$/m, 'registry export'],
  [/^[ \t]*init\(\);[ \t]*\r?$/m, 'init call'],
];


// The appended return is test-only wiring and never touches production files.
// A renamed helper fails loudly here instead of silently untesting code.
function evaluate(sources: string[], expected: string[]): UiBridge {
  // The shipped scripts are classic (non-module) scripts that must evaluate in
  // one shared function scope exactly as the browser IIFE does; new Function is
  // the test harness boundary that reproduces that scope. Input is our own
  // repo sources, never user data. typeof is required in the generated picker
  // because an unknown name would be an undeclared identifier (a bare === would
  // ReferenceError); the check below reads a property, so it compares directly.
  const pick = expected.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  const run = new Function(`${sources.join('\n')}\nreturn { ${pick} };`) as () => UiBridge; // NOSONAR intentional harness eval of trusted repo sources
  const bridge = run();
  const missing = expected.filter((n) => bridge[n] === undefined);
  if (missing.length > 0) {
    throw new Error(`UI test bridge is missing helpers (renamed in prod?): ${missing.join(', ')}`);
  }
  return bridge;
}

export function loadClientLifecycleBundle(): void {
  evaluate([prepared(join(DISCOVERY_DIR, 'client-lifecycle.js'))], []);
}

const NATIVE_TABS_EXPECTED = [
  'entries', 'isOnHomePage', 'findEntry', 'isActiveTabContainer', 'getTabsRoot',
  'isOwnSlot', 'slotIndex', 'highestForeignIndex', 'relabel', 'createReservedSlot',
  'alignSlots', 'getHeaderButtonTray', 'getOrCreateGroup', 'removeGroupIfEmpty',
  'isTabButtonVisible', 'removeHeaderLink', 'createHeaderLink', 'ensureDiscoverable',
  'hashParam', 'homeRoute', 'watchUserTabChanges', 'clearStraySelection', 'syncSelectedTabHash', 'syncActiveEntry',
  'repairRemovedTabSelection',
  'handleRouteNavigation',
  'noteTabStripInput', 'deepLinkHash', 'syncDeepLink', 'applyPendingFocus',
  'ensureInjected', 'scheduleInject', 'register', 'unregister', 'updateTitle', 'focus', 'init',
];

// Behavioral surface of the native Home tab registry: inner helpers unwrapped
// from the shipped IIFE. Fresh scope per call so entries and deep-link state
// never bleed across specs.
export function freshNativeTabsHelpers(): UiBridge {
  return evaluate(
    [preparedUnwrapped(join(DISCOVERY_DIR, NATIVE_TABS_MODULE), NATIVE_TABS_DROPS)],
    NATIVE_TABS_EXPECTED,
  );
}

let nativeTabsBridge: UiBridge | null = null;

export function loadNativeTabsHelpers(): UiBridge {
  if (!nativeTabsBridge) {
    nativeTabsBridge = freshNativeTabsHelpers();
  }
  return nativeTabsBridge;
}

// The shipped IIFE, instrumented under a throwaway key so its guard-bundle
// coverage never counts toward the product gate. Used to prove the double-load
// guard against the real source shape.
export function loadNativeTabsBundle(): void {
  evaluate([prepared(join(DISCOVERY_DIR, NATIVE_TABS_MODULE), 'js/native-tabs.guard.js')], []);
}

export function saveCoverage(): void {
  if (!instrumenter) return;
  // Each isolated worker writes a unique report because thread workers share the process ID.
  const g = globalThis as any;
  const cov = g.__coverage__;
  if (!cov) return;
  const dir = join(REPO_ROOT, 'test', 'ui', 'coverage', 'tmp');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `coverage-${process.pid}-${randomUUID()}.json`), JSON.stringify(cov));
}

export function loadYearlyRewindBundle(): void {
  evaluate([prepared(join(DISCOVERY_DIR, 'yearly-rewind.js'))], []);
}

export function loadSettingsBundle(): UiBridge {
  return evaluate(['Shared.js', 'UiPrimitives.js', 'Settings.js', 'Main.js'].map(name => prepared(join(CONFIG_JS_DIR, name))),
    ['loadSettings', 'renderSettings', 'buildSettingsPayload', 'saveSettings', 'updateSettingsState', 'validateRewindDates']);
}
