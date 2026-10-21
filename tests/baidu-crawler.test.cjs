const test=require('node:test'),assert=require('node:assert/strict');
const account='baidu:'+'a'.repeat(64);
const capture=(path,items)=>({accountKey:account,directoryPath:path,items:items.map(([name,directory])=>({name,directory,path:path+'/'+name})),capturedAt:new Date().toISOString(),complete:false,source:'web-visible',warnings:[]});
function make(driver,extra={}){const {BaiduCrawler}=require('../dist/main/main/baidu-crawler');let saved;const crawler=new BaiduCrawler({identity:async()=>account,readDirectory:driver,commit:async()=>{},save:data=>{saved=structuredClone(data)},onChanged(){},...extra});return {crawler,saved:()=>saved}}
test('recursive reader follows every unique child only inside selected parent and deduplicates scroll batches',async()=>{
 const read=[];const {crawler}=make(async(path,accept)=>{read.push(path);const c=path==='/素材'?capture(path,[['衣装',true],['发型',true],['A.zip',false]]):capture(path,[['B.zip',false]]);await accept(c);await accept(c)});
 await crawler.start('/素材');await crawler.waitIdle();
 assert.deepEqual(read,['/素材','/素材/衣装','/素材/发型']);assert.equal(crawler.state().filesRead,3);assert.equal(crawler.state().directoriesRead,3);assert.equal(crawler.state().phase,'completed');
});
test('pause/restart resumes the pending directory without repeating completed directories or losing committed entries',async()=>{
 let first=true,release;const gate=new Promise(resolve=>{release=resolve});
 const {crawler,saved}=make(async(path,accept,check)=>{await accept(capture(path,[['Child',true],['A.zip',false]]));if(first){first=false;await gate;check()}});
 await crawler.start('/素材');await new Promise(resolve=>setImmediate(resolve));crawler.pause();release();await crawler.waitIdle();assert.equal(crawler.state().phase,'paused');assert.equal(crawler.state().filesRead,1);
 const visits=[],{crawler:restored}=make(async(path,accept)=>{visits.push(path);await accept(capture(path,path==='/素材'?[['Child',true]]:[]))},{load:saved});
 assert.equal(restored.state().phase,'paused');await restored.resume();await restored.waitIdle();assert.deepEqual(visits,['/素材','/素材/Child']);assert.equal(restored.state().filesRead,1);
});
test('account changes pause before committing and out-of-scope captures cannot escape to sibling folders',async()=>{
 let commits=0,current=account;
 const {crawler}=make(async(path,accept)=>{current='baidu:'+'b'.repeat(64);await accept(capture(path,[['secret.zip',false]]))},{identity:async()=>current,commit:async()=>{commits++}});
 await crawler.start('/素材');await crawler.waitIdle();assert.equal(commits,0);assert.equal(crawler.state().phase,'paused');
 const other=make(async(path,accept)=>accept(capture('/其他',[['a.zip',false]])));await other.crawler.start('/素材');await other.crawler.waitIdle();assert.equal(other.crawler.state().failedDirectories,1);assert.equal(other.crawler.state().directoriesRead,0);
});
test('failed subfolders remain retryable while siblings continue; stopping never discards captured metadata',async()=>{
 let fail=true;const visits=[];let commits=0;
 const {crawler}=make(async(path,accept)=>{visits.push(path);if(path.endsWith('/A')&&fail)throw new Error('unsupported');await accept(capture(path,path==='/素材'?[['A',true],['B',true]]:[]))},{commit:async()=>{commits++}});
 await crawler.start('/素材');await crawler.waitIdle();assert.equal(crawler.state().failedDirectories,1);assert.deepEqual(visits,['/素材','/素材/A','/素材/B']);
 fail=false;await crawler.retry();await crawler.waitIdle();assert.equal(crawler.state().failedDirectories,0);assert.equal(visits.at(-1),'/素材/A');assert.equal(commits,3);
});
test('a task storage failure pauses without an unhandled background rejection or another directory read',async()=>{
 let writes=0,reads=0;
 const {crawler}=make(async(path,accept)=>{reads++;await accept(capture(path,[['A',true]]))},{save:()=>{if(++writes>1)throw new Error('disk-full')}});
 await crawler.start('/素材');await crawler.waitIdle();assert.equal(reads,1);assert.equal(crawler.state().phase,'paused');
});
