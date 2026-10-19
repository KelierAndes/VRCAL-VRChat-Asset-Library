const {_electron}=require('playwright');const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),work=path.resolve(root,'..'),area=fs.mkdtempSync(path.join(work,'storage-ui-'));
const materials=path.join(area,'素材'),data=path.join(area,'原资料库'),selected=path.join(area,'用户选择'),backup=path.join(area,'用户备份'),locator=path.join(area,'位置记录.json');
fs.mkdirSync(materials);fs.mkdirSync(selected);fs.mkdirSync(backup);fs.writeFileSync(path.join(materials,'Airi.unitypackage'),'fixture');
(async()=>{
 const app=await _electron.launch({executablePath:process.env.VRC_UI_EXECUTABLE||require('electron'),args:process.env.VRC_UI_EXECUTABLE?[]:[root],env:{...process.env,VRC_LIBRARY_DATA_DIR:data,VRC_LIBRARY_ROOT:materials,VRC_LIBRARY_LOCATION_FILE:locator,VRC_LIBRARY_NO_NETWORK:'1',VRC_LIBRARY_NO_AUTOSCAN:'1',VRC_LIBRARY_TEST_HIDDEN:'1',VRC_LIBRARY_NO_RELAUNCH:'1'}});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>!!window.library);await page.evaluate(()=>window.library.scan());
  const before=await page.evaluate(()=>window.library.list({view:'all'}));const id=before.items[0].id;
  await page.evaluate(id=>window.library.annotate([id],{notes:'迁移保留我的标注'}),id);
  await app.evaluate(({dialog},selected)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[selected]})},selected);
  assert(await page.evaluate(()=>window.library.chooseDataDir()));
  const migrated=await page.evaluate(()=>window.library.snapshot());assert.equal(migrated.settings.dataDir,path.join(selected,'VRChatAssetLibrary'));
  assert(fs.existsSync(path.join(data,'library.sqlite')));assert.equal(JSON.parse(fs.readFileSync(locator,'utf8')).dataDir,migrated.settings.dataDir);
  assert.equal((await page.evaluate(id=>window.library.get(id),id)).manual.notes,'迁移保留我的标注');
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:options.defaultPath})},backup);
  assert(await page.evaluate(()=>window.library.chooseBackupDir()));const exported=await page.evaluate(()=>window.library.backup());assert(path.dirname(exported)===backup);assert(fs.existsSync(exported));
  const covers=JSON.parse(fs.readFileSync(exported,'utf8'));assert.equal(covers.assets[0].manual.notes,'迁移保留我的标注');
  console.log(JSON.stringify({ok:true,migration:migrated.settings.dataDir,oldRetained:true,chosenBackup:exported,notesPreserved:true}));
 }finally{await app.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
