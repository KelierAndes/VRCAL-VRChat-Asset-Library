const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../dist/main/main/store'),{copyLibraryData}=require('../dist/main/main/storage');
test('moving a library carries only the isolated Xianyu session and encrypted mirror, while a normal backup excludes them',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-xy-migration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'old'),target=path.join(root,'new'),store=new Store(source,[]),backup=path.join(root,'backup.json');
 fs.mkdirSync(path.join(source,'xianyu-session'));fs.writeFileSync(path.join(source,'xianyu-session','Cookies'),'PRIVATE-SYNTHETIC-COOKIE');
 fs.writeFileSync(path.join(source,'xianyu-session-cookies.bin'),'SYNTHETIC-ENCRYPTED-MIRROR');
 store.exportData(backup);store.close();await copyLibraryData(source,target,[],true);
 assert.equal(fs.readFileSync(path.join(target,'xianyu-session','Cookies'),'utf8'),'PRIVATE-SYNTHETIC-COOKIE');
 assert.equal(fs.readFileSync(path.join(target,'xianyu-session-cookies.bin'),'utf8'),'SYNTHETIC-ENCRYPTED-MIRROR');
 assert(!fs.readFileSync(backup,'utf8').includes('SYNTHETIC'));assert(fs.existsSync(path.join(source,'xianyu-session','Cookies')));
});
