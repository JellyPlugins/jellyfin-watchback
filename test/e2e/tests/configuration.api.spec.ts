import {test, expect} from '@playwright/test';
import {apiContext, normalUserContext, loadAuth, p} from '../setup/api-client.ts';
test('standalone identity, elevated settings and validated dates',async()=>{
  const admin=await apiContext(loadAuth());const user=await normalUserContext(loadAuth());
  if(!user) throw new Error('The non-admin fixture is required.');
  const original=await(await admin.get(p('Configuration'))).json();
  try {
    const plugins=await(await admin.get('/Plugins')).json();
    expect(plugins.some((plugin:any)=>plugin.Name==='jellyfin-watchback'&&plugin.Status==='Active')).toBe(true);
    expect(plugins.some((plugin:any)=>plugin.Id.replaceAll('-','')==='0c7376455cbb4bd880c7d377b560aaa4')).toBe(false);
    expect((await user.get(p('Configuration'))).status()).toBe(403);
    expect((await user.put(p('Configuration'),{data:{YearlyRewindEnabled:true}})).status()).toBe(403);
    for(const invalid of ['02-29','13-01','04-31','']) {
      expect((await admin.put(p('Configuration'),{data:{YearlyRewindStartDate:invalid}})).status()).toBe(400);
    }
    expect((await(await admin.get(p('Configuration'))).json()).YearlyRewindStartDate).toBe(original.YearlyRewindStartDate);
    expect((await user.get('/Watchback/Translations?lang=de')).ok()).toBe(true);
    expect((await user.get('/Watchback/Translations?lang=../../bad')).status()).toBe(400);
  } finally {await admin.put(p('Configuration'),{data:original});await admin.dispose();await user.dispose();}
});
