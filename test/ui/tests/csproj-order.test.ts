import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { CONFIG_PAGE_MODULES } from '../src/jsModules.js';
import { REPO_ROOT } from '../src/loader.js';

describe('loader module order matches the .csproj compose order', () => {
  test('same files, same sequence', () => {
    const csproj = readFileSync(
      join(REPO_ROOT, 'Jellyfin.Plugin.Watchback', 'Jellyfin.Plugin.Watchback.csproj'),
      'utf8',
    );
    const ordered = [...csproj.matchAll(/<JsModule Include="PluginPages\\js\\([^"]+)"\/>/g)].map((m) => m[1]);
    expect(ordered.length).toBeGreaterThan(0);
    expect(CONFIG_PAGE_MODULES).toEqual(ordered);
  });

  test('every composed file exists on disk', () => {
    const dir = join(REPO_ROOT, 'Jellyfin.Plugin.Watchback', 'PluginPages', 'js');
    void dirname(fileURLToPath(import.meta.url));
    for (const f of CONFIG_PAGE_MODULES) {
      expect(readFileSync(join(dir, f), 'utf8').length).toBeGreaterThan(0);
    }
  });

  test('the demo loads the shared UI runtime before the rewind', () => {
    const demo = readFileSync(join(REPO_ROOT, 'docs', 'index.html'), 'utf8');
    const parsedDemo = new DOMParser().parseFromString(demo, 'text/html');
    const scripts = Array.from(parsedDemo.querySelectorAll('script[src]'), script => script.getAttribute('src')!.split('?')[0]);
    const runtime = scripts.indexOf('js/UiPrimitives.js');
    const discovery = scripts.indexOf('js/yearly-rewind.js');
    expect(runtime).toBeGreaterThanOrEqual(0);
    expect(discovery).toBeGreaterThan(runtime);
  });

  // ComposeConfigPage.cs enforces these invariants at build time instead of a
  // literal list: Shared.js first (helpers exist before any tab uses them),
  // Main.js last (it closes the IIFE and wires routing), Codecs before
  // CodecsExplorer. Pin the same rules here so a loader reorder that still
  // matches a drifted csproj cannot slip past both guards.
  test('order satisfies the ComposeConfigPage invariants', () => {
    expect(CONFIG_PAGE_MODULES[0]).toBe('Shared.js');
    expect(CONFIG_PAGE_MODULES[CONFIG_PAGE_MODULES.length - 1]).toBe('Main.js');
  });

  // The build invariants live in ComposeConfigPage.cs; if that file stops
  // naming them, the guard above is silently checking rules nothing enforces.
  test('ComposeConfigPage.cs still declares the Shared-first / Main-last rules', () => {
    const compose = readFileSync(
      join(REPO_ROOT, 'Jellyfin.Plugin.Watchback', 'BuildTasks', 'ComposeConfigPage.cs'),
      'utf8',
    );
    expect(compose).toContain('Shared.js');
    expect(compose).toContain('Main.js');
  });
});

describe('Vitest MSBuild integration', () => {
  function vitestExec() {
    const project = new DOMParser().parseFromString(readFileSync(
      join(REPO_ROOT, 'Jellyfin.Plugin.Watchback.Tests', 'Jellyfin.Plugin.Watchback.Tests.csproj'),
      'utf8',
    ), 'application/xml');
    const exec = project.querySelector('Target[Name="VitestUi"] > Exec');
    expect(exec).not.toBeNull();
    return exec!;
  }

  test('successful test names containing error are not parsed as build failures', () => {
    expect(vitestExec().getAttribute('IgnoreStandardErrorWarningFormat')).toBe('true');
  });

  test('test and coverage failure exit codes remain fatal', () => {
    const exec = vitestExec();
    expect(exec.getAttribute('Command')).toContain('run test:coverage');
    expect(exec.getAttribute('IgnoreExitCode')).not.toBe('true');
    expect([null, 'false', 'ErrorAndStop']).toContain(exec.getAttribute('ContinueOnError'));
  });
});


describe('demo language selection', () => {
  test.each([
    {languages: ['de-DE'], language: 'de-DE', search: '', expected: 'de'},
    {languages: ['fr-CA', 'en-US'], language: 'fr-CA', search: '', expected: 'fr'},
    {languages: ['nl-NL', 'sv-SE'], language: 'nl-NL', search: '', expected: 'sv'},
    {languages: ['zh-Hant-TW'], language: 'zh-Hant-TW', search: '', expected: 'zh'},
    {languages: ['nl-NL'], language: 'nl-NL', search: '', expected: 'en'},
    {languages: [], language: '', search: '', expected: 'en'},
    {languages: [], language: 'pt-BR', search: '', expected: 'pt'},
    {languages: ['de-DE'], language: 'de-DE', search: '?lang=en', expected: 'en'},
    {languages: ['en-US'], language: 'en-US', search: '?lang=FR-ca', expected: 'fr'},
    {languages: ['de-DE'], language: 'de-DE', search: '?lang=unknown', expected: 'en'},
  ])('selects $expected for browser $languages and query "$search"', ({languages, language, search, expected}) => {
    const source = readFileSync(join(REPO_ROOT, 'docs/mock/mock-data.js'), 'utf8');
    const doc = {documentElement: {lang: 'en'}};
    const run = new Function('navigator', 'location', 'document', 'window', source + '; return demoLanguage;');
    expect(run({languages, language}, {search}, doc, {})).toBe(expected);
    expect(doc.documentElement.lang).toBe(expected);
  });
});
