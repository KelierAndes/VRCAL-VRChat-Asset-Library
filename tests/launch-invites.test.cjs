const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {LaunchInvites}=require('../dist/main/main/launch-invites');
const {Store}=require('../dist/main/main/store');
const {copyLibraryData}=require('../dist/main/main/storage');
const PROJECT='https://github.com/NecoAya/VRCAL-VRChat-Asset-Library';
function fixture(t){const dir=fs.mkdtempSync(path.join(__dirname,'.fixtures-launch-invites-'));t.after(()=>{assert(path.resolve(dir).startsWith(path.resolve(__dirname)+path.sep));fs.rmSync(dir,{recursive:true,force:true,maxRetries:3})});return dir}
function make(dir,open=async()=>{},roots=[]){return new LaunchInvites({dataDir:()=>dir,roots:()=>roots,openExternal:open})}
const file=dir=>path.join(dir,'app-usage.json');
function seed(dir,count,notified=[]){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file(dir),JSON.stringify({version:1,count,notified}))}

test('real restarts invite exactly at 5, 10, 20, 50; renderer rereads never count twice or open a browser',t=>{
 const dir=fixture(t),shown=[],opened=[];
 for(let i=1;i<=55;i++){
  const usage=make(dir,async url=>opened.push(url)),invite=usage.start();
  assert.deepEqual(usage.start(),invite);assert.equal(JSON.parse(fs.readFileSync(file(dir))).count,i);
  if(invite){assert.equal(invite.count,i);assert.equal(invite.projectUrl,PROJECT);shown.push(i);usage.dismiss(i);assert.equal(usage.start(),null)}
 }
 assert.deepEqual(shown,[5,10,20,50]);assert.deepEqual(opened,[]);assert.deepEqual(JSON.parse(fs.readFileSync(file(dir))).notified,[5,10,20,50]);
});
test('dismissing one milestone persists across restart without cancelling later milestones',t=>{
 const dir=fixture(t);seed(dir,4);const usage=make(dir);assert.equal(usage.start().count,5);usage.dismiss(5);assert.equal(usage.start(),null);
 assert.equal(make(dir).start(),null);seed(dir,9,[5]);assert.equal(make(dir).start().count,10);
});
test('confirmation opens only the fixed project URL and concurrent clicks share one browser request',async t=>{
 const dir=fixture(t);seed(dir,9,[5]);let release;const opened=[],usage=make(dir,url=>{opened.push(url);return new Promise(resolve=>release=resolve)});usage.start();
 const first=usage.open(10),again=usage.open(10);assert.equal(opened.length,1);release();await Promise.all([first,again]);assert.deepEqual(opened,[PROJECT]);assert.equal(usage.start(),null);
 await assert.rejects(()=>usage.open(10),/启动提示已处理/);assert.equal(opened.length,1);
});
test('failed browser open keeps the invitation retryable and never claims a GitHub star',async t=>{
 const dir=fixture(t);seed(dir,19,[5,10]);let calls=0;const usage=make(dir,async url=>{assert.equal(url,PROJECT);if(++calls===1)throw Error('No browser')});usage.start();
 await assert.rejects(()=>usage.open(20),/No browser/);assert.equal(usage.start().count,20);await usage.open(20);assert.equal(calls,2);assert.equal(usage.start(),null);
});
test('wrong, stale or nonnumeric milestone values never open external addresses',async t=>{
 const dir=fixture(t);seed(dir,4);let calls=0;const usage=make(dir,async()=>calls++);usage.start();
 for(const count of [10,'5',null,0,-1,Infinity,NaN,PROJECT])await assert.rejects(()=>usage.open(count),/启动提示已处理/);
 assert.equal(calls,0);assert.equal(usage.start().count,5);
});
test('invalid or oversized usage files are left intact and do not block startup',t=>{
 const dir=fixture(t);
 for(const text of ['broken',JSON.stringify({version:1,count:-1,notified:[]}),JSON.stringify({version:1,count:4,notified:[50]}),JSON.stringify({version:2,count:4,notified:[]}),JSON.stringify({version:1,count:Number.MAX_SAFE_INTEGER+1,notified:[]}), ' '.repeat(5000)]){
  fs.writeFileSync(file(dir),text);assert.equal(make(dir).start(),null);assert.equal(fs.readFileSync(file(dir),'utf8'),text);
 }
});
test('protected materials and linked profile paths are never written by the counter',t=>{
 const dir=fixture(t),source=path.join(dir,'materials');fs.mkdirSync(source);seed(source,4);const before=fs.readFileSync(file(source));assert.equal(make(source,async()=>{},[source]).start(),null);assert.deepEqual(fs.readFileSync(file(source)),before);
 const alias=path.join(dir,'alias');fs.symlinkSync(source,alias,'junction');assert.equal(make(alias).start(),null);assert.deepEqual(fs.readFileSync(file(source)),before);
});
test('hard-linked usage files are not replaced or modified',t=>{
 const dir=fixture(t),outside=path.join(dir,'keep.json');fs.writeFileSync(outside,JSON.stringify({version:1,count:4,notified:[]}));fs.linkSync(outside,file(dir));const before=fs.readFileSync(outside);
 assert.equal(make(dir).start(),null);assert.deepEqual(fs.readFileSync(outside),before);assert.equal(fs.statSync(file(dir)).nlink,2);
});
test('library migration carries counter history while ordinary backup restore does not rewind it',async t=>{
 const root=fixture(t),old=path.join(root,'old'),next=path.join(root,'next'),backup=path.join(root,'backup.json');const store=new Store(old,[]);store.exportData(backup);store.close();seed(old,9,[5]);
 await copyLibraryData(old,next,[],true);assert.deepEqual(fs.readFileSync(file(next)),fs.readFileSync(file(old)));assert.equal(make(next).start().count,10);
 const restored=new Store(next,[]);restored.importData(backup);restored.close();assert.equal(JSON.parse(fs.readFileSync(file(next))).count,10);assert.equal(make(next).start(),null);
});
