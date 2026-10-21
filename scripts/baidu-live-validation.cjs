// Interactive opt-in proof only. No live library or material directory is opened.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {BaiduWorkspace}=require('../dist/main/main/baidu-workspace');
const data=path.resolve(process.env.VRC_BAIDU_VALIDATION_DATA||'E:/VRCAL-Local-Preview/Baidu-Web-Validation');
if(!path.isAbsolute(data)||data.toLowerCase().startsWith('e:\\vrchat\\'))throw new Error('Invalid isolated validation directory');
fs.mkdirSync(data,{recursive:true});app.setPath('userData',data);app.setPath('sessionData',path.join(data,'session'));
let workspace,quitting=false;
app.whenReady().then(async()=>{
 workspace=new BaiduWorkspace({parent:()=>null,dataDir:data,roots:()=>[],canNetwork:()=>!quitting,getTheme:()=> 'x',getLanguage:()=> 'zh-CN',onChanged:()=>{},onCapture:capture=>{
  fs.writeFileSync(path.join(data,'capture-proof.json'),JSON.stringify({schema:1,at:new Date().toISOString(),directoryPath:capture.directoryPath,items:capture.items,complete:false,source:capture.source,warnings:capture.warnings},null,2));
  console.log('VISIBLE_CAPTURE_SAVED count='+capture.items.length);
 }});
 // Only the isolated validation runner exposes this main-process test handle.
 // The remote website has no preload or access to it.
 globalThis.__baiduValidation=workspace;
 await workspace.open();console.log('BAIDU_VALIDATION_WINDOW_READY');
}).catch(error=>{console.error(error.message);app.quit()});
app.on('window-all-closed',()=>app.quit());app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;workspace?.shutdown().finally(()=>app.quit())});
