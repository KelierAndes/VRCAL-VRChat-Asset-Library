// Explicit maintenance check: fetch public manifests only. No user sessions or installed plugins.
const fs=require('node:fs'),path=require('node:path');
const {PUBLIC_PLUGINS}=require('../dist/main/shared/public-plugins');
const {PublicPluginDownloads}=require('../dist/main/main/public-plugins');
const run=fs.mkdtempSync(path.resolve(__dirname,'../../plugin-sources-'));
// Electron uses the same system proxy path as the app; Node may need its own proxy configuration.
const electron=process.versions.electron?require('electron'):null;
if(electron)electron.app.setPath('userData',path.join(run,'Electron'));
async function request(url,init={}){try{return await (electron?electron.net.fetch:fetch)(url,{...init,signal:init.signal||AbortSignal.timeout(30000),credentials:'omit',headers:{'User-Agent':'VRCAL-Public-Catalog-Verification',...init.headers}})}catch(error){throw Error(`Public request failed: ${url} (${error.cause?.code||error.message})`)}}
async function json(url){const r=await request(url);if(!r.ok)throw Error(`${r.status} ${url}`);return JSON.parse((await r.text()).replace(/^\uFEFF/,''))}
(async()=>{
 if(electron)await electron.app.whenReady();
 const manifests=new Map(),rows=[];
 // A small serial queue, once per distinct author's source.
 for(const url of new Set(PUBLIC_PLUGINS.map(p=>p.vpmRepository).filter(Boolean))){manifests.set(url,await json(url))}
 for(const p of PUBLIC_PLUGINS){
  if(!p.vpmRepository){const r=await request(p.releasePage);if(!r.ok)throw Error(`Official site unavailable: ${p.id}`);await r.body?.cancel();rows.push({id:p.id,name:p.name,homepage:p.homepage,releasePage:p.releasePage,method:'official-site',verified:true});continue}
  const versions=manifests.get(p.vpmRepository)?.packages?.[p.packageId]?.versions;if(!versions)throw Error(`Package missing: ${p.id} ${p.packageId}`);
  const stable=Object.values(versions).filter(v=>/^\d+(?:\.\d+){1,3}$/.test(v.version)).sort((a,b)=>{const aa=a.version.split('.').map(Number),bb=b.version.split('.').map(Number);for(let i=0;i<Math.max(aa.length,bb.length);i++){const n=(bb[i]||0)-(aa[i]||0);if(n)return n}return 0})[0];if(!stable?.url?.startsWith('https://'))throw Error(`No stable HTTPS package: ${p.id}`);
  rows.push({id:p.id,name:p.name,homepage:p.homepage,releasePage:p.releasePage,vpmRepository:p.vpmRepository,packageId:p.packageId,stableVersion:stable.version,authorDeclaredArchive:stable.url,dependencies:stable.vpmDependencies||{},verified:true});
 }
 const pluginFetch=electron?require('../dist/main/main/public-plugin-request').createPublicPluginFetch(electron.net):request;
 const downloads=[],manager=new PublicPluginDownloads({dataDir:path.join(run,'Library'),roots:()=>[],canNetwork:()=>true,fetch:pluginFetch});
 for(const id of ['facs-utilities','animation-viewer','blendshape-viewer']){const a=await manager.download(id);await manager.verifySource(a.id);downloads.push({id,name:manager.state().name,version:manager.state().version,bytes:a.size,sha256:a.id.split(':')[2],status:manager.state().message})}
 fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({ok:true,checkedAt:new Date().toISOString(),catalogEntries:rows.length,uniqueVpmSources:manifests.size,rows,downloads,noProjectImported:true,run},null,2));console.log(JSON.stringify({ok:true,entries:rows.length,sources:manifests.size,downloads,run}));
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>{if(electron)electron.app.exit(process.exitCode||0)});
