const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const build=process.env.VRCAL_WRITE_TEST_BUILD||path.join(__dirname,'../dist/main');
const safety=require(path.join(build,'main/safety'));
const {writeLocation,readLocation}=require(path.join(build,'main/storage'));
const {EnrichmentQueue}=require(path.join(build,'main/online'));
function fixture(t){
 const area=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-scan-write-boundary-')),root=path.join(area,'Source'),data=path.join(area,'Library');fs.mkdirSync(root);fs.mkdirSync(data);
 const source=path.join(root,'Original.unitypackage');fs.writeFileSync(source,'SYNTHETIC ORIGINAL BYTES');
 t.after(()=>{const actual=fs.realpathSync(area);assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));assert(path.basename(actual).startsWith('vrc-scan-write-boundary-'));fs.rmSync(actual,{recursive:true,force:true,maxRetries:3})});
 return {area,root,data,source};
}
function inventory(root){return fs.readdirSync(root,{withFileTypes:true}).map(entry=>{const file=path.join(root,entry.name),stat=fs.lstatSync(file);return {name:entry.name,size:stat.size,mtime:stat.mtimeMs,hash:entry.isFile()?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):undefined}})}
function queueFor(f){return new EnrichmentQueue({dataDir:f.data,roots:()=>[f.root],all:()=>[],get:()=>null,updateOnline:()=>{},fetch:async()=>{throw Error('No network operation is allowed in this regression')}})}
function atomic(){assert.equal(typeof safety.writeOwnedAtomic,'function');return safety.writeOwnedAtomic}

test('scan-triggered queue persistence leaves a legacy temporary hardlink and its source bytes and name intact',async t=>{
 const f=fixture(t),legacy=path.join(f.data,'queue.json.tmp');fs.linkSync(f.source,legacy);const before=inventory(f.root),queue=queueFor(f);
 await queue.enqueue();assert.deepEqual(inventory(f.root),before);assert.equal(fs.readFileSync(legacy,'utf8'),'SYNTHETIC ORIGINAL BYTES');assert.equal(JSON.parse(fs.readFileSync(path.join(f.data,'queue.json'),'utf8')).version,2);
});
test('a complete source scan followed by paused queue registration preserves source names, sizes, times and hashes',async t=>{
 const f=fixture(t),{Store}=require(path.join(build,'main/store')),{Scanner}=require(path.join(build,'main/scanner')),store=new Store(f.data,[f.root]);try{
 fs.writeFileSync(path.join(f.data,'queue.json'),JSON.stringify({version:2,tasks:[],paused:true}));fs.linkSync(f.source,path.join(f.data,'queue.json.tmp'));const before=inventory(f.root);
 await new Scanner(store).scan();assert(store.all().length>0);const queue=new EnrichmentQueue({dataDir:f.data,roots:()=>[f.root],all:()=>store.all(),get:id=>store.get(id),updateOnline:(id,patch)=>store.updateOnline(id,patch),fetch:async()=>{throw Error('No network operation is allowed in this regression')}});
 await queue.enqueue();assert(JSON.parse(fs.readFileSync(path.join(f.data,'queue.json'),'utf8')).tasks.length>0);assert.deepEqual(inventory(f.root),before);assert.equal(fs.readFileSync(path.join(f.data,'queue.json.tmp'),'utf8'),'SYNTHETIC ORIGINAL BYTES');
 }finally{store.close()}
});
test('location persistence never truncates the source behind a preexisting legacy temporary hardlink',t=>{
 const f=fixture(t),target=path.join(f.data,'VRC-library-location.json'),legacy=target+'.tmp';fs.linkSync(f.source,legacy);const before=inventory(f.root),config={dataDir:f.data};
 writeLocation(target,config,[f.root]);assert.deepEqual(inventory(f.root),before);assert.equal(fs.readFileSync(legacy,'utf8'),'SYNTHETIC ORIGINAL BYTES');assert.deepEqual(readLocation(target),{...config,backupDir:undefined});
});
test('Baidu directory task persistence leaves a legacy temporary hardlink untouched without opening a browser',async t=>{
 const f=fixture(t),target=path.join(f.data,'baidu-directory-task.json'),legacy=target+'.tmp';fs.writeFileSync(target,JSON.stringify({schema:1,accountKey:'baidu:'+'a'.repeat(64),root:'/Synthetic',phase:'paused',pending:['/Synthetic'],done:[],files:[],failures:[]}));fs.linkSync(f.source,legacy);const before=inventory(f.root);
 const {BaiduWorkspace}=require(path.join(build,'main/baidu-workspace')),workspace=new BaiduWorkspace({dataDir:f.data,roots:()=>[f.root],parent:()=>null,canNetwork:()=>false,onChanged:()=>{}});
 await workspace.scan('stop');assert.deepEqual(inventory(f.root),before);assert.equal(fs.readFileSync(legacy,'utf8'),'SYNTHETIC ORIGINAL BYTES');assert.equal(JSON.parse(fs.readFileSync(target,'utf8')).phase,'stopped');
});
test('write guard rejects hardlinked regular files but continues allowing ordinary directories and exclusive new paths',t=>{
 const f=fixture(t),alias=path.join(f.data,'linked.bin'),directory=path.join(f.data,'ordinary');fs.linkSync(f.source,alias);fs.mkdirSync(directory);fs.mkdirSync(path.join(directory,'child'));
 assert.throws(()=>safety.assertSafeWrite(alias,f.data,[f.root]),/硬链接|多个链接/);
 assert.equal(safety.assertSafeWrite(directory,f.data,[f.root]),directory);assert.equal(safety.assertSafeWrite(path.join(directory,'new.bin'),f.data,[f.root]),path.join(directory,'new.bin'));assert.equal(fs.readFileSync(f.source,'utf8'),'SYNTHETIC ORIGINAL BYTES');
});
test('atomic writes reject a hardlinked final target before replacing any of its names',t=>{
 const f=fixture(t),target=path.join(f.data,'state.json');fs.linkSync(f.source,target);const before=inventory(f.root);
 assert.throws(()=>atomic()(target,'metadata',f.data,[f.root]),/硬链接|多个链接/);assert.deepEqual(inventory(f.root),before);assert.equal(fs.readFileSync(target,'utf8'),'SYNTHETIC ORIGINAL BYTES');assert.deepEqual(fs.readdirSync(f.data),['state.json']);
});
test('atomic writes retain an existing destination until complete bytes are ready and leave no temporary files on success',t=>{
 const f=fixture(t),target=path.join(f.data,'state.json');fs.writeFileSync(target,'previous');atomic()(target,'complete replacement',f.data,[f.root]);assert.equal(fs.readFileSync(target,'utf8'),'complete replacement');assert.deepEqual(fs.readdirSync(f.data),['state.json']);
});
test('exclusive temporary creation preserves a colliding file and the previous destination',t=>{
 const f=fixture(t),target=path.join(f.data,'state.json');fs.writeFileSync(target,'previous');const write=atomic(),original=fs.openSync;let collision;
 fs.openSync=function(file,flags,...args){if(typeof file==='string'&&path.dirname(file)===f.data&&flags==='wx'&&!collision){collision=file;fs.writeFileSync(file,'FOREIGN TEMPORARY FILE')}return original.call(this,file,flags,...args)};
 try{assert.throws(()=>write(target,'new',f.data,[f.root]),error=>error.code==='EEXIST')}finally{fs.openSync=original}
 assert(collision);assert.equal(fs.readFileSync(collision,'utf8'),'FOREIGN TEMPORARY FILE');assert.equal(fs.readFileSync(target,'utf8'),'previous');
});
test('partial-write failure cleans only the newly owned temporary and keeps the previous destination',t=>{
 const f=fixture(t),target=path.join(f.data,'state.json');fs.writeFileSync(target,'previous');const write=atomic(),original=fs.writeFileSync;let failed=false;
 fs.writeFileSync=function(file,bytes,...args){if(typeof file==='number'&&!failed){failed=true;original.call(this,file,'partial');throw Object.assign(Error('synthetic disk-full'),{code:'ENOSPC'})}return original.call(this,file,bytes,...args)};
 try{assert.throws(()=>write(target,'new complete bytes',f.data,[f.root]),error=>error.code==='ENOSPC')}finally{fs.writeFileSync=original}
 assert.equal(failed,true);assert.equal(fs.readFileSync(target,'utf8'),'previous');assert.deepEqual(fs.readdirSync(f.data),['state.json']);
});
test('rename failure cleans the same owned inode and retains the old destination',t=>{
 const f=fixture(t),target=path.join(f.data,'state.json');fs.writeFileSync(target,'previous');const write=atomic(),original=fs.renameSync;
 fs.renameSync=function(from,to){if(to===target)throw Object.assign(Error('synthetic sharing violation'),{code:'EACCES'});return original.call(this,from,to)};
 try{assert.throws(()=>write(target,'new',f.data,[f.root]),error=>error.code==='EACCES')}finally{fs.renameSync=original}
 assert.equal(fs.readFileSync(target,'utf8'),'previous');assert.deepEqual(fs.readdirSync(f.data),['state.json']);
});
test('cleanup never deletes an unrelated file substituted at the temporary pathname',t=>{
 const f=fixture(t),target=path.join(f.data,'state.json');fs.writeFileSync(target,'previous');const write=atomic(),original=fs.renameSync;let replacement;
 fs.renameSync=function(from,to){if(to===target){original.call(this,from,from+'.held');replacement=from;fs.writeFileSync(from,'FOREIGN REPLACEMENT');throw Object.assign(Error('synthetic pathname replacement'),{code:'EACCES'})}return original.call(this,from,to)};
 try{assert.throws(()=>write(target,'new',f.data,[f.root]),error=>error.code==='EACCES')}finally{fs.renameSync=original}
 assert(replacement);assert.equal(fs.readFileSync(replacement,'utf8'),'FOREIGN REPLACEMENT');assert.equal(fs.readFileSync(target,'utf8'),'previous');
});
test('atomic publication rechecks a final target replaced by a source hardlink while bytes were written',t=>{
 const f=fixture(t),target=path.join(f.data,'state.json'),write=atomic(),original=fs.writeFileSync;const before=inventory(f.root);let substituted=false;
 fs.writeFileSync=function(file,bytes,...args){const result=original.call(this,file,bytes,...args);if(typeof file==='number'&&!substituted){substituted=true;fs.linkSync(f.source,target)}return result};
 try{assert.throws(()=>write(target,'new',f.data,[f.root]),/硬链接|多个链接/)}finally{fs.writeFileSync=original}
 assert.equal(substituted,true);assert.deepEqual(inventory(f.root),before);assert.equal(fs.readFileSync(target,'utf8'),'SYNTHETIC ORIGINAL BYTES');assert.deepEqual(fs.readdirSync(f.data),['state.json']);
});
test('a temporary linked elsewhere before its first write is rejected without publishing metadata through the alias',t=>{
 const f=fixture(t),target=path.join(f.data,'state.json'),alias=path.join(f.root,'unexpected-alias.bin'),write=atomic(),original=fs.openSync;fs.writeFileSync(target,'previous');let linked=false;
 fs.openSync=function(file,flags,...args){const descriptor=original.call(this,file,flags,...args);if(flags==='wx'&&path.dirname(file)===f.data&&!linked){linked=true;fs.linkSync(file,alias)}return descriptor};
 try{assert.throws(()=>write(target,'PRIVATE METADATA',f.data,[f.root]),/硬链接/)}finally{fs.openSync=original}
 assert.equal(linked,true);assert.equal(fs.readFileSync(alias,'utf8'),'');assert.equal(fs.readFileSync(target,'utf8'),'previous');assert.deepEqual(fs.readdirSync(f.data),['state.json']);
});
test('atomic publication rejects an owned temporary that gained another link after writing',t=>{
 const f=fixture(t),target=path.join(f.data,'state.json'),alias=path.join(f.data,'alias.bin'),write=atomic(),original=fs.writeFileSync;fs.writeFileSync(target,'previous');let linked=false;
 fs.writeFileSync=function(file,bytes,...args){const result=original.call(this,file,bytes,...args);if(typeof file==='number'&&!linked){const temporary=fs.readdirSync(f.data).find(name=>name.endsWith('.tmp'));linked=true;fs.linkSync(path.join(f.data,temporary),alias)}return result};
 try{assert.throws(()=>write(target,'new metadata',f.data,[f.root]),/硬链接|发生变化/)}finally{fs.writeFileSync=original}
 assert.equal(linked,true);assert.equal(fs.readFileSync(target,'utf8'),'previous');assert.deepEqual(fs.readdirSync(f.data).sort(),['alias.bin','state.json']);
});
