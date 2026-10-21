// Interactive, owned-session DOM validation. No real library or browser cookies are imported.
const {_electron}=require('playwright'),path=require('node:path'),fs=require('node:fs');
(async()=>{
 const app=await _electron.launch({executablePath:process.env.VRC_TEST_ELECTRON||require('electron'),args:[path.join(__dirname,'baidu-live-validation.cjs')],env:{...process.env,VRC_BAIDU_VALIDATION_DATA:process.env.VRC_BAIDU_VALIDATION_DATA||'E:/VRCAL-Local-Preview/Baidu-Web-Validation'}});
 await app.firstWindow();console.log('VALIDATION_READY');
 let closed=false;app.on('close',()=>{closed=true});
 const control=path.resolve(__dirname,'../outputs/baidu-layout-command.json');let last=0;
 while(!closed){
  await new Promise(resolve=>setTimeout(resolve,300));
  if(!fs.existsSync(control))continue;const command=JSON.parse(fs.readFileSync(control,'utf8'));if(command.id===last)continue;last=command.id;const line=command.action;
  if(line==='close'){await app.close();break}
  if(line==='navigate')try{await app.evaluate(async(_electron,directory)=>globalThis.__baiduValidation.open(directory),command.directory);console.log('NAVIGATED')}catch(error){console.error(error.message)}
  if(['capture','start','pause','resume','stop','retry','status'].includes(line))try{const result=await app.evaluate(async(_electron,action)=>{const w=globalThis.__baiduValidation;if(action==='capture'){const c=await w.capture();return {at:new Date().toISOString(),liveDOM:true,directory:c.directoryPath,count:c.items.length,folders:c.items.filter(i=>i.directory).length,complete:c.complete}}if(action!=='status')await w.scan(action);const state=w.state();delete state.accountKey;return state},line);fs.writeFileSync(path.resolve(__dirname,'../outputs/baidu-live-action.json'),JSON.stringify({id:command.id,...result},null,2));console.log('ACTION_SAVED')}catch(error){console.error(error.message)}
  if(line==='probe')try{const script=fs.readFileSync(path.resolve(__dirname,'../outputs/baidu-layout-probe.js'),'utf8');const result=await app.evaluate(async(_electron,script)=>globalThis.__baiduValidation.entry.view.webContents.executeJavaScript(script),script);fs.writeFileSync(path.resolve(__dirname,'../outputs/baidu-probe-result.json'),JSON.stringify(result,null,2));console.log('PROBE_SAVED')}catch(error){console.error(error.message)}
  if(line==='inspect')try{
   const result=await app.evaluate(async()=>{
    const workspace=globalThis.__baiduValidation,contents=workspace?.entry?.view?.webContents;
    if(!contents)return {error:'window-closed'};
    return contents.executeJavaScript(`(${function(){
     const allowed=['class','role','title','aria-label','data-isdir','data-path','data-fsid','data-size','href'];
     const clean=e=>({tag:e.tagName,attrs:Object.fromEntries(allowed.filter(a=>e.hasAttribute(a)).map(a=>[a,e.getAttribute(a)])),text:(e.textContent||'').trim().slice(0,160)});
     const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&getComputedStyle(e).visibility!=='hidden'};
     const tables=Array.from(document.querySelectorAll('[class*=table]')).filter(visible).slice(0,22).map(e=>({tag:e.tagName,class:e.className,attrs:Array.from(e.attributes).filter(a=>a.name!=='style').map(a=>[a.name,a.value]),children:Array.from(e.children).slice(0,4).map(clean)}));
     const labels=Array.from(document.querySelectorAll('[title]')).filter(e=>visible(e)&&!e.closest('header,aside,.wp-s-header,.wp-s-aside-nav')&&String(e.className).includes('file')).slice(0,3).map(e=>({label:clean(e),parent:clean(e.parentElement),grandparent:clean(e.parentElement.parentElement),greatgrandparent:clean(e.parentElement.parentElement.parentElement),children:Array.from(e.parentElement.parentElement.children).slice(0,8).map(clean)}));
     const controls=Array.from(document.querySelectorAll('[class*=pagination],[class*=breadcrumb],[class*=empty],[class*=bread]')).filter(visible).slice(0,12).map(clean);
     return {url:location.href,title:document.title,tables,labels,controls};
    }.toString()})()`);
   });fs.writeFileSync(path.resolve(__dirname,'../outputs/baidu-layout-result.json'),JSON.stringify(result,null,2));console.log('LAYOUT_SAVED');
  }catch(error){console.error(error.message)}
 }
})().catch(error=>{console.error(error);process.exitCode=1});
