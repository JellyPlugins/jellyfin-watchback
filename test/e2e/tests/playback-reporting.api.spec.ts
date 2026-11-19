import {test, expect, request} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID, createHash} from 'node:crypto';
import {readFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {apiContext, loadAuth, p, authHeader} from '../setup/api-client.ts';
import {rewindDataDir, rewindPath, visibleRewindWindow} from '../setup/yearly-rewind.ts';

const field=(value:any,key:string)=>value[key]??value[key[0].toLowerCase()+key.slice(1)];
test('imports retained Playback Reporting history once and keeps the published rewind frozen',async()=>{
  test.setTimeout(180000);
  const auth=loadAuth();
  const admin=await apiContext(auth);
  const original=await(await admin.get(p('Configuration'))).json();
  let userId='';
  let user:Awaited<ReturnType<typeof request.newContext>>|undefined;
  let seed:DatabaseSync|undefined;
  const source=join(dirname(rewindDataDir()),'playback_reporting.db');
  const digest=()=>createHash('sha256').update(readFileSync(source)).digest('hex');
  const window=visibleRewindWindow();
  try {
    const plugins=await(await admin.get('/Plugins')).json();
    expect(plugins.some((plugin:any)=>field(plugin,'Id').replaceAll('-','')==='5c53438191a343cb907a35aa02eb9d2c')).toBe(true);
    expect((await admin.put(p('Configuration'),{data:{...original,YearlyRewindEnabled:false}})).ok()).toBe(true);
    // Hold the optional source until the new user's historical row is seeded.
    // Otherwise the one-time check could finish between user creation and insertion.
    seed=new DatabaseSync(source);
    seed.exec('CREATE TABLE IF NOT EXISTS PlaybackActivity (DateCreated DATETIME NOT NULL, UserId TEXT, ItemId TEXT, ItemType TEXT, ItemName TEXT, PlaybackMethod TEXT, ClientName TEXT, DeviceName TEXT, PlayDuration INT)');
    seed.exec('BEGIN EXCLUSIVE');
    const name='reporting-'+randomUUID().slice(0,8);
    const created=await admin.post('/Users/New',{data:{Name:name}});
    expect(created.ok()).toBe(true);
    userId=field(await created.json(),'Id');
    const login=await admin.post('/Users/AuthenticateByName',{data:{Username:name,Pw:''}});
    expect(login.ok()).toBe(true);
    const token=field(await login.json(),'AccessToken');
    user=await request.newContext({baseURL:auth.baseUrl,extraHTTPHeaders:{Authorization:authHeader(token)}});
    const items=await(await admin.get('/Items',{params:{userId:auth.userId,IncludeItemTypes:'Movie',Recursive:'true'}})).json();
    const item=items.Items[0];expect(item).toBeTruthy();
    const played=new Date();played.setUTCDate(played.getUTCDate()-10);
    function insert(date:Date) {
      const db=seed??new DatabaseSync(source);
      try {
        db.exec('CREATE TABLE IF NOT EXISTS PlaybackActivity (DateCreated DATETIME NOT NULL, UserId TEXT, ItemId TEXT, ItemType TEXT, ItemName TEXT, PlaybackMethod TEXT, ClientName TEXT, DeviceName TEXT, PlayDuration INT)');
        db.prepare('INSERT INTO PlaybackActivity VALUES (?,?,?,?,?,?,?,?,?)').run(date.toISOString(),userId.replaceAll('-',''),item.Id,'Movie','Historical playback fixture','DirectPlay','Historical client','Historical device',600);
      } finally {if(db!==seed)db.close();}
    }
    insert(played);
    seed.exec('COMMIT');seed.close();seed=undefined;
    const before=digest();
    expect((await admin.put(p('Configuration'),{data:{...original,YearlyRewindEnabled:true,...window}})).ok()).toBe(true);
    await expect.poll(async()=>field(await(await user!.get(p('YearlyRewind/My'))).json(),'PlaybackReportingPlayCount'),{timeout:90000}).toBe(1);
    const report=await(await user.get(p('YearlyRewind/My'))).json();
    expect(field(report,'UserId').replaceAll('-','')).toBe(userId.replaceAll('-',''));
    const imported=field(report,'Items').find((row:any)=>field(row,'PlaybackReportingPlayCount')===1);
    expect(field(imported,'ActiveSeconds')).toBe(600);
    expect(field(imported,'EstimatedSeconds')).toBe(600);
    expect(digest()).toBe(before);
    const snapshot=field(report,'SnapshotId');
    const historyFile=join(rewindDataDir(),'activity-history',userId.replaceAll('-','')+'.json');
    const history=()=>JSON.parse(readFileSync(historyFile,'utf8'));
    await expect.poll(()=>existsSync(historyFile)?history().importedPlayback.length:0).toBe(1);
    expect(history().playbackReportingImportCompleted).toBe(true);
    insert(new Date(played.getTime()-86400000));
    const afterInsert=Date.now();
    const changedSource=digest();
    // Observe continued collection before asserting that the new source row was ignored.
    const coverageEnd=()=>Math.max(...history().coverage.map((period:any)=>Date.parse(period.endUtc)));
    await expect.poll(coverageEnd,{timeout:45000}).toBeGreaterThan(afterInsert);
    expect(history().playbackReportingImportCompleted).toBe(true);
    expect(history().importedPlayback).toHaveLength(1);
    expect(digest()).toBe(changedSource);
    const frozen=JSON.parse(readFileSync(rewindPath(userId),'utf8'));
    expect(frozen.snapshotId.replaceAll('-','')).toBe(snapshot.replaceAll('-',''));
    expect(field(frozen,'PlaybackReportingPlayCount')).toBe(1);
  } finally {
    try {
      if(seed){try{seed.exec('ROLLBACK');}finally{seed.close();}}
    } finally {
      try {
        expect((await admin.put(p('Configuration'),{data:original})).ok()).toBe(true);
      } finally {
        try {
          if(userId)expect((await admin.delete('/Users/'+userId)).ok()).toBe(true);
        } finally {
          try {await user?.dispose();} finally {await admin.dispose();}
        }
      }
    }
  }
});
