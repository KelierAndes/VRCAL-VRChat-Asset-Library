'use strict';
// Uses only a copy of the synthetic UI acceptance library. Original profile is read-only here.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Store}=require('../dist/main/main/store'),{copyLibraryData}=require('../dist/main/main/storage');
const work=path.resolve(__dirname,'../..'),input=path.resolve(process.argv[2]||'');
assert(path.dirname(input)===work&&path.basename(input).startsWith('x-ui-v18-'),'Supply a synthetic x-ui-v18-* run directory');
assert(!fs.lstatSync(input).isSymbolicLink());
const fixture=JSON.parse(fs.readFileSync(path.join(input,'fixtures.json'),'utf8')),source=path.join(input,'Materials');
const run=fs.mkdtempSync(path.join(work,'x-storage-v18-')),checks=[];let active;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifest=dir=>fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{const file=path.join(dir,entry.name);assert(!fs.lstatSync(file).isSymbolicLink());return entry.isDirectory()?[[path.relative(source,file).replaceAll('\\','/'),'directory'],...manifest(file)]:[[path.relative(source,file).replaceAll('\\','/'),hash(file)]]});
function pass(label){checks.push(label);console.log('STORAGE X V18 PASS:',label)}
function open(dir){active=new Store(dir,[source]);return active}
function close(){active?.close();active=undefined}
function covers(store,dir){return Object.fromEntries(store.all().map(record=>[record.id,[record.manual.coverFile,record.online.coverFile,record.previewFile,...(record.online.candidates||[]).map(c=>c.coverFile)].filter(Boolean).map(name=>hash(path.join(dir,'cache',name)))]))}
(async()=>{try{
 const initial=path.join(run,'Copied');await copyLibraryData(path.join(input,'Library'),initial,[source],true);
 let store=open(initial);store.introduceXTheme();assert.equal(store.settings().theme,'nasa');assert.equal(store.settings().xThemeIntroduced,true);
 const coverHashes=covers(store,initial),records=store.all().map(r=>({id:r.id,manual:r.manual}));assert.equal(records.length,23);assert.deepEqual(manifest(source),fixture.sourceBefore);
 const exported=path.join(run,'LibraryBackup.json');store.exportData(exported);assert(Object.keys(JSON.parse(fs.readFileSync(exported)).covers).length>=21);close();
 const migrated=path.join(run,'Migrated');const copied=await copyLibraryData(initial,migrated,[source],true);store=open(migrated);store.introduceXTheme();
 assert.equal(store.settings().theme,'nasa');assert.equal(store.settings().xThemeIntroduced,true);assert.deepEqual(covers(store,migrated),coverHashes);assert.deepEqual(store.all().map(r=>({id:r.id,manual:r.manual})),records);assert.equal(store.sourceUndoInfo().token,fixture.history.token);close();
 pass(`Migration retains chosen NASA theme, introduction marker, 23 records, manual relations, source undo and 21 colorful covers (${copied.files} verified files)`);
 const restored=path.join(run,'Restored');store=open(restored);store.importData(exported);store.introduceXTheme();assert.equal(store.settings().theme,'nasa');assert.equal(store.settings().xThemeIntroduced,true);assert.deepEqual(covers(store,restored),coverHashes);
 assert.equal(store.all().length,23);const before=records.find(r=>r.id===fixture.ids[0]).manual,after=store.getRaw(fixture.ids[0]).manual;assert.deepEqual(after,before);for(const id of fixture.projectIds)assert.deepEqual(store.getRaw(id).manual.relatedIds,records.find(r=>r.id===id).manual.relatedIds);close();
 store=open(restored);store.introduceXTheme();assert.equal(store.settings().theme,'nasa');assert.equal(store.settings().xThemeIntroduced,true);close();
 pass('Verified backup restore and restart retain NASA choice, annotations, favorites, project links and every cover hash');
 store=open(restored);store.saveSettings({theme:'x'});const xBackup=path.join(run,'XBackup.json');store.exportData(xBackup);close();
 const restoredX=path.join(run,'RestoredX');store=open(restoredX);store.importData(xBackup);store.introduceXTheme();assert.equal(store.settings().theme,'x');assert.equal(store.settings().xThemeIntroduced,true);assert.deepEqual(covers(store,restoredX),coverHashes);close();
 assert.deepEqual(manifest(source),fixture.sourceBefore);pass('X backup restores X with full-color covers; every synthetic original name and hash stays unchanged');
 fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({ok:true,checks,input,run,liveDataAccess:false},null,2));console.log('STORAGE X V18 REPORT:',path.join(run,'report.json'));
}catch(error){fs.writeFileSync(path.join(run,'report.json'),JSON.stringify({ok:false,checks,error:error.stack,input,run},null,2));console.error(error);process.exitCode=1}finally{close()}})();
