const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {assertUserStorage,readLocation,writeLocation,rememberLibraryLocation,prepareSessionData,copyLibraryData}=require('../dist/main/main/storage');
const {Store}=require('../dist/main/main/store');
function fixture(t){const root=fs.mkdtempSync(path.join(__dirname,'.fixtures-storage-'));t.after(()=>{const absolute=path.resolve(root);assert(absolute.startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(absolute,{recursive:true,force:true,maxRetries:3})});return root}
function digest(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}
test('user-selected storage rejects C, protected material locations and destination links',t=>{
 const root=fixture(t),materials=path.join(root,'素材'),outside=path.join(root,'目录');fs.mkdirSync(materials);fs.mkdirSync(outside);
 // The policy targets C:, regardless of the drive hosting this checkout (D: on CI).
 const cDriveTarget=path.win32.join('C:\\','VRCAL-storage-policy-'+crypto.randomUUID(),'backup');
 assert.throws(()=>assertUserStorage(cDriveTarget,[]),/C 盘/);assert.throws(()=>assertUserStorage(path.join(materials,'copy'),[materials],true),/保护/);
 const link=path.join(root,'alias');fs.symlinkSync(outside,link,'junction');assert.throws(()=>assertUserStorage(path.join(link,'backup'),[],true),/链接/);
 assert.equal(assertUserStorage(path.join(root,'backup'),[],true),path.join(root,'backup'));
});
test('library migration verifies database, covers and resumable queue while leaving original profile intact',async t=>{
 const root=fixture(t),source=path.join(root,'old'),target=path.join(root,'new'),materials=path.join(root,'素材');fs.mkdirSync(materials);
 const store=new Store(source,[materials]);store.saveSettings({uiZoom:1.25,backupDir:path.join(root,'备份')});store.close();
 fs.mkdirSync(path.join(source,'cache'));fs.writeFileSync(path.join(source,'cache','cover.png'),'test cover');fs.writeFileSync(path.join(source,'queue.json'),JSON.stringify({tasks:[{id:'unfinished'}],paused:true}));fs.writeFileSync(path.join(source,'unrelated.txt'),'do not migrate');
 const before=digest(path.join(source,'library.sqlite'));const result=await copyLibraryData(source,target,[materials],true);
 assert.equal(result.files,3);assert.equal(digest(path.join(source,'library.sqlite')),before);assert.equal(digest(path.join(target,'library.sqlite')),before);assert(!fs.existsSync(path.join(target,'unrelated.txt')));
 const restored=new Store(target,[materials]);assert.equal(restored.settings().uiZoom,1.25);assert.equal(restored.settings().backupDir,path.join(root,'备份'));restored.close();assert.equal(JSON.parse(fs.readFileSync(path.join(target,'queue.json'))).paused,true);
});
test('migration never overwrites an existing profile and rolls back only newly created files on failure',async t=>{
 const root=fixture(t),source=path.join(root,'old'),target=path.join(root,'new');const store=new Store(source,[]);store.close();fs.mkdirSync(target);fs.writeFileSync(path.join(target,'user.txt'),'preserve');
 await assert.rejects(copyLibraryData(source,target,[],true),/已有内容/);assert.equal(fs.readFileSync(path.join(target,'user.txt'),'utf8'),'preserve');
 const failed=path.join(root,'failed');fs.symlinkSync(target,path.join(source,'cache'),'junction');await assert.rejects(copyLibraryData(source,failed,[],true),/链接/);assert(!fs.existsSync(path.join(failed,'library.sqlite')));assert(fs.existsSync(path.join(source,'library.sqlite')));
});
test('small location record persists chosen directories separately without copying material files',t=>{
 const root=fixture(t),file=path.join(root,'location.json');const config={dataDir:'E:\\VRC工具\\VRChatAssetLibrary',backupDir:'E:\\VRC备份'};writeLocation(file,config,['E:\\VRChat']);assert.deepEqual(readLocation(file),config);
 fs.writeFileSync(file,'invalid');assert.deepEqual(readLocation(file),{});assert.throws(()=>writeLocation(path.join(root,'素材','location.json'),config,[path.join(root,'素材')]),/保护/);
});
test('remembered library follows a portable upgrade into a different program folder',t=>{
 const root=fixture(t),local=path.join(root,'old-program','location.json'),shared=path.join(root,'account','location.json'),moved=path.join(root,'new-program','location.json'),config={dataDir:'E:\\My Library',backupDir:'E:\\Library Backups'};
 rememberLibraryLocation(local,shared,config,[]);
 assert.deepEqual(readLocation(local),config);assert.deepEqual(readLocation(shared),config);
 assert.deepEqual(readLocation(moved).dataDir?readLocation(moved):readLocation(shared),config);
 const blocked=path.join(root,'protected');fs.mkdirSync(blocked);
 rememberLibraryLocation(path.join(blocked,'location.json'),shared,{dataDir:'E:\\Moved Library'},[blocked]);
 assert.equal(readLocation(shared).dataDir,'E:\\Moved Library');assert(!fs.existsSync(path.join(blocked,'location.json')));
});
test('early session setup retains the old encryption key without replacing an existing key',t=>{
 const root=fixture(t),dataDir=path.join(root,'data');fs.mkdirSync(dataDir);const previous=path.join(dataDir,'Local State'),original=JSON.stringify({os_crypt:{encrypted_key:'private-key-fixture'}});fs.writeFileSync(previous,original);
 const directory=prepareSessionData(dataDir,[]),current=path.join(directory,'Local State');assert.equal(fs.readFileSync(current,'utf8'),original);assert.equal(fs.readFileSync(previous,'utf8'),original);
 fs.writeFileSync(current,'existing-session-key');prepareSessionData(dataDir,[]);assert.equal(fs.readFileSync(current,'utf8'),'existing-session-key');
 assert.throws(()=>prepareSessionData(dataDir,[dataDir]),/保护/);
});
test('migration retains the selected-profile cookie key and account history but excludes unrelated browser cache',async t=>{
 const root=fixture(t),source=path.join(root,'old-account'),target=path.join(root,'new-account'),store=new Store(source,[]);store.close();
 for(const name of ['booth-session','session'])fs.mkdirSync(path.join(source,name));
 fs.writeFileSync(path.join(source,'session','Local State'),'private fixture encryption key');fs.writeFileSync(path.join(source,'session','unrelated-cache'),'omit this');fs.writeFileSync(path.join(source,'booth-session','Cookies'),'encrypted fixture cookie');fs.writeFileSync(path.join(source,'booth-session-cookies.bin'),Buffer.from([9,8,7,6]));fs.writeFileSync(path.join(source,'booth-downloads.json'),'[]');
 const before=Object.fromEntries(['library.sqlite','session/Local State','booth-session/Cookies','booth-session-cookies.bin','booth-downloads.json'].map(name=>[name,digest(path.join(source,name))]));await copyLibraryData(source,target,[],true);
 for(const [name,hash] of Object.entries(before)){assert.equal(digest(path.join(source,name)),hash);assert.equal(digest(path.join(target,name)),hash)}assert(!fs.existsSync(path.join(target,'session','unrelated-cache')));
});
