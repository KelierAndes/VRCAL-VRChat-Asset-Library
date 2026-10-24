const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {copyLibraryData}=require('../dist/main/main/storage');
const {Store,safeBoothDownloadPath}=require('../dist/main/main/store');
function fixture(t){const base=fs.mkdtempSync(path.join(__dirname,'.fixtures-web-ai-storage-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true,maxRetries:3}));return base}
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
test('all three official AI sessions migrate with verified cookie mirrors while browser caches remain behind',async t=>{
 const base=fixture(t),source=path.join(base,'old'),target=path.join(base,'new'),store=new Store(source,[]);store.close();const snapshots=[];
 for(const provider of ['qwen','kimi','deepseek']){const profile='ai-web-'+provider,folder=path.join(source,profile);fs.mkdirSync(path.join(folder,'Local Storage'),{recursive:true});fs.mkdirSync(path.join(folder,'Cache'));fs.mkdirSync(path.join(folder,'Network'));fs.writeFileSync(path.join(folder,'Local Storage','account'),'isolated-'+provider);fs.writeFileSync(path.join(folder,'Cache','data'),'rebuildable cache');fs.writeFileSync(path.join(folder,'Network','Cookies'),'locked native DB');const mirror=path.join(source,profile+'-cookies.bin');fs.writeFileSync(mirror,'encrypted-fixture-'+provider);snapshots.push({profile,sha256:hash(mirror)})}
 await copyLibraryData(source,target,[],true,snapshots);
 for(const {profile,sha256} of snapshots){assert.equal(hash(path.join(target,profile+'-cookies.bin')),sha256);assert.equal(hash(path.join(source,profile+'-cookies.bin')),sha256);assert(fs.existsSync(path.join(target,profile,'Local Storage','account')));assert(!fs.existsSync(path.join(target,profile,'Cache','data')));assert(!fs.existsSync(path.join(target,profile,'Network','Cookies')));assert(fs.existsSync(path.join(source,profile,'Network','Cookies')))}
});
test('AI session storage cannot become a restored BOOTH download reference',t=>{
 const base=fixture(t),profile=path.join(base,'Library');fs.mkdirSync(profile);for(const provider of ['qwen','kimi','deepseek']){const file=path.join(profile,'ai-web-'+provider,'booth-'+crypto.randomUUID(),'private.bin');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'private fixture');assert.throws(()=>safeBoothDownloadPath(file,profile,[]),/应用资料/)}
});
test('ordinary library backup contains no official AI session bytes or cookie mirrors',t=>{
 const base=fixture(t),profile=path.join(base,'Library'),store=new Store(profile,[]),backup=path.join(base,'backup.json');for(const provider of ['qwen','kimi','deepseek']){const folder=path.join(profile,'ai-web-'+provider);fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'Cookies'),'AI_LOGIN_SECRET_'+provider);fs.writeFileSync(folder+'-cookies.bin','AI_MIRROR_SECRET_'+provider)}store.exportData(backup);store.close();const data=fs.readFileSync(backup,'utf8');assert(!data.includes('AI_LOGIN_SECRET'));assert(!data.includes('AI_MIRROR_SECRET'));assert(!data.includes('ai-web-'));
});
