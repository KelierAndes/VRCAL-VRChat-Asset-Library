const {_electron}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),work=path.resolve(root,'..'),area=fs.mkdtempSync(path.join(work,'archive-ui-')),materials=path.join(area,'只读素材 📦'),profile=path.join(area,'profile'),reportFile=path.join(work,'archive-ui-report.json');
fs.mkdirSync(materials);fs.mkdirSync(profile);
function emptyZip(names){let offset=0;const local=[],central=[];for(const name of names){const text=Buffer.from(name),header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(text.length,26);local.push(header,text);const index=Buffer.alloc(46);index.writeUInt32LE(0x02014b50);index.writeUInt16LE(20,4);index.writeUInt16LE(20,6);index.writeUInt16LE(0x800,8);index.writeUInt16LE(text.length,28);index.writeUInt32LE(offset,42);central.push(index,text);offset+=header.length+text.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);}
function tarHeader(name,size){const header=Buffer.alloc(512);Buffer.from(name).copy(header);header.write('0000644\0',100,'ascii');header.write(size.toString(8).padStart(11,'0'),124,'ascii');header.fill(32,148,156);header[156]=48;header.write('ustar\0',257,'ascii');header.write('00',263,'ascii');const checksum=header.reduce((sum,value)=>sum+value,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,'ascii');return header;}
function tarEntry(name,value){const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);return Buffer.concat([tarHeader(name,bytes.length),bytes,Buffer.alloc((512-bytes.length%512)%512)]);}
const paths={zip:path.join(materials,'日本語 衣服 🎀.zip'),many:path.join(materials,'many.zip'),unity:path.join(materials,'small.unitypackage'),large:path.join(materials,'large.unitypackage'),bad:path.join(materials,'broken.zip'),tar:path.join(materials,'tar-route.7z')};
fs.writeFileSync(paths.zip,emptyZip(['衣服/','衣服/愛莉.prefab','日本語/しなの.prefab','emoji/🎀.fbx','Assets/source.txt']));
fs.writeFileSync(paths.many,emptyZip(Array.from({length:2500},(_,i)=>'Assets/Airi/'+i+'.prefab')));
const entries=[];for(let i=0;i<4;i++)entries.push(tarEntry('id'+i+'/asset','Archive payload is data, never JavaScript: fetch("https://example.org/should-not-run")'),tarEntry('id'+i+'/pathname','Assets/衣服 🎀/'+i+'.prefab'));
fs.writeFileSync(paths.unity,zlib.gzipSync(Buffer.concat([...entries,Buffer.alloc(1024)])));
// One large opaque asset precedes the pathname. The reader must skip its content
// under byte/time budgets rather than materializing it or running its text.
const payloadBytes=96*1024*1024;
fs.writeFileSync(paths.large,zlib.gzipSync(Buffer.concat([tarHeader('large/asset',payloadBytes),Buffer.alloc(payloadBytes,65),tarEntry('large/pathname','Assets/大きなモデル.prefab'),Buffer.alloc(1024)]),{level:1}));
fs.writeFileSync(paths.bad,'this is not a ZIP archive');fs.writeFileSync(paths.tar,fs.readFileSync(paths.zip));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const before=Object.fromEntries(Object.values(paths).map(file=>[file,{sha256:hash(file),size:fs.statSync(file).size,mtimeMs:fs.statSync(file).mtimeMs}])),sourceNames=fs.readdirSync(materials).sort();
const fixtureFile=path.join(area,'fixture.cjs');
fs.writeFileSync(fixtureFile,String.raw`
const {app,BrowserWindow,utilityProcess,session}=require('electron');
const path=require('node:path'),childProcess=require('node:child_process');
app.setPath('userData',${JSON.stringify(profile)});app.setPath('sessionData',${JSON.stringify(profile)});
const utilityFork=utilityProcess.fork.bind(utilityProcess),spawnNative=childProcess.spawn.bind(childProcess);
const records=[],tarRecords=[];let live=0,maxLive=0,ticks=0,lastTick=Date.now(),maxGap=0;let tarAbort;
utilityProcess.fork=function(modulePath,args,options){
 const child=utilityFork(modulePath,args,options),record={modulePath,args,serviceName:options.serviceName,execArgv:options.execArgv,spawned:false,exited:false};records.push(record);
 child.on('spawn',()=>{record.spawned=true;record.pid=child.pid;record.spawnAt=Date.now();record.metrics=app.getAppMetrics().find(metric=>metric.pid===child.pid);live++;maxLive=Math.max(maxLive,live);});
 child.on('exit',code=>{record.exited=true;record.code=code;record.exitAt=Date.now();if(record.spawned)live--;});
 child.on('error',(...details)=>{record.error=details.map(String).join(' ');});return child;
};
childProcess.spawn=function(command,args,options){const child=spawnNative(command,args,options);if(/(?:^|[\\/])tar(?:\.exe)?$/i.test(command)){const record={command,args,windowsHide:options?.windowsHide,pid:child.pid};tarRecords.push(record);child.once('spawn',()=>{record.spawned=true;if(tarAbort)tarAbort.abort();});child.once('close',code=>{record.exited=true;record.code=code;});}return child;};
const {readArchive}=require(${JSON.stringify(path.join(root,'dist/main/main/archive-reader.js'))});
const sources=${JSON.stringify(paths)},roots=[${JSON.stringify(materials)}],jobs=new Map();let jobSequence=0;
function start(keys,options={}){const id=++jobSequence;const state={id,startedAt:Date.now(),ticksAtStart:ticks,done:false};jobs.set(id,state);Promise.allSettled(keys.map(key=>readArchive(sources[key],roots,options))).then(result=>{state.result=result.map(r=>r.status==='fulfilled'?{status:r.status,listing:r.value}:{status:r.status,message:r.reason.message});state.done=true;state.finishedAt=Date.now();state.ticksAtFinish=ticks;});return id;}
app.whenReady().then(async()=>{
 const window=new BrowserWindow({show:false,width:760,height:520,webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true}});await window.loadURL('data:text/html,<title>Archive fixture</title><body>0<script>let n=0;setInterval(()=>document.body.firstChild.textContent=String(++n),20)</script>');
 setInterval(()=>{const now=Date.now(),gap=now-lastTick;maxGap=Math.max(maxGap,gap);for(const state of jobs.values())if(!state.done)state.heartbeatMaxGap=Math.max(state.heartbeatMaxGap||0,gap);lastTick=now;ticks++;},10);
 globalThis.archiveTest={records,tarRecords,sources,roots,jobs,start,stats:()=>({ticks,maxGap,maxLive,live,mainPid:process.pid}),read:(key,options)=>readArchive(sources[key],roots,options),readSource:(source,options)=>readArchive(source,roots,options),
  cancelThree:async()=>{const base=records.length,controllers=[new AbortController(),new AbortController(),new AbortController()];const promises=controllers.map(controller=>readArchive(sources.large,roots,{signal:controller.signal,maxBytes:128*1024*1024,maxTime:4000}));const settled=Promise.allSettled(promises);for(let i=0;i<200&&records.filter(record=>record.spawned).length<base+2;i++)await new Promise(r=>setTimeout(r,5));controllers[2].abort();controllers[0].abort();controllers[1].abort();return (await settled).map(r=>({status:r.status,message:r.status==='rejected'?r.reason.message:'unexpected completion'}));},
  tarCancel:async()=>{tarAbort=new AbortController();try{await readArchive(sources.tar,roots,{signal:tarAbort.signal,maxTime:3000});return {rejected:false};}catch(error){return {rejected:true,message:error.message};}finally{tarAbort=undefined;}},
  networkProbe:async()=>{const offline=session.fromPartition('vrc-archive-offline');try{await offline.fetch('https://example.org/archive-readonly-probe');return {blocked:false};}catch(error){return {blocked:/ERR_BLOCKED_BY_CLIENT|ERR_FAILED|net::/.test(error.message),error:error.message};}}
 };
});app.on('window-all-closed',()=>app.quit());
`);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={ok:false,checks:[],area,profile,fixtureOnly:true,tarFixture:'ZIP archive bytes with .7z extension, used only to select the external-Tar control path and verify native-process cancellation',scope:'fixed read-only parsers, independent utility processes, realpath roots, offline Electron session, V8 160 MiB heap flag and read budgets; not an OS AppContainer'};
(async()=>{
 const app=await _electron.launch({executablePath:require('electron'),args:[fixtureFile],env:{...process.env,VRC_LIBRARY_TEST_HIDDEN:'1'}});
 const check=(condition,message,detail)=>{report.checks.push({message,ok:!!condition,...(detail===undefined?{}:{detail})});assert(condition,message);};
 const main=fn=>app.evaluate(fn);
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>document.title==='Archive fixture');for(let i=0;i<100;i++){if(await main(()=>!!globalThis.archiveTest))break;await wait(10);}
  const zip=await main(()=>globalThis.archiveTest.read('zip',{limit:3,maxTime:3000}));check(zip.entries.length===3&&zip.truncated,'ZIP entry limit honored',zip);check(zip.entries[1].name==='衣服/愛莉.prefab','Unicode paths survive utility IPC');
  const unity=await main(()=>globalThis.archiveTest.read('unity',{limit:2,maxTime:3000}));check(unity.entries.length===2&&unity.truncated,'Unitypackage entry limit honored',unity);
  const bytes=await main(()=>globalThis.archiveTest.read('large',{maxBytes:64*1024,maxTime:3000}));check(bytes.truncated&&bytes.entries.length===0,'decompressed-byte budget stops before the late pathname',bytes);
  const previousProcesses=await main(()=>globalThis.archiveTest.records.length);
  const job=await main(()=>globalThis.archiveTest.start(['large','large'],{maxBytes:128*1024*1024,maxTime:4000}));
  for(let i=0;i<200;i++){if(await app.evaluate((_e,offset)=>globalThis.archiveTest.records.slice(offset).filter(record=>record.spawned).length>=2,previousProcesses))break;await wait(5);}
  await wait(35);
  const busy=await app.evaluate(({app},offset)=>{const fixture=globalThis.archiveTest,records=fixture.records.slice(offset),pids=new Set(records.map(record=>record.pid));return {live:records.filter(record=>record.spawned&&!record.exited).length,metrics:app.getAppMetrics().filter(metric=>pids.has(metric.pid))};},previousProcesses);
  check(busy.live>=2,'ping is sampled after both native workers spawn and before they finish',busy);
  check(busy.metrics.length>=2&&busy.metrics.every(metric=>metric.type==='Utility'&&metric.name==='素材包只读解析'),'native Electron process metrics identify the real named utility services',busy.metrics);
  const pingAt=Date.now(),ping=await main(()=>({pong:true,...globalThis.archiveTest.stats()}));check(ping.pong&&Date.now()-pingAt<1500,'main-process ping returns while large parsers run',{elapsedMs:Date.now()-pingAt});
  for(let i=0;i<300;i++){if(await app.evaluate((_e,id)=>globalThis.archiveTest.jobs.get(id).done,job))break;await wait(10);}
  const parallel=await app.evaluate((_e,id)=>globalThis.archiveTest.jobs.get(id),job);check(parallel.done&&parallel.result.every(r=>r.status==='fulfilled'),'two real utility parser jobs finish',parallel);check(parallel.ticksAtFinish-parallel.ticksAtStart>2,'main heartbeat continues during large gzip parsing',{ticks:parallel.ticksAtFinish-parallel.ticksAtStart});
  check(parallel.heartbeatMaxGap<150,'main heartbeat has no long stall within the gzip parsing interval',{maxGapMs:parallel.heartbeatMaxGap});
  const stats=await main(()=>globalThis.archiveTest.stats());check(stats.maxLive>=2,'at least two independent utility processes overlap',stats);
  const workerProof=await main(()=>globalThis.archiveTest.records.filter(record=>record.spawned));check(workerProof.length>=5&&workerProof.every(record=>record.pid&&record.pid!==process.pid&&record.serviceName==='素材包只读解析'),'actual parser PIDs are separate from main and have the expected serviceName',workerProof.map(record=>({pid:record.pid,name:record.serviceName,metricType:record.metrics?.type,metricName:record.metrics?.name})));check(workerProof.every(record=>record.execArgv?.includes('--max-old-space-size=160')),'V8 heap cap flag passed to every real utility fork');
  const timedAt=Date.now(),timed=await main(()=>globalThis.archiveTest.read('large',{maxBytes:128*1024*1024,maxTime:100}));check(timed.truncated&&Date.now()-timedAt<2000,'short time budget produces a bounded truncated response',{elapsedMs:Date.now()-timedAt,listing:timed});
  const cancelled=await main(()=>globalThis.archiveTest.cancelThree());check(cancelled.length===3&&cancelled.every(r=>r.status==='rejected'&&/取消/.test(r.message)),'active and queued jobs cancel independently',cancelled);
  const recovered=await main(()=>globalThis.archiveTest.read('zip',{maxTime:3000}));check(recovered.entries.length===5,'good archive remains readable after cancellations');
  const corrupt=await main(async()=>{try{await globalThis.archiveTest.read('bad',{maxTime:3000});return {rejected:false};}catch(error){return {rejected:true,message:error.message};}});check(corrupt.rejected,'bad archive failure stays in its own process',corrupt);check((await main(()=>globalThis.archiveTest.read('zip',{maxTime:3000}))).entries.length===5,'next good archive succeeds after a corrupt input');
  const maxEntries=await main(()=>globalThis.archiveTest.read('many',{limit:10000,maxTime:3000}));check(maxEntries.entries.length===2000&&maxEntries.truncated,'response cannot exceed the hard 2000-entry cap');
  const outside=path.join(area,'outside.zip');fs.writeFileSync(outside,emptyZip(['private.prefab']));const denied=await app.evaluate(async(_e,file)=>{try{await globalThis.archiveTest.readSource(file);return false;}catch{return true;}},outside);check(denied,'realpath roots reject unauthorized sources');
  const tar=await main(()=>globalThis.archiveTest.tarCancel());check(tar.rejected&&/取消/.test(tar.message),'Tar route can be cancelled after its independent native process spawns',tar);const tarProof=await main(()=>globalThis.archiveTest.tarRecords);check(tarProof.some(record=>record.spawned&&record.pid&&record.windowsHide===true),'Tar is a hidden independent child process',tarProof);
  const offline=await main(()=>globalThis.archiveTest.networkProbe());check(offline.blocked,'the parser Electron session rejects network requests',offline);
  const rendererTicks=await page.evaluate(()=>document.body.firstChild.textContent);check(Number(rendererTicks)>3,'hidden renderer remains responsive through its own JavaScript heartbeat');
  const after=Object.fromEntries(Object.values(paths).map(file=>[file,{sha256:hash(file),size:fs.statSync(file).size,mtimeMs:fs.statSync(file).mtimeMs}]));check(JSON.stringify(after)===JSON.stringify(before),'all source archives retain hash, size and timestamps');check(JSON.stringify(fs.readdirSync(materials).sort())===JSON.stringify(sourceNames),'no archive entry is extracted or written into the source fixture');
  report.ok=true;report.processes=await main(()=>globalThis.archiveTest.records);report.stats=await main(()=>globalThis.archiveTest.stats());report.sourceHashes=after;console.log(JSON.stringify({ok:true,checks:report.checks.length,maxParallelUtilities:report.stats.maxLive,fixtureOnly:true,reportFile}));
 }catch(error){report.error=error.stack||String(error);report.processes=await main(()=>globalThis.archiveTest?.records||[]).catch(()=>[]);report.stats=await main(()=>globalThis.archiveTest?.stats()).catch(()=>undefined);throw error;}
 finally{fs.writeFileSync(reportFile,JSON.stringify(report,null,2));await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
