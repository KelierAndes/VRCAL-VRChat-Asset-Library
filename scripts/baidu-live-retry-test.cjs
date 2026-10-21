// Owned validation session only. Retry metadata reads; never access a real local library.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
const data=path.resolve(process.env.VRC_BAIDU_VALIDATION_DATA||'E:/VRCAL-Local-Preview/Baidu-Web-Validation');
if(data.toLowerCase().startsWith('e:\\vrchat\\'))throw new Error('Not an isolated validation directory');
process.env.VRC_LIBRARY_TEST_HIDDEN='1';app.setPath('userData',data);app.setPath('sessionData',path.join(data,'session'));app.on('window-all-closed',()=>{});
let workspace;
app.whenReady().then(async()=>{
 const {BaiduWorkspace}=require('../dist/main/main/baidu-workspace');
 const before=JSON.parse(fs.readFileSync(path.join(data,'baidu-directory-task.json'),'utf8'));
 let batches=0;
 workspace=new BaiduWorkspace({parent:()=>null,dataDir:data,roots:()=>[],canNetwork:()=>true,getTheme:()=> 'x',getLanguage:()=> 'zh-CN',onChanged(){},onCapture:()=>{batches++}});
 await workspace.open();
 const deadline=Date.now()+120000;
 while(!workspace.entry?.loaded||workspace.entry.loading){if(Date.now()>deadline)throw new Error('Official page did not become ready');await new Promise(resolve=>setTimeout(resolve,300))}
 await workspace.open(before.root);
 await new Promise(resolve=>setTimeout(resolve,1500));
 const limit=setTimeout(()=>workspace.scan('pause'),90000);
 await workspace.scan('retry');await workspace.waitScanIdle();const state=workspace.state().scan;
 clearTimeout(limit);
 const report={at:new Date().toISOString(),realLoggedInDOM:true,credentialContentIncluded:false,root:state.rootPath,phase:state.phase,directoriesRead:state.directoriesRead,filesRead:state.filesRead,failedDirectories:state.failedDirectories,failures:state.failures,batches,previousFailedDirectories:before.failures.length};
 fs.writeFileSync(path.resolve(__dirname,'../outputs/baidu-live-retry-proof.json'),JSON.stringify(report,null,2));
 await workspace.shutdown();console.log(JSON.stringify(report));app.exit(state.failedDirectories?1:0);
}).catch(async error=>{console.error(error.message);try{await workspace?.shutdown()}catch{}app.exit(1)});
