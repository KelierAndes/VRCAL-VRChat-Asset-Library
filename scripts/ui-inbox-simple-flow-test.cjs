// Real rendered app; synthetic IPC fixtures isolate all account, dialog and download effects.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright'),{Store}=require('../dist/main/main/store');
const repo=path.resolve(__dirname,'..'),run=fs.mkdtempSync(path.resolve(repo,'../ui-inbox-simple-')),profile=path.join(run,'Library'),root=path.join(run,'Synthetic Materials');fs.mkdirSync(root);
const store=new Store(profile,[root]);store.saveSettings({theme:'x',language:'zh-CN',onlineEnabled:true,xThemeIntroduced:true});store.close();
let app;const checks=[];
(async()=>{
 app=await _electron.launch({executablePath:require('electron'),args:[repo],env:{...process.env,VRC_LIBRARY_DATA_DIR:profile,VRC_LIBRARY_ROOT:root,VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_NO_RELAUNCH:'1',VRC_LIBRARY_TEST_HIDDEN:'1'}});
 const page=await app.firstWindow();await page.locator('.inbox-nav').waitFor();page.setDefaultTimeout(8000);
 await app.evaluate(({ipcMain},run)=>{
  const now=Date.now(),base={platform:'xianyu',accountKey:'synthetic',sourceUrl:'https://www.goofish.com/im',kind:'baidu',read:false,dismissed:false,codeConflict:false,completed:false,taskIds:[],discoveredAt:now,sourceAt:now-60000,code:'abcd'};
  global.simpleInbox={settings:{enabled:true,background:true,hours:24},items:[{...base,id:'ready',title:'已识别链接',url:'https://pan.baidu.com/s/1SyntheticReady'},{...base,id:'conflict',title:'提取码冲突',url:'https://pan.baidu.com/s/1SyntheticConflict',code:'',codeConflict:true},{...base,id:'booth',platform:'booth',kind:'booth',title:'已购商品',url:'https://accounts.booth.pm/orders/synthetic',code:''}],unread:2,statuses:[]};
  global.simpleDownload={phase:'idle',title:'',message:'',files:[],tasks:[],canGoBack:false,busy:false,loggedIn:true};global.simpleCalls=[];global.folderReplies=[false,true];
  for(const method of ['inboxState','baiduDownloadsState','readInboxLink','markInbox','chooseBaiduDownloadDir','downloadBaiduFile']){
   ipcMain.removeHandler('library:'+method);ipcMain.handle('library:'+method,(_e,...args)=>{
    if(method==='inboxState')return global.simpleInbox;if(method==='baiduDownloadsState')return global.simpleDownload;
    global.simpleCalls.push({method,args});
    if(method==='readInboxLink'){if(global.failNextRead){global.failNextRead=false;throw new Error('合成读取失败')}if(args[0]!=='booth')Object.assign(global.simpleDownload,{phase:'ready',title:'合成分享',files:[{id:'fixture',name:'合成素材.zip',directory:false,sizeText:'1 KB'}]});global.simpleInbox.items.find(i=>i.id===args[0]).read=true}
    if(method==='chooseBaiduDownloadDir'){const selected=global.folderReplies.shift()??false;if(selected)global.simpleDownload.downloadDir=run;return selected}
   });
  }
 },run);
 await page.locator('.inbox-nav').click();const ready=page.locator('.inbox-item').filter({has:page.getByRole('heading',{name:'已识别链接',exact:true})});
 await ready.getByRole('button',{name:'选择文件下载',exact:true}).click();
 await page.waitForFunction(async()=>(await window.library.baiduDownloadsState()).files.length===1,null,{timeout:2500});
 assert.deepEqual(await app.evaluate(()=>global.simpleCalls.filter(c=>c.method==='readInboxLink')),[{method:'readInboxLink',args:['ready','abcd']}]);checks.push('One click reads a known share using its detected code; no second confirmation');
 const file=page.locator('.baidu-share-file').filter({hasText:'合成素材.zip'}),download=file.getByRole('button',{name:'下载此文件',exact:true});await download.waitFor();assert.equal(await download.isEnabled(),true,'First download must offer directory selection instead of being disabled');
 await download.click();await page.waitForFunction(async()=>!(await window.library.baiduDownloadsState()).busy);assert.equal(await app.evaluate(()=>global.simpleCalls.filter(c=>c.method==='downloadBaiduFile').length),0,'Cancelling the folder picker must cancel download');
 await download.click();await page.waitForFunction(async()=>(await window.library.baiduDownloadsState()).downloadDir!==undefined);await download.click();
 assert.equal(await app.evaluate(()=>global.simpleCalls.filter(c=>c.method==='chooseBaiduDownloadDir').length),2);assert.equal(await app.evaluate(()=>global.simpleCalls.filter(c=>c.method==='downloadBaiduFile').length),2);checks.push('First download selects a directory and continues; cancellation stops; later downloads reuse it');
 await page.getByRole('button',{name:'时间／提取码待核对',exact:true}).click();await page.locator('.inbox-item').getByRole('button',{name:'选择文件下载',exact:true}).click();assert.equal(await app.evaluate(()=>global.simpleCalls.filter(c=>c.method==='readInboxLink').length),1);
 const selection=page.getByRole('region',{name:'所选交付链接',exact:true});await selection.getByRole('textbox').fill('wxyz');await selection.getByRole('button',{name:'读取分享文件',exact:true}).click();
 assert.deepEqual(await app.evaluate(()=>global.simpleCalls.filter(c=>c.method==='readInboxLink').at(-1)),{method:'readInboxLink',args:['conflict','wxyz']});checks.push('Conflicting codes still require a choice before reading');
 await page.getByRole('button',{name:'待下载',exact:true}).click();await page.getByRole('button',{name:'查看已购下载',exact:true}).click();assert.deepEqual(await app.evaluate(()=>global.simpleCalls.filter(c=>c.method==='readInboxLink').at(-1)),{method:'readInboxLink',args:['booth','']});checks.push('BOOTH purchased entry opens with one click');
 await app.evaluate(()=>{global.failNextRead=true});await ready.getByRole('button',{name:'选择文件下载',exact:true}).click();await page.getByRole('alert').filter({hasText:'合成读取失败'}).waitFor();await selection.getByRole('button',{name:'读取分享文件',exact:true}).click();await page.getByRole('alert').waitFor({state:'hidden'});checks.push('Failed reads keep a local retry entry without opening a browser automatically');
 await app.close();app=null;fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({ok:true,synthetic:true,checks},null,2));console.log(JSON.stringify({ok:true,run,checks}));
})().catch(async error=>{console.error(error);if(app)await app.close();process.exitCode=1});
