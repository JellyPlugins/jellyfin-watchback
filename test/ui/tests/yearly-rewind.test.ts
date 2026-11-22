import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { loadYearlyRewindBundle, saveCoverage } from '../src/loader.js';
import { todayMonthDay, visibleRewindWindow } from '../../e2e/setup/yearly-rewind.js';

afterAll(saveCoverage);
let mount: (panel: HTMLElement) => void;
let root: HTMLElement;
let enabled = true;
let visible = true;
let id = 'snapshot-a';
let season = '2026-12-15T00:00:00Z';
let user = 'a';
let api: any;
let extra: Record<string, any> = {};
const snapshotAt = () => id === 'snapshot-b' ? '2027-12-15T00:00:00Z' : '2026-12-15T00:00:00Z';
const periodStart = () => id === 'snapshot-b' ? '2026-12-15T00:00:00Z' : '2025-12-15T00:00:00Z';
const report = () => ({ SnapshotId: id, PeriodStartUtc: periodStart(), SnapshotAtUtc: snapshotAt(), TimeZoneId: 'UTC',
 FullTimePerGenre: true, DataState: 'Ready', ActiveDays: 2, FirstItemId: '12345678123412341234123456781234',
 Items: [{ ItemId: '12345678123412341234123456781234', Name: '<script>bad</script>', ItemType: 'Movie', ActiveSeconds: 3600, Genres: ['Drama'] },
 {ItemId: 'episode', Name: 'Episode', ItemType: 'Episode', SeriesId: 'series', SeriesName: 'Series', ActiveSeconds: 600, Genres: [] }],
 Months: [{ StartUtc: periodStart(), EndUtc: id === 'snapshot-b' ? '2027-01-15T00:00:00Z' : '2026-01-15T00:00:00Z', ActiveSeconds: 4200 }], ...extra });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
 vi.useFakeTimers();
 enabled = true; visible = true; id = 'snapshot-a'; user = 'a'; extra = {};
 season = '2026-12-15T00:00:00Z';
 root = document.createElement('section'); document.body.replaceChildren(root);
 document.documentElement.lang = 'en';
 delete (window as any).WatchbackRewind;
 (window as any).WatchbackTabs = { register: vi.fn((_id, _title, callback, _icon, activate) => { mount = activate; callback(root); activate(root); }), unregister: vi.fn(), updateTitle: vi.fn() };
 api = { getCurrentUserId: () => user, accessToken: () => user ? 'token-' + user : '', serverAddress: () => 'https://test.example', getUrl: (path: string) => { if (!path) throw new Error('Url name cannot be empty'); return path; },
 ajax: vi.fn(({ url }) => Promise.resolve(url.startsWith('/Items/') ? {Id: '12345678123412341234123456781234'} : url.includes('Translations') ? {} : url.includes('Status') ? { Enabled: enabled, TabVisible: visible, SeasonStartUtc: season, TimeZoneId: 'UTC' } : report())) };
 (globalThis as any).ApiClient = api;
});
afterEach(() => { (window as any).WatchbackRewind?.dispose(); delete (window as any).WatchbackRewind; vi.useRealTimers(); });

test('renders frozen numbers and months without top-title lists or title lookups', async () => {
 loadYearlyRewindBundle(); await flush();
 expect(root.textContent).toContain('Your year in review 2026');
 expect(root.textContent).not.toContain('<script>bad</script>');
 expect(root.querySelector('script')).toBeNull();
 expect(root.querySelectorAll('.jfw-rewind-stat')).toHaveLength(5);
 expect(root.querySelectorAll('.jfw-rewind-chart')).toHaveLength(1);
 expect(root.querySelector('[role="listitem"]')?.getAttribute('aria-label')).toBe('December 2025: 1.2 h');
 expect(root.querySelector('.jfw-rewind-bar')?.getAttribute('style')).toContain('height: 100%');
 expect(root.querySelector('progress')).toBeNull();
 expect(root.querySelector('.jfw-rewind-top-titles')).toBeNull();
 expect(root.textContent).not.toContain('Your top films');
 expect(root.textContent).not.toContain('Your top series');
 expect(api.ajax.mock.calls.some(([args]) => args.url.startsWith('/Items/'))).toBe(false);
 expect(root.querySelector('.jfw-rewind-heading .jfw-rewind-period')?.textContent).toBe('(12/15/2025 – 12/14/2026)');
 expect(root.textContent).not.toContain('Your first title');
 expect(root.textContent).not.toContain('Your most active period');
 expect((window as any).WatchbackTabs.updateTitle).toHaveBeenCalledWith('yearly-rewind', 'Year in review 2026');
 expect(root.querySelector('img')).toBeNull();
});

test('navigation and elapsed time reuse the frozen report without polling its availability', async () => {
 loadYearlyRewindBundle(); await flush();
 await vi.advanceTimersByTimeAsync(120000); await flush();
 expect(api.ajax.mock.calls.filter(([args]) => args.url.includes('Status'))).toHaveLength(1);
 document.dispatchEvent(new Event('jfw:navigation')); await flush();
 mount(root); await flush();
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(1);
 visible = false;
 document.dispatchEvent(new Event('jfw:navigation')); await flush();
 expect((window as any).WatchbackTabs.unregister).toHaveBeenCalledWith('yearly-rewind');
 expect(root.childNodes).toHaveLength(0);
});

test('disabled feature does not mount and an open report stays frozen until the next season', async () => {
 enabled = false; loadYearlyRewindBundle(); await flush();
 expect((window as any).WatchbackTabs.register).not.toHaveBeenCalled();
 enabled = true;
 document.dispatchEvent(new Event('jfw:navigation')); await flush();
 id = 'snapshot-b';
 document.dispatchEvent(new Event('jfw:navigation')); await flush();
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(1);
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2026');
 visible = false; document.dispatchEvent(new Event('jfw:navigation')); await flush();
 visible = true; document.dispatchEvent(new Event('jfw:navigation')); await flush();
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2027');
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(2);
});

test('mounting the tab does not fetch a report until the user activates it', async () => {
 let activate!: (panel: HTMLElement) => void;
 (window as any).WatchbackTabs.register.mockImplementation((_id, _title, callback, _icon, onActivate) => {
  callback(root); activate = onActivate;
 });
 loadYearlyRewindBundle(); await flush();
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(0);
 activate(root); await flush();
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2026');
});

test('missing files leave the tab visible and display a localized user-specific message', async () => {
 const fallback = api.ajax.getMockImplementation();
 api.ajax.mockImplementation(args => args.url.endsWith('/My') ? Promise.reject({status: 404})
  : args.url.includes('lang=de') ? Promise.resolve({'rewind.missing': 'Für deinen Benutzer ist kein Jahresrückblick vorhanden.'}) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 expect((window as any).WatchbackTabs.register).toHaveBeenCalled();
 expect(root.textContent).toContain('No year-in-review report exists for your user.');
 document.documentElement.lang = 'de'; await flush();
 expect(root.textContent).toBe('Für deinen Benutzer ist kein Jahresrückblick vorhanden.');
 mount(root); document.dispatchEvent(new Event('jfw:navigation')); await flush();
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(1);
 expect(root.querySelector('button')).toBeNull();
});

test('only the seasonal boundary schedules another configuration request', async () => {
 const fallback = api.ajax.getMockImplementation();
 api.ajax.mockImplementation(args => args.url.includes('Status') ? Promise.resolve({Enabled: true, TabVisible: visible,
  ServerTimeUtc: '2026-12-15T00:00:00Z', NextCheckAtUtc: '2026-12-16T00:00:00Z'}) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 await vi.advanceTimersByTimeAsync(60000); await flush();
 expect(api.ajax.mock.calls.filter(([args]) => args.url.includes('Status'))).toHaveLength(1);
 visible = false;
 await vi.advanceTimersByTimeAsync(86340000); await flush();
 expect((window as any).WatchbackTabs.unregister).toHaveBeenCalledWith('yearly-rewind');
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(1);
});

test('failed discovery retries automatically and stops retrying after recovery', async () => {
 let attempts = 0;
 const fallback = api.ajax.getMockImplementation();
 api.ajax.mockImplementation(args => args.url.includes('Status') && ++attempts <= 2 ? Promise.reject({status: 503}) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 expect((window as any).WatchbackTabs.register).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(59999); await flush();
 expect(attempts).toBe(1);
 await vi.advanceTimersByTimeAsync(60001); await flush();
 expect(attempts).toBe(3);
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2026');
 await vi.advanceTimersByTimeAsync(120000); await flush();
 expect(attempts).toBe(3);
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(1);
});

test('transient discovery failures keep a displayed report and retry only discovery', async () => {
 const fallback = api.ajax.getMockImplementation();
 loadYearlyRewindBundle(); await flush();
 api.ajax.mockImplementation(args => args.url.includes('Status') ? Promise.reject({status: 503}) : fallback(args));
 document.dispatchEvent(new Event('jfw:navigation')); await flush();
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2026');
 expect((window as any).WatchbackTabs.unregister).not.toHaveBeenCalled();
 api.ajax.mockImplementation(fallback);
 await vi.advanceTimersByTimeAsync(60000); await flush();
 expect(api.ajax.mock.calls.filter(([args]) => args.url.includes('Status'))).toHaveLength(3);
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(1);
});

test.each([401, 403])('discovery authentication failure clears the tab without retrying (%s)', async status => {
 const fallback = api.ajax.getMockImplementation();
 loadYearlyRewindBundle(); await flush();
 api.ajax.mockImplementation(args => args.url.includes('Status') ? Promise.reject({status}) : fallback(args));
 document.dispatchEvent(new Event('jfw:navigation')); await flush();
 expect(root.childNodes).toHaveLength(0);
 await vi.advanceTimersByTimeAsync(120000); await flush();
 expect(api.ajax.mock.calls.filter(([args]) => args.url.includes('Status'))).toHaveLength(2);
});

test.each(['loaded', 'missing'])('same-user season changes invalidate cached %s reports without a hidden interval', async state => {
 const fallback = api.ajax.getMockImplementation();
 root.classList.add('is-active');
 api.ajax.mockImplementation(args => state === 'missing' && args.url.endsWith('/My') ? Promise.reject({status: 404}) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 api.ajax.mockImplementation(fallback);
 season = '2027-12-15T00:00:00Z'; id = 'snapshot-b';
 document.dispatchEvent(new Event('visibilitychange')); await flush();
 expect(user).toBe('a');
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2027');
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(2);
});

test.each(['old-first', 'new-first'])('same-user season changes reject late report responses (%s)', async order => {
 const pending: Array<{data: any; resolve: (data: any) => void}> = [];
 const fallback = api.ajax.getMockImplementation();
 root.classList.add('is-active');
 api.ajax.mockImplementation(args => args.url.endsWith('/My') ? new Promise(resolve => pending.push({data: report(), resolve})) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 season = '2027-12-15T00:00:00Z'; id = 'snapshot-b';
 document.dispatchEvent(new Event('visibilitychange')); await flush();
 expect(user).toBe('a');
 expect(pending).toHaveLength(2);
 if (order === 'old-first') {
  pending[0].resolve(pending[0].data); await flush();
  expect(root.querySelector('h2')).toBeNull();
 }
 pending[1].resolve(pending[1].data); await flush();
 if (order === 'new-first') { pending[0].resolve(pending[0].data); await flush(); }
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2027');
 expect(root.textContent).not.toContain('Your year in review 2026');
});

test.each([404, 401])('late previous-season errors cannot hide or invalidate the new report (%s)', async status => {
 let reject!: (error: unknown) => void;
 const fallback = api.ajax.getMockImplementation();
 root.classList.add('is-active');
 api.ajax.mockImplementation(args => args.url.endsWith('/My') ? new Promise((_resolve, fail) => { reject = fail; }) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 api.ajax.mockImplementation(fallback);
 season = '2027-12-15T00:00:00Z'; id = 'snapshot-b';
 document.dispatchEvent(new Event('visibilitychange')); await flush();
 reject({status}); await flush();
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2027');
 expect((window as any).WatchbackTabs.unregister).not.toHaveBeenCalled();
});

test('an inactive tab defers the new season report until activation', async () => {
 loadYearlyRewindBundle(); await flush();
 season = '2027-12-15T00:00:00Z'; id = 'snapshot-b';
 document.dispatchEvent(new Event('visibilitychange')); await flush();
 expect(root.querySelector('h2')).toBeNull();
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(1);
 mount(root); await flush();
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2027');
});

test('logout clears immediately and rejects a late response from the previous user', async () => {
 let resolve: (value: unknown) => void;
 api.ajax.mockImplementation(({url}) => url.endsWith('/My') ? new Promise(done => { resolve = done; }) : Promise.resolve(url.includes('Status') ? {Enabled: true, TabVisible: true} : {}));
 loadYearlyRewindBundle(); await flush();
 document.dispatchEvent(new Event('jfw:session-changing')); user = '';
 resolve!(report()); await flush();
 expect(root.childNodes).toHaveLength(0);
});

test('handles missing history and retries errors without unsafe markup', async () => {
 let fail = true;
 api.ajax.mockImplementation(({url}) => url.endsWith('/My') ? fail ? Promise.reject({status: 503}) : Promise.resolve({...report(), DataState: 'NotCollected'}) : Promise.resolve(url.includes('Status') ? {Enabled: true, TabVisible: true} : {}));
 loadYearlyRewindBundle(); await flush();
 expect(root.textContent).toContain('Try again'); fail = false;
 root.querySelector('button')!.click(); await flush();
 expect(root.textContent).toContain('Playback was not recorded');
 expect(root.querySelector('.jfw-rewind-stats')).toBeNull();
});

test('uses supported Jellyfin document locale and keeps unknown locales in English', async () => {
 document.documentElement.lang = 'de-DE'; loadYearlyRewindBundle(); await flush();
 expect(api.ajax.mock.calls[0][0].url).toContain('lang=de');
 (window as any).WatchbackRewind.dispose(); delete (window as any).WatchbackRewind;
 document.documentElement.lang = 'xx'; loadYearlyRewindBundle(); await flush();
 expect(api.ajax.mock.calls.some(([args]) => args.url.includes('lang=en'))).toBe(true);
});

test('uses the translated German heading and tab title with the snapshot year', async () => {
 document.documentElement.lang = 'de';
 const fallback = api.ajax.getMockImplementation();
 api.ajax.mockImplementation(args => args.url.includes('Translations') ? Promise.resolve({'rewind.title': 'Dein Jahresrückblick', 'rewind.tabTitle': 'Jahresrückblick'}) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('h2')?.textContent).toBe('Dein Jahresrückblick 2026 (15.12.2025 – 14.12.2026)');
 expect((window as any).WatchbackTabs.updateTitle).toHaveBeenCalledWith('yearly-rewind', 'Jahresrückblick 2026');
});

test('updates the tab and report when Jellyfin applies the user language after startup', async () => {
 const fallback = api.ajax.getMockImplementation();
 api.ajax.mockImplementation(args => args.url.includes('lang=de') ? Promise.resolve({'rewind.title': 'Dein Jahresrückblick', 'rewind.tabTitle': 'Jahresrückblick'}) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 document.documentElement.lang = 'de-DE'; await flush();
 expect(root.querySelector('h2')?.textContent).toBe('Dein Jahresrückblick 2026 (15.12.2025 – 14.12.2026)');
 expect((window as any).WatchbackTabs.updateTitle).toHaveBeenCalledWith('yearly-rewind', 'Jahresrückblick 2026');
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(1);
});

test('slow translations do not delay loading the report and cannot overwrite a newer language', async () => {
 let english: (data: unknown) => void;
 const fallback = api.ajax.getMockImplementation();
 api.ajax.mockImplementation(args => args.url.includes('lang=en') ? new Promise(done => { english = done; })
  : args.url.includes('lang=de') ? Promise.resolve({'rewind.title': 'Dein Jahresrückblick', 'rewind.tabTitle': 'Jahresrückblick'}) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review');
 document.documentElement.lang = 'de'; await flush();
 english!({'rewind.title': 'Late English'}); await flush();
 expect(root.querySelector('h2')?.textContent).toContain('Dein Jahresrückblick');
});

function insights() {
 return {HourlySeconds: Array.from({length: 24}, (_, index) => index === 20 ? 3600 : index === 8 ? 600 : 0),
  WeekdaySeconds: [0, 0, 0, 4200, 0, 0, 0], LongestStreakDays: 2, LongestStreakStart: '2026-06-03', LongestStreakEnd: '2026-06-04'};
}
function comparison() {
 return {PeriodStartUtc: '2024-12-15T00:00:00Z', SnapshotAtUtc: '2025-12-15T00:00:00Z', TimeZoneId: 'UTC', DataState: 'Ready',
 ActiveSeconds: 7200, MovieCount: 2, EpisodeCount: 0, SeriesCount: 0, ActiveDays: 4, Genres: ['Adventure'], TopGenre: 'Adventure'};
}

test('renders two accessible pie charts using time shares and unknown genre metadata', async () => {
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelectorAll('.jfw-rewind-pie')).toHaveLength(2);
 expect(root.querySelector('.jfw-rewind-mix svg')?.getAttribute('aria-label')).toContain('Films: 85.7%');
 expect(root.querySelector('.jfw-rewind-mix svg')?.getAttribute('aria-label')).toContain('Series: 14.3%');
 expect(root.querySelector('.jfw-rewind-genres')?.textContent).toContain('Distinct genres: 1');
 expect(root.querySelector('.jfw-rewind-genres')?.textContent).toContain('Unknown genre');
 expect(root.querySelector('.jfw-rewind-genres svg')?.getAttribute('aria-label')).toContain('Drama: 85.7%');
});

test('monthly genre selection uses frozen monthly data without fetching or changing the report', async () => {
 extra.Months = [{StartUtc: '2025-12-15T00:00:00Z', EndUtc: '2026-01-15T00:00:00Z', ActiveSeconds: 4200,
 Genres: [{Name: 'Drama', ActiveSeconds: 3600}, {Name: null, ActiveSeconds: 600}]},
 {StartUtc: '2026-01-15T00:00:00Z', EndUtc: '2026-02-15T00:00:00Z', ActiveSeconds: 0, Genres: []}];
 loadYearlyRewindBundle(); await flush();
 const calls = api.ajax.mock.calls.length;
 const select = root.querySelector('.jfw-rewind-select') as HTMLSelectElement;
 expect(select.options).toHaveLength(3);
 select.value = '1'; select.dispatchEvent(new Event('change'));
 expect(root.querySelector('.jfw-rewind-genres svg')).toBeNull();
 expect(root.querySelector('.jfw-rewind-genres')?.textContent).toContain('No qualifying playback');
 select.value = 'all'; select.dispatchEvent(new Event('change'));
 expect(root.querySelectorAll('.jfw-rewind-pie')).toHaveLength(2);
 expect(api.ajax.mock.calls).toHaveLength(calls);
});

test('shows local viewing habits, calendar streak dates and only numeric previous-period differences', async () => {
 extra = {Insights: insights(), Comparison: comparison(), TimeZoneId: 'Pacific/Honolulu'};
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('.jfw-rewind-patterns')?.textContent).toContain('Thursday');
 expect(root.querySelector('.jfw-rewind-patterns')?.textContent).toContain('Evening (18:00–24:00)');
 expect(root.querySelector('.jfw-rewind-patterns')?.textContent).toContain('Time zone: Pacific/Honolulu');
 expect(root.querySelector('.jfw-rewind-streak')?.textContent).toContain('2 days');
 expect(root.querySelector('.jfw-rewind-streak')?.textContent).toContain('06/03/2026 – 06/04/2026');
 expect(root.querySelectorAll('.jfw-rewind-comparison tbody tr')).toHaveLength(5);
 expect(root.querySelector('.jfw-rewind-comparison')?.textContent).toContain('-41.7%');
 expect(root.querySelector('.jfw-rewind-comparison')?.textContent).toContain('Genres absent from the previous report: Drama');
});

test('legacy snapshots explain missing insights and comparison without fabricating historical facts', async () => {
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('.jfw-rewind-patterns')?.textContent).toContain('not included');
 expect(root.querySelector('.jfw-rewind-streak-length')).toBeNull();
 expect(root.querySelector('.jfw-rewind-comparison')?.textContent).toContain('No report for the preceding period');
 expect(root.querySelector('.jfw-rewind-comparison table')).toBeNull();
 expect(root.querySelector('.jfw-rewind-select')).toBeNull();
});

test('zero baselines avoid infinite percentages and incomplete collection is explained', async () => {
 extra.Comparison = {...comparison(), ActiveSeconds: 0, MovieCount: 0, ActiveDays: 0, DataState: 'Partial'};
 loadYearlyRewindBundle(); await flush();
 const table = root.querySelector('.jfw-rewind-comparison table')!;
 expect(table.textContent).not.toMatch(/NaN|Infinity|%/);
 expect(root.querySelector('.jfw-rewind-comparison .jfw-rewind-notice')?.textContent).toContain('partially recorded');
});

test('single-category and empty pies remain finite and safe for hostile genre labels', async () => {
 extra.Items = [{ItemId: 'deleted', ItemType: 'Movie', Name: 'Title', ActiveSeconds: 3600, Genres: ['<img src=x onerror=alert(1)>']}];
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelectorAll('.jfw-rewind-pie circle')).toHaveLength(2);
 expect(root.querySelector('.jfw-rewind-genres img')).toBeNull();
 expect(root.querySelector('.jfw-rewind-genres')?.textContent).toContain('<img src=x onerror=alert(1)>');
 (window as any).WatchbackRewind.dispose(); delete (window as any).WatchbackRewind;
 extra.Items = []; loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('.jfw-rewind-pie')).toBeNull();
 expect(root.textContent).not.toContain('NaN');
});

test('genre pie counts full time for every distinct tag and groups the long tail without losing time', async () => {
 extra.Items = Array.from({length: 9}, (_, index) => ({ItemId: 'deleted-' + index, ItemType: 'Movie', Name: 'Movie ' + index, ActiveSeconds: 3600,
  Genres: ['Genre ' + index, 'Genre ' + index, ' Shared ']}));
 loadYearlyRewindBundle(); await flush();
 const genres = root.querySelector('.jfw-rewind-genres')!;
 expect(genres.textContent).toContain('Distinct genres: 10');
 expect(genres.querySelectorAll('.jfw-rewind-pie-legend li')).toHaveLength(6);
 expect(genres.querySelector('svg')?.getAttribute('aria-label')).toContain('Shared: 50% · 9 h');
 expect(genres.querySelector('svg')?.getAttribute('aria-label')).toContain('Other genres: 27.8% · 5 h');
 expect(root.querySelector('.jfw-rewind-mix svg')?.getAttribute('aria-label')).toContain('Films: 100% · 9 h');
});

test('reconstructed activity is approximate and does not invent viewing habits or active days', async () => {
 extra = {DataState: 'Partial', ReconstructedItemCount: 1, ActiveDays: 0,
  Items: [{ItemId: 'reconstructed', Name: 'Imported title', ItemType: 'Movie', ActiveSeconds: 3600, EstimatedSeconds: 3600, HasReconstructedActivity: true, Genres: ['Drama']}],
  Months: [{StartUtc: '2025-12-15T00:00:00Z', EndUtc: '2026-01-15T00:00:00Z', ActiveSeconds: 3600, EstimatedSeconds: 3600}],
  Insights: {HourlySeconds: Array(24).fill(0), WeekdaySeconds: Array(7).fill(0), LongestStreakDays: 0}};
 loadYearlyRewindBundle(); await flush();
 expect(root.textContent).toContain('Includes 1 titles reconstructed from Jellyfin data');
 expect(root.textContent).toContain('≈ 1');
 expect(root.textContent).toContain('Measured active days');
 expect(root.textContent).toContain('These details require measured playback');
 expect(root.querySelector('.jfw-rewind-estimated-bar')).not.toBeNull();
 expect(root.querySelector('[role="listitem"]')?.getAttribute('aria-label')).toContain('1 h estimated');
 expect(root.textContent).not.toContain('Some playback data is missing');
});

test('unknown reconstructed duration stays unavailable instead of showing zero hours', async () => {
 extra = {DataState: 'Partial', ReconstructedItemCount: 1, ActiveDays: 0,
  Items: [{ItemId: 'unknown', Name: 'Imported title', ItemType: 'Movie', ActiveSeconds: 0, EstimatedSeconds: 0, HasReconstructedActivity: true, Genres: []}], Months: [],
  Comparison: {PeriodStartUtc: '2024-12-15T00:00:00Z', SnapshotAtUtc: '2025-12-15T00:00:00Z', TimeZoneId: 'UTC', ActiveSeconds: 0, EstimatedSeconds: 0, ReconstructedItemCount: 1}};
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('.jfw-rewind-stat')?.textContent).toContain('—');
 expect(root.textContent).toContain('No watch duration is available');
 expect(root.textContent).not.toContain('Imported title');
 expect(root.querySelector('.jfw-rewind-estimated-bar')).toBeNull();
 const hours = root.querySelector('.jfw-rewind-comparison-table tbody tr');
 expect(Array.from(hours!.querySelectorAll('td'), cell => cell.textContent)).toEqual(['—', '—', '—']);
});


test.each(['old-first', 'new-first'])('late reports from the previous user never replace the current report (%s)', async order => {
 const pending: Array<{data: any; resolve: (data: any) => void}> = [];
 const fallback = api.ajax.getMockImplementation();
 api.ajax.mockImplementation(args => args.url.endsWith('/My') ? new Promise(resolve => pending.push({data: report(), resolve})) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 expect(pending).toHaveLength(1);
 document.dispatchEvent(new Event('jfw:session-changing')); user = 'b'; id = 'snapshot-b';
 document.dispatchEvent(new Event('jfw:session-changed')); await flush();
 expect(pending).toHaveLength(2);
 if (order === 'old-first') {
  pending[0].resolve(pending[0].data); await flush();
  expect(root.textContent).not.toContain('Your year in review 2026');
 }
 pending[1].resolve(pending[1].data); await flush();
 if (order === 'new-first') { pending[0].resolve(pending[0].data); await flush(); }
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2027');
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(2);
});

test('an outstanding report request is not duplicated by navigation', async () => {
 let resolve!: (value: any) => void;
 const fallback = api.ajax.getMockImplementation();
 api.ajax.mockImplementation(args => args.url.endsWith('/My') ? new Promise(done => {resolve = done;}) : fallback(args));
 loadYearlyRewindBundle(); await flush();
 document.dispatchEvent(new Event('jfw:navigation')); await flush();
 mount(root); await flush();
 resolve(report()); await flush();
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2026');
 expect(api.ajax.mock.calls.filter(([args]) => args.url.endsWith('/My'))).toHaveLength(1);
});

test.each(['2028-02-28', '2028-02-29', '2028-03-01', '2028-12-31'])('E2E annual windows remain valid around %s', day => {
 const now = new Date(day + 'T12:00:00Z');
 const window = visibleRewindWindow(now);
 const today = now.toISOString().slice(5, 10);
 expect(window.YearlyRewindStartDate <= today && today <= window.YearlyRewindEndDate).toBe(true);
 expect(window.YearlyRewindStartDate).not.toBe('02-29');
 expect(window.YearlyRewindEndDate).not.toBe('02-29');
 expect(todayMonthDay(1, now)).not.toBe('02-29');
 expect(todayMonthDay(1, now)).not.toBe(today);
});


test('identifies imported Playback Reporting history and keeps old reports readable', async () => {
 extra = {PlaybackReportingPlayCount: 12, ReconstructedItemCount: 1, JellyfinReconstructedItemCount: 1, DataState: 'Partial'};
 loadYearlyRewindBundle(); await flush();
 expect(root.textContent).toContain('Historical plays imported from Playback Reporting: 12.');
 expect(root.textContent).toContain('Includes 1 titles reconstructed from Jellyfin data.');
 extra = {}; id = 'snapshot-b'; user = 'b';
 document.dispatchEvent(new Event('jfw:session-changed')); await flush();
 expect(root.querySelector('h2')?.textContent).toContain('Your year in review 2027');
 expect(root.textContent).not.toContain('Historical plays imported');
});

test.each([false, true])('legacy import-only reports retain their frozen estimates and source notice (explicit count: %s)', async explicitCount => {
 extra = {PlaybackReportingPlayCount: 1, ReconstructedItemCount: 1, DataState: 'Partial',
  Items: [{ItemId: 'import', Name: 'Imported film', ItemType: 'Movie', ActiveSeconds: 600, EstimatedSeconds: 600, HasReconstructedActivity: true, PlaybackReportingPlayCount: 1, Genres: []}],
  ...(explicitCount ? {JellyfinReconstructedItemCount: 0} : {})};
 loadYearlyRewindBundle(); await flush();
 expect(root.textContent).toContain('Historical plays imported from Playback Reporting: 1.');
 expect(root.textContent).not.toContain('reconstructed from Jellyfin data');
 expect(root.querySelector('.jfw-rewind-stat')?.textContent).toContain('≈');
});

test('recorded Playback Reporting video durations render without estimates or invented activity details', async () => {
 extra = {PlaybackReportingPlayCount: 2, PlaybackReportingSeconds: 3600, ReconstructedItemCount: 0, JellyfinReconstructedItemCount: 0,
  DataState: 'Partial', ActiveDays: 0, Insights: {HourlySeconds: Array(24).fill(0), WeekdaySeconds: Array(7).fill(0), LongestStreakDays: 0},
  Items: [{ItemId: 'import', Name: 'Recorded film', ItemType: 'Movie', ActiveSeconds: 3600, EstimatedSeconds: 0,
   PlaybackReportingSeconds: 3600, PlaybackReportingPlayCount: 2, PlayCount: 2, HasReconstructedActivity: false, Genres: ['Drama']}],
  Months: [{StartUtc: periodStart(), ActiveSeconds: 3600, EstimatedSeconds: 0, PlaybackReportingSeconds: 3600}],
  Comparison: {...comparison(), ActiveSeconds: 3600, PlaybackReportingSeconds: 3600, EstimatedSeconds: 0, ReconstructedItemCount: 0, ActiveDays: 0}};
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('.jfw-rewind-stat strong')?.textContent).toBe('1');
 expect(root.textContent).not.toContain('≈');
 expect(root.textContent).not.toContain('reconstructed from Jellyfin data');
 expect(root.textContent).toContain('Historical plays imported from Playback Reporting: 2.');
 expect(root.querySelector('.jfw-rewind-estimated-bar')).toBeNull();
 expect(root.querySelector('.jfw-rewind-month')?.getAttribute('aria-label')).toBe('December 2025: 1 h');
 expect(root.querySelectorAll('.jfw-rewind-stat strong')[4].textContent).toBe('—');
 expect(root.querySelector('.jfw-rewind-patterns')?.textContent).toContain('Playback Reporting durations are recorded values.');
 expect(root.querySelector('.jfw-rewind-streak-length')).toBeNull();
 expect(root.querySelector('.jfw-rewind-streak')?.textContent).toContain('Playback Reporting durations are recorded values.');
 expect(root.querySelector('.jfw-rewind-comparison')?.textContent).not.toContain('Differences may include estimated values');
 const activity = root.querySelectorAll('.jfw-rewind-comparison tbody tr')[4];
 expect(Array.from(activity.querySelectorAll('td'), cell => cell.textContent)).toEqual(['—', '—', '—']);
});

test('recorded imports and real Jellyfin estimates keep separate portions in the monthly chart', async () => {
 extra = {PlaybackReportingPlayCount: 1, PlaybackReportingSeconds: 3600, ReconstructedItemCount: 1, JellyfinReconstructedItemCount: 1,
  Items: [{ItemId: 'import', Name: 'Recorded film', ItemType: 'Movie', ActiveSeconds: 3600, PlaybackReportingSeconds: 3600, PlaybackReportingPlayCount: 1, Genres: []},
   {ItemId: 'fallback', Name: 'Estimated film', ItemType: 'Movie', ActiveSeconds: 7200, EstimatedSeconds: 7200, HasReconstructedActivity: true, Genres: []}],
  Months: [{StartUtc: periodStart(), ActiveSeconds: 10800, EstimatedSeconds: 7200, PlaybackReportingSeconds: 3600}]};
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('.jfw-rewind-stat strong')?.textContent).toBe('≈ 3');
 expect(root.querySelector('.jfw-rewind-month')?.getAttribute('aria-label')).toBe('December 2025: 3 h (2 h estimated)');
 expect(root.querySelector('.jfw-rewind-time-legend')?.textContent).toContain('Recorded');
 expect(root.querySelector('.jfw-rewind-time-legend')?.textContent).toContain('Estimated');
 expect(root.textContent).toContain('Includes 1 titles reconstructed from Jellyfin data.');
});

test('recorded music imports display exact listening hours and tracks without reconstructed warnings', async () => {
 extra = {Music: {DataState: 'Ready', PlaybackReportingPlayCount: 3, PlaybackReportingSeconds: 1800, ReconstructedItemCount: 0,
  Insights: {HourlySeconds: Array(24).fill(0), WeekdaySeconds: Array(7).fill(0), LongestStreakDays: 0},
  Items: [{ItemId: 'track', Name: 'Recorded track', ItemType: 'Audio', ActiveSeconds: 1800, PlaybackReportingSeconds: 1800, EstimatedSeconds: 0,
   HasReconstructedActivity: false, PlaybackReportingPlayCount: 3, PlayCount: 3, Genres: ['Jazz']}],
  Months: [{StartUtc: periodStart(), ActiveSeconds: 1800, PlaybackReportingSeconds: 1800, EstimatedSeconds: 0}]}};
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelectorAll('.jfw-rewind-stat strong')[5].textContent).toBe('0.5');
 expect(root.querySelector('.jfw-rewind-track-duration')?.textContent).toBe('0.5 h');
 expect(root.querySelector('.jfw-rewind-top-tracks')?.textContent).not.toContain('reconstructed music activity');
 expect(root.querySelector('.jfw-rewind-music-months .jfw-rewind-estimated-bar')).toBeNull();
 expect(root.querySelector('.jfw-rewind-streak-music strong')?.textContent).toBe('—');
 expect(root.textContent).not.toContain('≈');
});

test('mixed plays of one title retain both source notices', async () => {
 extra = {PlaybackReportingPlayCount: 1, ReconstructedItemCount: 1, DataState: 'Partial',
  Items: [{ItemId: 'mixed', Name: 'Film', ItemType: 'Movie', ActiveSeconds: 4200, EstimatedSeconds: 4200, HasReconstructedActivity: true, HasJellyfinReconstructedActivity: true, PlaybackReportingPlayCount: 1, Genres: []}]};
 loadYearlyRewindBundle(); await flush();
 expect(root.textContent).toContain('Historical plays imported from Playback Reporting: 1.');
 expect(root.textContent).toContain('Includes 1 titles reconstructed from Jellyfin data.');
});

const musicReport = (overrides: Record<string, any> = {}) => ({
 FullTimePerGenre: true, DataState: 'Partial', TimeZoneId: 'UTC', ReconstructedItemCount: 1, PlaybackReportingPlayCount: 2,
 Items: Array.from({ length: 7 }, (_, index) => ({ ItemId: 'track-' + index, Name: index === 6 ? '<img src=x onerror=bad()>' : 'Track ' + index,
  ItemType: 'Audio', ActiveSeconds: (index + 1) * 600, PlayCount: index + 1, Genres: index === 0 ? [] : ['Jazz', 'Rock'], HasReconstructedActivity: index === 6 })),
 Months: [{ StartUtc: '2026-01-01T00:00:00Z', ActiveSeconds: 16800, EstimatedSeconds: 600, Genres: [{ Name: 'Jazz', ActiveSeconds: 16800 }] },
 { StartUtc: '2026-02-01T00:00:00Z', ActiveSeconds: 0, EstimatedSeconds: 0, Genres: [] }], ...overrides
});

test.each([undefined, {Items: []}])('music content is absent from old or empty reports (%j)', async music => {
 extra = music === undefined ? {} : {Music: music};
 loadYearlyRewindBundle(); await flush();
 for (const selector of ['.jfw-rewind-top-tracks', '.jfw-rewind-music-genres', '.jfw-rewind-music-months', '.jfw-rewind-stats-music']) {
  expect(root.querySelector(selector)).toBeNull();
 }
 expect(root.querySelectorAll('.jfw-rewind-stat')).toHaveLength(5);
});

test('music ranks five tracks by listening time and renders safe independent totals and charts', async () => {
 extra = { Music: musicReport() }; loadYearlyRewindBundle(); await flush();
 const music = root;
 expect(music.querySelectorAll('.jfw-rewind-stat')).toHaveLength(8);
 expect(root.querySelectorAll('.jfw-rewind-stats')).toHaveLength(1);
 expect(root.querySelector('.jfw-rewind-music')).toBeNull();
 expect(root.querySelector('.jfw-rewind-top-tracks')?.parentElement).toBe(root.querySelector('.jfw-rewind-genres')?.parentElement);
 expect(root.querySelector('.jfw-rewind-music-months')?.parentElement).toBe(root.querySelector('.jfw-rewind-months')?.parentElement);
 expect(music.textContent).toContain('≈ 4.7');
 expect(music.textContent).toContain('Hours listened');
 expect(music.textContent).toContain('Historical plays imported from Playback Reporting: 2.');
 expect(music.textContent).toContain('reconstructed music activity');
 const titles = music.querySelectorAll('.jfw-rewind-top-tracks ol li'); expect(titles).toHaveLength(5);
 expect(titles[0].textContent).toContain('<img src=x onerror=bad()>');
 expect(titles[1].textContent).toContain('Track 5');
 expect(music.querySelector('img')).toBeNull();
 expect(music.querySelector('.jfw-rewind-music-genres svg.jfw-rewind-pie')?.getAttribute('aria-label')).toContain('Your music genres');
 expect(music.querySelector('.jfw-rewind-music-months [role="listitem"]')?.getAttribute('aria-label')).toContain('January 2026: 4.7 h (0.2 h estimated)');
 expect(root.querySelectorAll('.jfw-rewind-stat')[5].textContent).toContain('4.7');
 // The original video stats remain 1.2 hours despite music activity.
 expect(root.querySelector(':scope > .jfw-rewind-stats')?.textContent).toContain('1.2');
 const select = music.querySelector('.jfw-rewind-music-genres select')!;
 expect(select.id).not.toBe(root.querySelector('.jfw-rewind-genres select')?.id);
 select.value = '0'; select.dispatchEvent(new Event('change'));
 expect(music.querySelector('.jfw-rewind-music-genres svg.jfw-rewind-pie')?.getAttribute('aria-label')).toContain('Jazz: 100%');
 select.value = '1'; select.dispatchEvent(new Event('change'));
 expect(music.querySelector('.jfw-rewind-music-genres .jfw-rewind-pie-body svg')).toBeNull();
 select.value = 'all'; select.dispatchEvent(new Event('change'));
 expect(music.querySelector('.jfw-rewind-music-genres svg.jfw-rewind-pie')?.getAttribute('aria-label')).toContain('Rock');
});

test('music remains visible when no video was collected', async () => {
 extra = { DataState: 'NotCollected', Items: [], Music: musicReport({ DataState: 'Ready', PlaybackReportingPlayCount: 0 }) };
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelectorAll('.jfw-rewind-top-tracks li')).toHaveLength(5);
 expect(root.querySelectorAll(':scope > .jfw-rewind-stats')).toHaveLength(1);
 expect(root.querySelectorAll('.jfw-rewind-stat')).toHaveLength(8);
});

test('music without known durations uses unavailable labels and omits charts', async () => {
 extra = { Music: musicReport({ Items: [{ Name: 'Unknown duration', HasReconstructedActivity: true, ActiveSeconds: 0, PlayCount: 1 }] }) };
 loadYearlyRewindBundle(); await flush();
 const music = root;
 expect(music.textContent).toContain('No listening duration');
 expect(music.querySelectorAll('.jfw-rewind-stat')[5].textContent).toContain('—');
 expect(music.querySelector('ol')?.textContent).toContain('—');
 expect(music.querySelector('.jfw-rewind-music-genres svg.jfw-rewind-pie')).toBeNull();
});

test('measured music with tied durations and no months renders without estimates', async () => {
 extra = { music: { dataState: 'Ready', items: [
  { name: 'B', itemId: 'b', activeSeconds: 600 },
  { name: 'A', itemId: 'b', activeSeconds: 600 },
  { name: 'A', itemId: 'a', activeSeconds: 600 },
 ], months: [] } };
 loadYearlyRewindBundle(); await flush();
 const music = root;
 expect(music.querySelector('ol li')?.textContent).toContain('A');
 expect(music.textContent).not.toContain('≈');
 expect(music.querySelector('.jfw-rewind-top-tracks')?.textContent).not.toContain('reconstructed');
 expect(music.querySelector('.jfw-rewind-music-months')).toBeNull();
 expect(music.querySelector('.jfw-rewind-music-genres svg.jfw-rewind-pie')?.getAttribute('aria-label')).toContain('Unknown genre');
});


test('music comparison includes listening hours, tracks and plays with actual previous values', async () => {
 extra = { Comparison: { PeriodStartUtc: '2024-12-15T00:00:00Z', SnapshotAtUtc: '2025-12-15T00:00:00Z', TimeZoneId: 'UTC', ActiveSeconds: 3600 },
  Music: musicReport({ Comparison: { DataState: 'Ready', ActiveSeconds: 7200, TrackCount: 4, PlayCount: 10 } }) };
 loadYearlyRewindBundle(); await flush();
 const rows = root.querySelectorAll('.jfw-rewind-comparison-table tbody tr');
 expect(rows).toHaveLength(8);
 expect(Array.from(rows[5].querySelectorAll('td'), cell => cell.textContent)).toEqual(['4.7', '2', '+2.7 (+133.3%)']);
 expect(Array.from(rows[6].querySelectorAll('td'), cell => cell.textContent)).toEqual(['7', '4', '+3 (+75%)']);
 expect(Array.from(rows[7].querySelectorAll('td'), cell => cell.textContent)).toEqual(['28', '10', '+18 (+180%)']);
});

test.each([undefined, {ActiveSeconds: 3600}])('missing historical music counts stay unavailable (%j)', async previous => {
 extra = { Comparison: { PeriodStartUtc: '2024-12-15T00:00:00Z', SnapshotAtUtc: '2025-12-15T00:00:00Z', TimeZoneId: 'UTC' },
  Music: musicReport({ Comparison: previous }) };
 loadYearlyRewindBundle(); await flush();
 const rows = root.querySelectorAll('.jfw-rewind-comparison-table tbody tr');
 expect(rows[6].textContent).toContain('Tracks7——');
 expect(rows[7].textContent).toContain('Music plays28——');
});


test('retained music comparisons render without a video comparison', async () => {
 extra = { DataState: 'NotCollected', Items: [], Comparison: null, Music: musicReport({ Comparison: {
  PeriodStartUtc: '2024-12-15T00:00:00Z', SnapshotAtUtc: '2025-12-15T00:00:00Z', TimeZoneId: 'UTC',
  DataState: 'Partial', ActiveSeconds: 7200, TrackCount: 4, PlayCount: 10
 } }) };
 loadYearlyRewindBundle(); await flush();
 const rows = root.querySelectorAll('.jfw-rewind-comparison-table tbody tr');
 expect(rows).toHaveLength(8);
 for (const row of Array.from(rows).slice(0, 5)) {
  expect(Array.from(row.querySelectorAll('td'), cell => cell.textContent)).toEqual(['—', '—', '—']);
 }
 expect(Array.from(rows[5].querySelectorAll('td'), cell => cell.textContent)).toEqual(['4.7', '2', '+2.7 (+133.3%)']);
 expect(Array.from(rows[6].querySelectorAll('td'), cell => cell.textContent)).toEqual(['7', '4', '+3 (+75%)']);
 expect(Array.from(rows[7].querySelectorAll('td'), cell => cell.textContent)).toEqual(['28', '10', '+18 (+180%)']);
 expect(root.querySelector('.jfw-rewind-comparison')?.textContent).toContain('12/15/2024 – 12/14/2025');
 expect(root.querySelector('.jfw-rewind-comparison')?.textContent).not.toContain('No report for the preceding period');
 expect(root.querySelector('.jfw-rewind-comparison')?.textContent).not.toContain('Previous top genre');
});


test('genre information toggles independently above inline diversity controls', async () => {
 extra = { Music: musicReport(), Months: [{StartUtc: periodStart(), ActiveSeconds: 4200, Genres: [{Name: 'Drama', ActiveSeconds: 4200}]}] };
 loadYearlyRewindBundle(); await flush();
 for (const selector of ['.jfw-rewind-genres', '.jfw-rewind-music-genres']) {
  const chart = root.querySelector(selector)!;
  const button = chart.querySelector<HTMLButtonElement>('h3 button')!;
  const info = chart.querySelector<HTMLElement>('.jfw-rewind-genre-info')!;
  const controls = chart.querySelector('.jfw-rewind-genre-controls')!;
  expect(button.getAttribute('aria-controls')).toBe(info.id);
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(info.hidden).toBe(true);
  button.click();
  expect(info.hidden).toBe(false);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(info.textContent).toContain('full playback time');
  expect(info.nextElementSibling).toBe(controls);
  expect(controls.querySelector('select')).not.toBeNull();
  expect(chart.querySelector('label')).toBeNull();
  button.click(); expect(info.hidden).toBe(true);
 }
 expect(root.textContent).not.toContain('divided equally');
});

test('legacy annual genres use full item time without offering divided monthly weights', async () => {
 extra = { FullTimePerGenre: false, Items: [{ ItemType: 'Movie', ActiveSeconds: 7200, Genres: ['Drama', 'Adventure'] }],
  Months: [{StartUtc: periodStart(), Genres: [{Name: 'Drama', ActiveSeconds: 3600}, {Name: 'Adventure', ActiveSeconds: 3600}]}] };
 loadYearlyRewindBundle(); await flush();
 const chart = root.querySelector('.jfw-rewind-genres')!;
 expect(chart.querySelector('select')).toBeNull();
 expect(chart.querySelector('svg')?.getAttribute('aria-label')).toContain('Drama: 50% · 2 h');
 expect(chart.querySelector('svg')?.getAttribute('aria-label')).toContain('Adventure: 50% · 2 h');
});

test('media mix includes music and summary places series before episodes', async () => {
 extra = { Music: musicReport({Items: [{ItemType: 'Audio', Name: 'Track', ActiveSeconds: 4200, PlayCount: 1}]}) };
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('.jfw-rewind-mix h3')?.textContent).toBe('Your media mix');
 expect(root.querySelector('.jfw-rewind-mix svg')?.getAttribute('aria-label')).toContain('Music: 50% · 1.2 h');
 expect(Array.from(root.querySelectorAll('.jfw-rewind-stat h3 span'), cell => cell.textContent).slice(0, 4)).toEqual(['Hours watched', 'Films', 'Series', 'Episodes']);
});

test('combined streak includes music and exposes separate video and music counts', async () => {
 extra = { Insights: insights(), ActivityStreak: {Days: 5, Start: '2026-06-01', End: '2026-06-05'},
  Music: musicReport({ReconstructedItemCount: 0, Insights: {...insights(), LongestStreakDays: 3}}) };
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('.jfw-rewind-streak-length')?.textContent).toBe('5 days');
 expect(root.querySelector('.jfw-rewind-streak')?.textContent).toContain('06/01/2026 – 06/05/2026');
 expect(root.querySelector('.jfw-rewind-streak-video strong')?.textContent).toBe('2');
 expect(root.querySelector('.jfw-rewind-streak-music strong')?.textContent).toBe('3');
});

test('music-only measured streak renders even when video insights are unavailable', async () => {
 extra = { Items: [], Insights: null, ActivityStreak: {Days: 3, Start: '2026-06-01', End: '2026-06-03'},
  Music: musicReport({ReconstructedItemCount: 0, Insights: {...insights(), LongestStreakDays: 3}}) };
 loadYearlyRewindBundle(); await flush();
 expect(root.querySelector('.jfw-rewind-streak-length')?.textContent).toBe('3 days');
 expect(root.querySelector('.jfw-rewind-streak-video strong')?.textContent).toBe('—');
 expect(root.querySelector('.jfw-rewind-streak-music strong')?.textContent).toBe('3');
});
