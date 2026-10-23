const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite'),{Store}=require('../dist/main/main/store'),{copyLibraryData}=require('../dist/main/main/storage');
const {REVIEW_SORTS,THEME_IDS,LANGUAGE_IDS}=require('../dist/main/shared/contracts');

function fixture(t){
 const base=fs.mkdtempSync(path.join(__dirname,'.fixtures-review-local-image-')),root=path.join(base,'素材 日本語 💝'),data=path.join(base,'Library'),stores=[];fs.mkdirSync(root);
 const open=(directory=data)=>{const store=new Store(directory,[root]);stores.push(store);return store};
 const source=path.join(root,'Dress_Airi.unitypackage');fs.writeFileSync(source,'ORIGINAL SOURCE BYTES');
 const store=open(),asset=store.upsertScan({path:source,name:path.basename(source),group:'Airi',kind:'unitypackage',size:21,mtimeMs:1,localCategory:'服装',localAvatars:['Airi'],hintUrls:[],localEvidence:undefined,compatibilityComplete:false});store.updateManual([asset.id],{notes:'KEEP 人工メモ',favorite:true});
 t.after(()=>{for(const handle of stores)try{handle.close()}catch{}assert(path.resolve(base).startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(base,{recursive:true,force:true,maxRetries:3})});
 return {base,root,data,source,store,asset,open};
}
function rawSettings(f,update){const db=new DatabaseSync(path.join(f.data,'library.sqlite'));try{const value=JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('app').value);if(update){update(value);db.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(value),'app')}return value}finally{db.close()}}
function writeBackup(file,backup){
 if(backup.version===2)backup.metadataSha256=crypto.createHash('sha256').update(JSON.stringify({settings:backup.settings,assets:backup.assets,collections:backup.collections,tagAliases:backup.tagAliases,recoveryRecords:backup.recoveryRecords,...(backup.downloadPaths!==undefined?{downloadPaths:backup.downloadPaths}:{}),...(backup.cloudCatalog!==undefined?{cloudCatalog:backup.cloudCatalog}:{})})).digest('hex');
 fs.writeFileSync(file,JSON.stringify(backup));
}
function viewHandler(store){
 const file=path.resolve(__dirname,'../src/main/main.ts'),source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);let callback;
 function visit(node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='handle'&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text==='setViewPreferences')callback=node.arguments[1];ts.forEachChild(node,visit)}visit(source);assert(callback,'Existing setViewPreferences handler must be registered');
 const output=ts.transpileModule('const invoke='+callback.getText(source)+';invoke',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 let changes=0,themes=0;const invoke=vm.runInNewContext(output,{store,REVIEW_SORTS,THEME_IDS,LANGUAGE_IDS,changed:()=>changes++,refreshTheme:()=>themes++});
 return {invoke,changes:()=>changes,themes:()=>themes};
}

test('review local images default off and both choices persist without changing source records',t=>{
 const f=fixture(t),record=f.store.getRaw(f.asset.id);assert.equal(f.store.settings().reviewShowLocalImage,false);
 f.store.saveSettings({reviewShowLocalImage:true,reviewHeaderPinned:true});f.store.saveSettings({theme:'x-light',language:'ja',density:'compact'});f.store.close();
 const reopened=f.open();assert.equal(reopened.settings().reviewShowLocalImage,true);assert.equal(reopened.settings().reviewHeaderPinned,true);assert.equal(reopened.settings().theme,'x-light');assert.deepEqual(reopened.getRaw(f.asset.id),record);
 reopened.saveSettings({reviewShowLocalImage:false});reopened.close();assert.equal(f.open().settings().reviewShowLocalImage,false);assert.equal(fs.readFileSync(f.source,'utf8'),'ORIGINAL SOURCE BYTES');
});

test('old and malformed stored image choices read as false without rewriting the old database',t=>{
 const f=fixture(t);f.store.saveSettings({theme:'swiss',reviewSort:'added',reviewHeaderPinned:true});f.store.close();
 for(const value of [undefined,'true','false',1,0,null,{},[]]){
  rawSettings(f,saved=>{if(value===undefined)delete saved.reviewShowLocalImage;else saved.reviewShowLocalImage=value});const before=rawSettings(f),store=f.open();
  assert.equal(store.settings().reviewShowLocalImage,false);assert.equal(store.settings().reviewHeaderPinned,true);assert.equal(store.settings().theme,'swiss');assert.equal(store.settings().reviewSort,'added');assert.deepEqual(rawSettings(f),before);store.close();
 }
 rawSettings(f,saved=>{saved.reviewShowLocalImage=true});assert.equal(f.open().settings().reviewShowLocalImage,true);
});

test('invalid image writes are atomic including unrelated preferences, scope and asset records',t=>{
 const f=fixture(t);f.store.saveSettings({reviewShowLocalImage:true,reviewHeaderPinned:true,theme:'swiss'});const before=f.store.settings(),persisted=rawSettings(f),record=f.store.getRaw(f.asset.id);
 for(const value of [undefined,'true','false',1,0,null,{},[],new Boolean(true)]){
  assert.throws(()=>f.store.saveSettings({reviewShowLocalImage:value,reviewHeaderPinned:false,theme:'x-light',uiZoom:1.5,roots:[]}),/显示偏好无效/);
  assert.deepEqual(f.store.settings(),before);assert.deepEqual(rawSettings(f),persisted);assert.deepEqual(f.store.getRaw(f.asset.id),record);
 }
 assert.equal(fs.readFileSync(f.source,'utf8'),'ORIGINAL SOURCE BYTES');
});

test('verified backups restore enabled and disabled image choices and preserve existing records',t=>{
 const f=fixture(t);
 for(const enabled of [true,false]){
  f.store.saveSettings({reviewShowLocalImage:enabled});const backup=path.join(f.base,'backup-'+enabled+'.json');f.store.exportData(backup);assert.equal(JSON.parse(fs.readFileSync(backup,'utf8')).settings.reviewShowLocalImage,enabled);
  const directory=path.join(f.base,'restored-'+enabled),restored=f.open(directory);restored.saveSettings({reviewShowLocalImage:!enabled});restored.importData(backup);assert.equal(restored.settings().reviewShowLocalImage,enabled);assert.equal(restored.getRaw(f.asset.id).manual.notes,'KEEP 人工メモ');restored.close();assert.equal(f.open(directory).settings().reviewShowLocalImage,enabled);
 }
 assert.equal(fs.readFileSync(f.source,'utf8'),'ORIGINAL SOURCE BYTES');
});

test('library migration carries the enabled image choice without changing source bytes',async t=>{
 const f=fixture(t);f.store.saveSettings({reviewShowLocalImage:true,reviewHeaderPinned:true,language:'ja'});f.store.close();
 const target=path.join(f.base,'Migrated');await copyLibraryData(f.data,target,[f.root],true);const migrated=f.open(target);
 assert.equal(migrated.settings().reviewShowLocalImage,true);assert.equal(migrated.settings().reviewHeaderPinned,true);assert.equal(migrated.settings().language,'ja');assert.equal(migrated.getRaw(f.asset.id).manual.notes,'KEEP 人工メモ');assert.equal(fs.readFileSync(f.source,'utf8'),'ORIGINAL SOURCE BYTES');
});

test('missing or nonboolean backup choices preserve the current choice and never enable a fresh library',t=>{
 const f=fixture(t),original=path.join(f.base,'original.json');f.store.exportData(original);
 for(const version of [1,2])for(const [index,value]of [undefined,'true','false',1,0,null,{},[]].entries()){
  const backup=JSON.parse(fs.readFileSync(original,'utf8'));backup.version=version;if(value===undefined)delete backup.settings.reviewShowLocalImage;else backup.settings.reviewShowLocalImage=value;
  const file=path.join(f.base,'legacy-'+version+'-'+index+'.json');writeBackup(file,backup);
  const enabled=f.open(path.join(f.base,'enabled-'+version+'-'+index)),fresh=f.open(path.join(f.base,'fresh-'+version+'-'+index));enabled.saveSettings({reviewShowLocalImage:true});enabled.importData(file);fresh.importData(file);
  assert.equal(enabled.settings().reviewShowLocalImage,true);assert.equal(fresh.settings().reviewShowLocalImage,false);assert.equal(fresh.getRaw(f.asset.id).manual.notes,'KEEP 人工メモ');enabled.close();fresh.close();
 }
});

test('the registered view handler accepts only booleans and rejects mixed invalid writes before saving',t=>{
 const f=fixture(t),api=viewHandler(f.store);assert.equal(api.invoke({reviewShowLocalImage:true}).reviewShowLocalImage,true);assert.equal(api.changes(),1);assert.equal(api.themes(),0);
 for(const input of [undefined,null,[],1,'true',...[undefined,'true','false',1,0,null,{},[],new Boolean(true)].map(reviewShowLocalImage=>({reviewShowLocalImage,theme:'x-light'})),{reviewShowLocalImage:false,unknownPreference:true}]){
  const before=f.store.settings(),persisted=rawSettings(f);assert.throws(()=>api.invoke(input),/显示设置无效/);assert.deepEqual(f.store.settings(),before);assert.deepEqual(rawSettings(f),persisted);assert.equal(api.changes(),1);assert.equal(api.themes(),0);
 }
 assert.equal(api.invoke({reviewShowLocalImage:false,language:'en'}).reviewShowLocalImage,false);assert.equal(api.changes(),2);assert.equal(api.themes(),1);
});
