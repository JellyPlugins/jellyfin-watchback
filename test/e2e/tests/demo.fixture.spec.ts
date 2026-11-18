import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve, extname} from 'node:path';
const root=resolve(import.meta.dirname, '../../..');
const types: Record<string,string>={'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
for(const language of ['en','de','fr','es','pt','zh','tr','sv']) {
  for(const width of [320,1440]) {
    test(`standalone demo and settings ${language} at ${width}px`,async({page})=>{
      const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
      await page.setViewportSize({width,height:900});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.route('https://demo.test/**',route=>{
        const url=new URL(route.request().url());
        const path=resolve(root,'docs','.'+(url.pathname==='/'?'/index.html':url.pathname));
        if(!path.startsWith(resolve(root,'docs')+'/')) throw new Error('Unsafe fixture path');
        route.fulfill({body:readFileSync(path),contentType:types[extname(path)]||'application/octet-stream'});
      });
      await page.goto('https://demo.test/?lang='+language);
      const strings=JSON.parse(readFileSync(resolve(root,'Jellyfin.Plugin.Watchback/i18n/'+language+'.json'),'utf8'));
      await expect(page.locator('.jfw-rewind-heading')).toContainText(strings['rewind.title']);
      await expect(page.locator('.jfw-rewind-heading')).toContainText('2026');
      await expect(page.locator('.jfw-rewind-stat')).toHaveCount(5);
      expect(await page.locator('body').evaluate(element=>element.scrollWidth<=window.innerWidth)).toBe(true);
      await page.locator('[data-demo-view="settings"]').click();
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
