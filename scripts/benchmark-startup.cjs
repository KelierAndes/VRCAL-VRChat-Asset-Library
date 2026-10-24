// Offline, isolated Windows benchmark. Never attaches to or closes a user app.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const os=require('node:os'),hardware={cpu:os.cpus()[0]?.model,logicalProcessors:os.cpus().length,totalMemoryBytes:os.totalmem(),freeMemoryBytesAtStart:os.freemem(),platform:os.platform(),release:os.release()};
const {spawn,execFileSync}=require('node:child_process'),{parseArgs}=require('node:util'),{performance}=require('node:perf_hooks');
const {DatabaseSync}=require('node:sqlite'),{chromium}=require('playwright'),{Store}=require('../dist/main/main/store');
const {values}=parseArgs({options:{executable:{type:'string'},label:{type:'string'},count:{type:'string',default:'300'},runs:{type:'string',default:'4'},settle:{type:'string',default:'8000'},output:{type:'string'}}});
const executable=values.executable&&path.resolve(values.executable),count=Number(values.count),runs=Number(values.runs),settle=Number(values.settle);
if(!executable||!fs.existsSync(executable)||!Number.isInteger(count)||count<1||count>10000||!Number.isInteger(runs)||runs<2||runs>10||!Number.isInteger(settle)||settle<2000||settle>60000)throw Error('Pass --executable and bounded --count/--runs/--settle');
const repo=path.resolve(__dirname,'..'),run=values.output?path.resolve(values.output):fs.mkdtempSync(path.resolve(repo,'../performance-'));
if(fs.existsSync(path.join(run,'Library')))throw Error('Choose a new isolated output; an existing profile is never overwritten');
const root=path.join(run,'Synthetic Sources'),profile=path.join(run,'Library');fs.mkdirSync(root,{recursive:true});
const source=path.join(root,'read-only.txt');fs.writeFileSync(source,'Synthetic performance source.\n',{flag:'wx'});
const stamp=()=>({bytes:fs.statSync(source).size,mtimeMs:fs.statSync(source).mtimeMs,sha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')});
const before=stamp(),seed=new Store(profile,[root]);seed.saveSettings({onlineEnabled:false,xianyuEnabled:false,language:'zh-CN',theme:'x',xThemeIntroduced:true});seed.close();
const db=new DatabaseSync(path.join(profile,'library.sqlite')),put=db.prepare('INSERT INTO assets(id,path,record) VALUES(?,?,?)'),now='2026-10-24T00:00:00.000Z';db.exec('BEGIN');
for(let i=0;i<count;i++){
 const id=crypto.createHash('sha256').update('performance-material-'+i).digest('hex').slice(0,24),name='Synthetic_'+id+'.zip',file=path.join(root,name);
 const record={id,path:file,name,group:'Synthetic benchmark',kind:'archive',size:1048576,mtimeMs:1792800000000,missing:false,localCategory:'服装',localAvatars:['Shinano'],localEvidence:[],compatibilityComplete:true,localNameHints:[],hintUrls:[],manual:{tags:['Synthetic']},online:{status:'pending',description:'Synthetic description. '.repeat(45)},createdAt:now,updatedAt:now};
 put.run(id,file,JSON.stringify(record));
}
db.exec('COMMIT');db.close();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function memory(rootPid){
 const script=`[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$all=@(Get-CimInstance Win32_Process);$owned=[System.Collections.Generic.HashSet[int]]::new();[void]$owned.Add(${rootPid});do{$added=$false;foreach($p in $all){if($owned.Contains([int]$p.ParentProcessId)-and !$owned.Contains([int]$p.ProcessId)){[void]$owned.Add([int]$p.ProcessId);$added=$true}}}while($added);$metrics=@(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process);$rows=@(foreach($p in $all){if($owned.Contains([int]$p.ProcessId)){if($p.Name -notlike '*VRC*'){throw 'Unexpected owned executable'};$m=$metrics|Where-Object IDProcess -eq $p.ProcessId|Select-Object -First 1;if(!$m){throw 'Missing live process counter'};[pscustomobject]@{pid=$p.ProcessId;name=$p.Name;privateResidentBytes=[long]$m.WorkingSetPrivate;committedPrivateBytes=[long]$m.PrivateBytes;workingSetBytes=[long]$m.WorkingSet}}});[pscustomobject]@{processes=$rows;privateResidentBytes=($rows|Measure-Object privateResidentBytes -Sum).Sum;committedPrivateBytes=($rows|Measure-Object committedPrivateBytes -Sum).Sum;workingSetSumBytes=($rows|Measure-Object workingSetBytes -Sum).Sum}|ConvertTo-Json -Depth 4 -Compress`;
 return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:20000}));
}
const samples=[];let child,browser;
async function launch(index){
 const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 const started=performance.now();child=spawn(executable,['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{windowsHide:true,stdio:'ignore',env:{...process.env,VRC_LIBRARY_DATA_DIR:profile,VRC_LIBRARY_ROOT:root,VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_NO_RELAUNCH:'1',VRC_LIBRARY_NO_EDITOR_LAUNCH:'1',VRC_LIBRARY_TEST_HIDDEN:''}});
 let ended=false;child.once('exit',()=>ended=true);const deadline=started+120000;
 while(true){try{if((await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(500)})).ok)break}catch{}if(ended||performance.now()>deadline)throw Error('Isolated application did not start');await sleep(25)}
 const debugReadyMs=performance.now()-started;browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);let page;
 while(!page){page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('/renderer/index.html'));if(performance.now()>deadline)throw Error('Main page missing');if(!page)await sleep(25)}
 await page.locator('.asset-grid[aria-busy="false"] .asset-card').first().waitFor({state:'visible',timeout:60000});
 await page.getByLabel('搜索素材',{exact:true}).waitFor({state:'visible'});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const usableGalleryMs=performance.now()-started,state=await page.evaluate(async()=>({version:(await window.library.updateState()).currentVersion,snapshot:await window.library.snapshot()}));
 if(state.snapshot.settings.dataDir!==profile||state.snapshot.stats.total!==count)throw Error('Wrong profile or synthetic corpus');
 await sleep(settle);const measured=memory(child.pid),sample={index,profileState:index?'initialized':'first-browser-profile',debugReadyMs,usableGalleryMs,version:state.version,visibleCards:await page.locator('.asset-card').count(),memory:measured};samples.push(sample);console.log(JSON.stringify({sample:index,version:sample.version,usableGalleryMs:Math.round(usableGalleryMs),privateResidentMiB:Math.round(measured.privateResidentBytes/104857.6)/10,committedPrivateMiB:Math.round(measured.committedPrivateBytes/104857.6)/10}));
 const session=await browser.newBrowserCDPSession();await Promise.race([session.send('Browser.close').catch(()=>{}),sleep(3000)]);await browser.close().catch(()=>{});browser=undefined;
 const closeDeadline=Date.now()+120000;while(!ended&&Date.now()<closeDeadline)await sleep(100);if(!ended)throw Error('Owned launcher did not finish cleanup');child=undefined;
 if(JSON.stringify(stamp())!==JSON.stringify(before))throw Error('Synthetic source changed');await sleep(300);
}
(async()=>{
 for(let i=0;i<runs;i++)await launch(i);
 const median=xs=>{xs=[...xs].sort((a,b)=>a-b);const mid=Math.floor(xs.length/2);return xs.length%2?xs[mid]:(xs[mid-1]+xs[mid])/2};
 const report={ok:true,label:values.label||'',executable,hardware,corpus:{records:count,covers:0,descriptionCharacters:'Synthetic description. '.repeat(45).length,network:false,autoscan:false,cloudCaptures:0},method:{startup:'Process spawn to visible, loaded gallery plus two animation frames; includes loopback test attachment overhead.',profile:'First browser profile then same-profile process restarts; OS file cache is not cleared. No claim of OS cold boot.',memory:'Sum Windows WorkingSetPrivate across the owned launcher/main/GPU/utility/renderer process tree after settle; private commit separate; shared working-set sum is not unique physical RAM.',settleMs:settle,forcedGc:false,gpuDisabled:false,visible:true},samples,summary:{firstProfileMs:samples[0].usableGalleryMs,initializedMedianMs:median(samples.slice(1).map(s=>s.usableGalleryMs)),privateResidentMedianBytes:median(samples.map(s=>s.memory.privateResidentBytes)),committedPrivateMedianBytes:median(samples.map(s=>s.memory.committedPrivateBytes))},source:{name:path.basename(source),...before}};
 fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,run,summary:report.summary}));
})().catch(async error=>{console.error(error);if(browser){try{const session=await browser.newBrowserCDPSession();await session.send('Browser.close')}catch{}await browser.close().catch(()=>{})}if(child&&child.exitCode===null&&child.signalCode===null)child.kill();process.exitCode=1});
