import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve, extname} from 'node:path';
const root=resolve(import.meta.dirname, '../../..');
const types: Record<string,string>={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
for(const language of ['en','de','fr','es','pt','zh','tr','sv']) {
  for(const width of [320,1440]) {
    test(`demo and separate settings fixture ${language} at ${width}px`,async({page})=>{
      const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
      await page.setViewportSize({width,height:900});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.route('https://demo.test/**',route=>{
        const url=new URL(route.request().url());
        if (url.pathname === '/settings-fixture.html') {
          return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head>
            <link rel="stylesheet" href="css/Shared.css"><link rel="stylesheet" href="css/Settings.css">
            <style>body{margin:0;background:#101010;color:#eee;font:16px system-ui}main{max-width:1200px;margin:auto;padding:1rem}[hidden]{display:none!important}</style>
            </head><body class="jfw-ui-surface"><main><div id="WatchbackConfigPage"><form id="settingsForm" class="settings-form" novalidate></form></div></main>
            <script src="js/mock-data.js"></script><script>
              var config={YearlyRewindEnabled:true,YearlyRewindStartDate:'12-15',YearlyRewindEndDate:'01-15'};
              var rewindAjax=ApiClient.ajax;
              ApiClient.ajax=function(options){
                if(options.url.includes('Configuration')){
                  if(options.type==='PUT')Object.assign(config,JSON.parse(options.data));
                  return Promise.resolve({...config});
                }
                return rewindAjax(options);
              };
            </script><script src="js/Shared.js"></script><script src="js/UiPrimitives.js"></script><script src="js/Settings.js"></script><script src="js/Main.js"></script>
            </body></html>`});
        }
        const path=resolve(root,'docs','.'+(url.pathname==='/'?'/index.html':url.pathname));
        if(!path.startsWith(resolve(root,'docs')+'/')) throw new Error('Unsafe fixture path');
        route.fulfill({body:readFileSync(path),contentType:types[extname(path)]||'application/octet-stream'});
      });
      await page.goto('https://demo.test/?lang='+language);
      const strings=JSON.parse(readFileSync(resolve(root,'Jellyfin.Plugin.Watchback/i18n/'+language+'.json'),'utf8'));
      await expect(page.locator('.jfw-rewind-heading')).toContainText(strings['rewind.title']);
      await expect(page.locator('.jfw-rewind-heading')).toContainText('2026');
      await expect(page.locator('#demoReport > .jfw-rewind-stats .jfw-rewind-stat')).toHaveCount(8);
      const music=page.locator('#demoReport');
      await expect(music.locator('.jfw-rewind-music')).toHaveCount(0);
      await expect(music.locator('.jfw-rewind-stats')).toHaveCount(1);
      await expect(music.locator('.jfw-rewind-stat')).toHaveCount(8);
      await expect(music.locator('.jfw-rewind-stat').nth(6)).toContainText(strings['rewind.tracks']);
      await expect(music.locator('.jfw-rewind-stat strong').nth(6)).toHaveText('8');
      await expect(music.locator('.jfw-rewind-stat strong').nth(7)).toHaveText('432');
      await expect(music.locator('.jfw-rewind-top-tracks h3')).toHaveText(strings['rewind.topTracks']);
      await expect(music.locator('.jfw-rewind-top-tracks li')).toHaveCount(5);
      await expect(music.locator('.jfw-rewind-top-tracks li').first()).toContainText('Neon Skyline');
      await expect(music.locator('.jfw-rewind-stat').nth(2)).toContainText(strings['rewind.series']);
      await expect(music.locator('.jfw-rewind-stat').nth(3)).toContainText(strings['rewind.episodes']);
      await expect(music.locator('.jfw-rewind-mix h3')).toHaveText(strings['rewind.mediaMix']);
      await expect(music.locator('.jfw-rewind-mix .jfw-rewind-pie')).toHaveAttribute('aria-label',new RegExp(strings['rewind.musicMedia']));
      await expect(music.locator('.jfw-rewind-streak-length')).toContainText('13');
      await expect(music.locator('.jfw-rewind-streak-video strong')).toHaveText('7');
      await expect(music.locator('.jfw-rewind-streak-music strong')).toHaveText('10');
      for (const selector of ['.jfw-rewind-genres','.jfw-rewind-music-genres']) {
        const chart=music.locator(selector);
        const button=chart.locator('h3 button');
        const info=chart.locator('.jfw-rewind-genre-info');
        await expect(chart.locator('label')).toHaveCount(0);
        await expect(button).toHaveAttribute('aria-expanded','false');
        await expect(info).toBeHidden();
        await button.click();
        await expect(info).toBeVisible();
        await expect(info).toHaveText(strings['rewind.genreInfo']);
        await expect(info).toHaveCSS('color','rgb(0, 164, 220)');
        const positions=await chart.evaluate(element=>{
          const info=element.querySelector('.jfw-rewind-genre-info')!.getBoundingClientRect();
          const controls=element.querySelector('.jfw-rewind-genre-controls')!.getBoundingClientRect();
          const count=element.querySelector('.jfw-rewind-genre-controls p')!.getBoundingClientRect();
          const select=element.querySelector('select')!.getBoundingClientRect();
          return {infoBottom:info.bottom,controlsTop:controls.top,controlsRight:controls.right,selectRight:select.right,countCenter:count.y+count.height/2,selectCenter:select.y+select.height/2};
        });
        expect(positions.infoBottom).toBeLessThanOrEqual(positions.controlsTop);
        expect(positions.selectRight).toBeCloseTo(positions.controlsRight,0);
        expect(positions.countCenter).toBeCloseTo(positions.selectCenter,0);
        await button.click(); await expect(info).toBeHidden();
      }
      const genres=music.locator('.jfw-rewind-music-genres .jfw-rewind-pie');
      await expect(genres).toHaveAttribute('aria-label',new RegExp(strings['rewind.musicGenres']));
      const annualGenres=await genres.getAttribute('aria-label');
      await music.locator('.jfw-rewind-music-genres select').selectOption('0');
      await expect(genres).not.toHaveAttribute('aria-label',annualGenres!);
      await music.locator('.jfw-rewind-music-genres select').selectOption('all');
      await expect(genres).toHaveAttribute('aria-label',annualGenres!);
      await expect(music.locator('.jfw-rewind-music-months h3')).toContainText(strings['rewind.musicMonths']);
      await expect(music.locator('.jfw-rewind-music-months [role="listitem"]')).toHaveCount(12);
      const comparison=music.locator('.jfw-rewind-comparison-table tbody tr');
      await expect(comparison).toHaveCount(8);
      await expect(comparison.nth(5).locator('th')).toHaveText(strings['rewind.listeningHours']);
      await expect(comparison.nth(5).locator('td').nth(1)).toHaveText('22');
      await expect(comparison.nth(6).locator('td').nth(1)).toHaveText('6');
      await expect(comparison.nth(7).locator('td').nth(1)).toHaveText('320');
      expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth)).toBe(true);
      await expect(page.locator('[data-demo-view], #demoSettings, #settingsForm')).toHaveCount(0);
      await page.goto('https://demo.test/settings-fixture.html?lang='+language);
      await expect(page.locator('#rewindSettingsTitle')).toHaveCount(0);
      await expect(page.locator('#cfgLang')).toHaveCount(0);
      await expect(page.locator('label[for="cfgYearlyRewindEnabled"]')).toHaveText(strings['rewind.enable']);
      await expect(page.locator('#cfgYearlyRewindEnabled')).toBeVisible();
      await expect(page.locator('.arr-collapsible-header')).toHaveCount(0);
      for(const prefix of ['Start','End']) {
        const boxes=await page.evaluate(prefix=>{
          const day=document.getElementById('cfgRewind'+prefix+'Day')!.getBoundingClientRect();
          const month=document.getElementById('cfgRewind'+prefix+'Month')!.getBoundingClientRect();
          return {day:{x:day.x,y:day.y,width:day.width},month:{x:month.x,y:month.y}};
        },prefix);
        expect(boxes.day.y).toBe(boxes.month.y);
        expect(boxes.month.x).toBeGreaterThanOrEqual(boxes.day.x+boxes.day.width);
      }
      await page.locator('#cfgRewindStartDay').fill('31');
      await page.locator('#cfgRewindStartMonth').fill('4');
      await expect(page.locator('#cfgRewindStartError')).toBeVisible();
      await expect(page.locator('.settings-save-band-text')).toHaveCount(0);
      const centers=await page.evaluate(()=>{
        const band=document.getElementById('settingsSaveBand')!.getBoundingClientRect();
        const button=document.getElementById('btnSaveSettings')!.getBoundingClientRect();
        return {band:band.x+band.width/2,button:button.x+button.width/2};
      });
      expect(centers.button).toBeCloseTo(centers.band,1);
      await page.locator('#btnSaveSettings').click();
      await expect(page.locator('#cfgRewindStartDay')).toBeFocused();
      await page.locator('#cfgRewindStartDay').fill('30');
      await page.locator('#btnSaveSettings').click();
      await expect(page.locator('#settingsSaveBand')).toHaveAttribute('aria-hidden','true');
      await expect(page.locator('#settingsMsg')).toBeHidden();
      expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
