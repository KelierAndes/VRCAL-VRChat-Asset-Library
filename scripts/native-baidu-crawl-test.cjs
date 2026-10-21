// Native Electron/WebContentsView + ordinary DOM fixture; all HTTPS is intercepted locally.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const profile=fs.mkdtempSync(path.resolve(__dirname,'../../native-baidu-crawl-'));
fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);app.setPath('sessionData',path.join(profile,'session'));process.env.VRC_LIBRARY_TEST_HIDDEN='1';
app.on('window-all-closed',()=>{});const checks=[];let workspace;
const wait=async(fn,timeout=120000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,70))}throw new Error('Native folder reader timed out')};
app.whenReady().then(async()=>{
 const codeRoot=process.env.VRC_NATIVE_ASAR||path.resolve(__dirname,'..');
 const {BaiduWorkspace}=require(path.join(codeRoot,'dist/main/main/baidu-workspace'));
 let language='zh-CN',theme='x',pausedOnce=false;const stored=new Map();
 workspace=new BaiduWorkspace({parent:()=>null,dataDir:profile,roots:()=>[],canNetwork:()=>true,getLanguage:()=>language,getTheme:()=>theme,onChanged(){},onCapture:c=>{
  const prior=stored.get(c.directoryPath)||new Map();for(const item of c.items)prior.set(item.path,item);stored.set(c.directoryPath,prior);
  if(!pausedOnce&&c.directoryPath==='/素材'){pausedOnce=true;setTimeout(()=>workspace.scan('pause'),40)}
 }});
 workspace.publicHost=async()=>{};await workspace.initialize();
 const fixture=`<!doctype html><html><meta charset="utf-8"><style>body{font:14px sans-serif;margin:20px}.wp-s-pan-table__body{height:140px;overflow:auto}table{border-collapse:collapse;width:100%}tr{height:44px}td,th{text-align:left;padding:5px}td:nth-child(2){width:48%}</style><div class="wp-s-pan-file-main__nav-left"></div><div class="wp-s-pan-table"><div class="wp-s-pan-table__header"><table><tr><th></th><th>文件名</th><th>大小</th><th>类型</th><th>修改时间</th></tr></table></div><div class="wp-s-pan-table__body"></div></div><script>
 const tree={'/素材':[['A',true],['B',true],['Empty',true],...Array.from({length:7},(_,i)=>['衣装 日本語 😀 '+i+'.zip',false])],'/素材/A':[['A.unitypackage',false]],'/素材/B':[['B.7z',false]],'/素材/Empty':[]};
 function render(){const q=new URLSearchParams(location.hash.split('?')[1]),p=q.get('path')||'/';document.querySelector('.wp-s-pan-file-main__nav-left').replaceChildren();for(const name of ['全部文件',...p.split('/').filter(Boolean)]){const span=document.createElement('span');span.className='wp-s-pan-file-main__nav-item-title';span.textContent=name;document.querySelector('.wp-s-pan-file-main__nav-left').append(span)}const body=document.querySelector('.wp-s-pan-table__body');body.innerHTML='';body.scrollTop=0;const files=tree[p]||[];if(!files.length){body.textContent='此文件夹为空';return}const table=document.createElement('table'),rows=document.createElement('tbody');table.append(rows);body.append(table);files.forEach(([name,folder],i)=>{const row=document.createElement('tr');row.className='wp-s-pan-table__body-row';row.setAttribute('data-id',String(10000+i));for(let c=0;c<5;c++){const cell=document.createElement('td');if(c===1){const label=document.createElement('div');label.className='wp-s-pan-list__file-name-content';label.setAttribute('data-title',name);label.textContent=name.replaceAll(' ','\\u00a0');cell.append(label)}else cell.textContent=c===2?folder?'-':'1.2 MB':c===3?folder?'文件夹':'压缩包':c===4?'2026-10-21 12:00':'';row.append(cell)}rows.append(row)});if(p==='/素材'){const blank=document.createElement('div');blank.style.height='650px';body.append(blank)}}addEventListener('hashchange',render);render();</script></html>`;
 await workspace.remoteSession.protocol.handle('https',()=>new Response(fixture,{headers:{'content-type':'text/html;charset=utf-8'}}));
 await workspace.remoteSession.cookies.set({url:'https://pan.baidu.com/',name:'BDUSS',value:'SYNTHETIC_NATIVE_ONLY',domain:'.baidu.com',path:'/',secure:true,httpOnly:true});
 await workspace.open('/素材');await wait(()=>workspace.entry?.loaded);const entry=workspace.entry;
 assert.equal(await entry.view.webContents.executeJavaScript('typeof window.baiduWorkspace'),'undefined');
 const single=await workspace.capture();assert(single.items.length>0);assert(single.items.every(i=>i.path.startsWith('/素材/')));checks.push('Real DOM snapshot reads modern displayed types, data-title and data-id without private page state');
 await entry.window.webContents.executeJavaScript('window.baiduWorkspace.scan()');await wait(()=>workspace.state().scan.phase==='paused');await workspace.waitScanIdle();
 assert(stored.get('/素材').size>0);assert(fs.existsSync(path.join(profile,'baidu-directory-task.json')));checks.push('Toolbar starts recursive reading; pause retains a committed visible batch and durable pending task');
 for(const locale of ['zh-CN','en','ja'])for(const skin of ['x','x-light','nasa','swiss']){
  language=locale;theme=skin;workspace.refreshTheme();await new Promise(resolve=>setTimeout(resolve,60));
  assert.equal(await entry.window.webContents.executeJavaScript('document.documentElement.lang'),locale);
  entry.window.setSize(980,900);entry.window.webContents.setZoomFactor(2);
  await entry.window.webContents.executeJavaScript('window.baiduWorkspace.layout()');
  await wait(()=>entry.view.getBounds().y===408,3000);
  assert.equal(await entry.window.webContents.executeJavaScript('document.documentElement.scrollWidth>innerWidth'),false);
  await fs.promises.writeFile(path.join(profile,locale+'-'+skin+'.png'),(await entry.window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
 }
 checks.push('Native toolbar retains controls and translations in three languages, four themes and 980px/200%; remote view starts below scaled controls');
 entry.window.webContents.setZoomFactor(1);entry.window.setSize(1200,900);language='zh-CN';theme='x';workspace.refreshTheme();
 await workspace.scan('resume');await workspace.waitScanIdle();const state=workspace.state().scan;
 assert.equal(state.phase,'completed');assert.equal(state.failedDirectories,0);assert.equal(state.directoriesRead,4);assert.equal(state.filesRead,9);
 assert.equal(stored.size,4);assert.equal([...stored.values()].flatMap(m=>[...m.values()]).filter(i=>!i.directory).length,9);
 assert.equal(stored.get('/素材/Empty').size,0);checks.push('Native navigation, breadcrumbs and scrolling read nested directories, archives and empty folders; a blank scroll tail never becomes a false failure');
 await entry.view.webContents.executeJavaScript("location.hash='#/index?category=all&path='+encodeURIComponent('/素材');true");await wait(()=>workspace.entry.loaded&&!workspace.entry.loading);await new Promise(resolve=>setTimeout(resolve,100));assert.equal((await workspace.capture()).directoryPath,'/素材');checks.push('Same-document folder changes restore capture readiness without a full-page load');
 assert.equal(entry.view.webContents.getLastWebPreferences().nodeIntegration,false);assert.equal(entry.view.webContents.getLastWebPreferences().sandbox,true);
 const taskBytes=fs.readFileSync(path.join(profile,'baidu-directory-task.json'),'utf8');assert(!taskBytes.includes('SYNTHETIC_NATIVE_ONLY'));checks.push('Remote view remains isolated and persisted task contains no login cookie');
 await workspace.shutdown();fs.writeFileSync(path.join(profile,'report.json'),JSON.stringify({ok:true,checks,profile,noLiveNetwork:true,filesRead:9,directoriesRead:4},null,2));console.log(JSON.stringify({ok:true,checks:checks.length,report:path.join(profile,'report.json')}));app.exit(0);
}).catch(async error=>{console.error(error);fs.writeFileSync(path.join(profile,'report.json'),JSON.stringify({ok:false,checks,error:error.stack},null,2));try{await workspace?.shutdown()}catch{}app.exit(1)});
