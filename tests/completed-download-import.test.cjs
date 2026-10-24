const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Store}=require('../dist/main/main/store'),{DownloadFolders}=require('../dist/main/main/download-folders');
const imports=require('../dist/main/main/booth-import');
test('Baidu completed file registers incrementally, stays idempotent, and survives backup without scanning sources',async t=>{
 assert.equal(typeof imports.importCompletedDownload,'function','completed downloads need a provider-neutral registration path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-completed-import-')),source=path.join(root,'Sources'),data=path.join(root,'Library'),downloads=path.join(root,'Downloads');for(const p of [source,data,downloads])fs.mkdirSync(p);
 const original=path.join(source,'original.txt');fs.writeFileSync(original,'ORIGINAL');const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(original)).digest('hex'),before=hash();let store=new Store(data,[source]);let restored;
 t.after(()=>{store.close();restored?.close();assert.equal(hash(),before);assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true})});
 const {file}=new DownloadFolders(data,()=>[source]).reserve(downloads,'baidu','opaque-share|dress','Dress','Dress_Shinano.rar');fs.writeFileSync(file,'COMPLETE SYNTHETIC ARCHIVE');
 const one=await imports.importCompletedDownload(store,file,path.dirname(file),'baidu');assert.equal(store.all().length,1);let item=store.getRaw(one.assetId);assert.equal(item.group,'百度网盘下载');assert.equal(item.kind,'archive');assert.equal(item.path,file);assert.equal(item.online.confirmedSource,undefined);assert.deepEqual(item.hintUrls,[]);
 store.updateManual([item.id],{title:'已确认的名称',hidden:true,matchingMode:'manual'});const two=await imports.importCompletedDownload(store,file,path.dirname(file),'baidu');assert.equal(one.assetId,two.assetId);assert.equal(store.all().length,1);assert.equal(store.getRaw(item.id).manual.title,'已确认的名称');assert.equal(store.getRaw(item.id).manual.hidden,true);
 const backup=path.join(root,'backup.json');store.exportData(backup);const doc=JSON.parse(fs.readFileSync(backup,'utf8'));assert.deepEqual(doc.downloadPaths,[file]);assert.doesNotMatch(fs.readFileSync(backup,'utf8'),/opaque-share|BDUSS|pwd=/);
 const second=path.join(root,'Restored');fs.mkdirSync(second);restored=new Store(second,[source]);restored.importData(backup);assert.equal(restored.getRaw(item.id).path,file);assert.equal(restored.getRaw(item.id).manual.title,'已确认的名称');assert.deepEqual(fs.readdirSync(source),['original.txt']);assert.equal(hash(),before);
});
