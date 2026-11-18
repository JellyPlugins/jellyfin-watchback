import {afterAll, beforeEach, expect, test, vi} from 'vitest';
import {loadSettingsBundle, saveCoverage, type UiBridge} from '../src/loader.js';
let ui: UiBridge;
let cfg: any;
let client: any;
let writes: any[];
const flush = async () => {for(let i=0;i<15;i++) await Promise.resolve();};
beforeEach(async () => {
  cfg={YearlyRewindEnabled:true,YearlyRewindStartDate:'12-15',YearlyRewindEndDate:'01-15',Language:'en'};
  writes=[];
  document.documentElement.lang='en';
  document.body.innerHTML='<div id="WatchbackConfigPage"><form id="settingsForm" class="settings-form"></form></div>';
  delete (window as any).WatchbackUi;
  client={getUrl:(path:string)=>path,ajax:vi.fn((options:any)=>{
    if(options.type==='PUT'){const value=JSON.parse(options.data);writes.push(value);Object.assign(cfg,Object.fromEntries(Object.entries(value).filter(([,value])=>value!==null)));return Promise.resolve(cfg);}
    return Promise.resolve(options.url.includes('Translations')?{}:{...cfg});
  })};
  (globalThis as any).ApiClient=client;
  ui=loadSettingsBundle();
  await ui.loadSettings();await flush();
});
afterAll(saveCoverage);
const field=(name:string)=>document.getElementById(name) as HTMLInputElement;
const change=(name:string,value:string)=>{field(name).value=value;field(name).dispatchEvent(new Event('input',{bubbles:true}));};
test('loads settings as an always-visible section without collapse controls',()=>{
  expect(field('cfgYearlyRewindEnabled').checked).toBe(true);
  change('cfgRewindStartDay','10');
  expect(document.getElementById('rewindSettingsTitle')).toBeNull();
  expect(document.querySelector('.settings-card')!.firstElementChild!.className).toBe('checkbox-row');
  expect(document.querySelector('.arr-collapsible-header')).toBeNull();
  expect(field('cfgRewindStartDay').closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
  expect(ui.buildSettingsPayload().YearlyRewindStartDate).toBe('12-10');
});
test.each([['','12'],['0','12'],['32','12'],['1','0'],['1','13'],['31','4'],['29','2']])('invalid date %s/%s cannot be saved and reveals the error',async(day,month)=>{
  change('cfgRewindStartDay',day);change('cfgRewindStartMonth',month);
  await ui.saveSettings();
  expect(writes).toHaveLength(0);
  expect(document.getElementById('cfgRewindStartError')!.hidden).toBe(false);
  expect(document.activeElement!.getAttribute('aria-invalid')).toBe('true');
});
test('correction clears field errors and saves the validated values',async()=>{
  change('cfgRewindStartDay','31');change('cfgRewindStartMonth','4');
  change('cfgRewindStartDay','30');await ui.saveSettings();
  expect(writes).toHaveLength(1);
  expect(writes[0]).not.toHaveProperty('Language');
  expect(writes[0].YearlyRewindStartDate).toBe('04-30');
  expect(field('cfgRewindStartDay').getAttribute('aria-invalid')).toBeNull();
  expect(document.getElementById('settingsSaveBand')!.getAttribute('aria-hidden')).toBe('true');
  expect(document.getElementById('settingsMsg')!.textContent).toBe('');
  expect(document.getElementById('settingsMsg')!.hidden).toBe(true);
  expect(document.querySelector('.settings-save-band-text')).toBeNull();
});
test('disabled display preserves stored dates by sending null and disables date controls',async()=>{
  field('cfgYearlyRewindEnabled').checked=false;
  field('cfgYearlyRewindEnabled').dispatchEvent(new Event('change',{bubbles:true}));
  expect((document.getElementById('cfgRewindDates') as HTMLFieldSetElement).disabled).toBe(true);
  await ui.saveSettings();
  expect(writes[0]).toMatchObject({YearlyRewindEnabled:false,YearlyRewindStartDate:null,YearlyRewindEndDate:null});
});
test('server rejection retains unsaved state and permits retry',async()=>{
  change('cfgRewindEndDay','14');
  client.ajax.mockRejectedValueOnce(new Error('offline'));
  await ui.saveSettings();
  expect(document.getElementById('settingsMsg')!.textContent).toContain('Could not save');
  expect(field('btnSaveSettings').disabled).toBe(false);
  expect(document.getElementById('settingsSaveBand')!.getAttribute('aria-hidden')).toBe('false');
  await ui.saveSettings();expect(writes).toHaveLength(1);
});
test('edits made during a save remain dirty and duplicate saves are suppressed',async()=>{
  let resolve!:()=>void;
  change('cfgRewindEndDay','14');
  client.ajax.mockImplementationOnce(()=>new Promise<void>(done=>{resolve=done;}));
  const pending=ui.saveSettings();await ui.saveSettings();
  change('cfgRewindEndDay','13');resolve();await pending;
  expect(document.getElementById('settingsSaveBand')!.getAttribute('aria-hidden')).toBe('false');
  await ui.saveSettings();expect(writes[0].YearlyRewindEndDate).toBe('01-13');
});
test.each([['de-DE','de'],['en-US','en'],['fr-FR','fr'],['es-ES','es'],['pt-BR','pt'],['zh-Hans','zh'],['tr-TR','tr'],['sv-SE','sv'],['it-IT','en']])('uses the active Jellyfin language %s instead of the old global setting',async(language,expected)=>{
  cfg.Language='es';
  document.documentElement.lang=language;
  await ui.loadSettings();
  expect(client.ajax.mock.calls.at(-1)[0].url).toBe('Watchback/Translations?lang='+expected);
  expect(field('cfgLang')).toBeNull();
  expect(ui.buildSettingsPayload()).not.toHaveProperty('Language');
});
test('uses browser language when Jellyfin has not set the document language',async()=>{
  document.documentElement.lang='';
  const language=vi.spyOn(navigator,'language','get').mockReturnValue('tr-TR');
  try {
    await ui.loadSettings();
    expect(client.ajax.mock.calls.at(-1)[0].url).toBe('Watchback/Translations?lang=tr');
  } finally {language.mockRestore();}
});
test('failed initial load offers a retry, and viewshow refreshes configuration',async()=>{
  client.ajax.mockRejectedValueOnce(new Error('offline'));
  await ui.loadSettings();
  expect(document.querySelector('#settingsForm button')!.textContent).toBe('Try again');
  (document.querySelector('#settingsForm button') as HTMLButtonElement).click();await flush();
  expect(document.getElementById('cfgRewindStartDay')).not.toBeNull();
  document.getElementById('WatchbackConfigPage')!.dispatchEvent(new Event('viewshow'));await flush();
  expect(document.getElementById('cfgRewindStartDay')).not.toBeNull();
});

test('reopening settings with another Jellyfin language retains custom dates while disabled',async()=>{
  change('cfgRewindStartMonth','6');change('cfgRewindStartDay','1');await ui.saveSettings();
  field('cfgYearlyRewindEnabled').checked=false;
  field('cfgYearlyRewindEnabled').dispatchEvent(new Event('change',{bubbles:true}));
  await ui.saveSettings();
  document.documentElement.lang='de-DE';
  document.getElementById('WatchbackConfigPage')!.dispatchEvent(new Event('viewshow'));await flush();
  expect(Number(field('cfgRewindStartMonth').value)).toBe(6);
  expect(Number(field('cfgRewindStartDay').value)).toBe(1);
  field('cfgYearlyRewindEnabled').checked=true;
  field('cfgYearlyRewindEnabled').dispatchEvent(new Event('change',{bubbles:true}));
  expect(ui.buildSettingsPayload().YearlyRewindStartDate).toBe('06-01');
});
