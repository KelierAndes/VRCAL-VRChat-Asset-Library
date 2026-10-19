const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
process.env.NODE_ENV='test';
const {EnrichmentQueue}=require('../dist/main/main/online');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzX8AAAAASUVORK5CYII=','base64');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),source=id=>'https://booth.pm/ja/items/'+id;
const html=body=>new Response(body,{headers:{'content-type':'text/html'}});
const product=(id,title,cover)=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:source(id),name:title,brand:{name:'Shop'},...(cover?{image:cover}:{})})+'</script>';
const asset=(id,name='Moon Dress.zip')=>({id,name,path:'E:\\VRChat\\fixture-'+id+'.zip',group:'Airi',kind:'archive',missing:false,size:10,mtimeMs:0,localCategory:'服装',localAvatars:['Airi'],hintUrls:[],manual:{notes:'private note '+id,tags:[id]},online:{status:'pending'},createdAt:'',updatedAt:''});
function setup(t,items,fetch){
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-group-source-')),updates=[],calls=[];
 const queue=new EnrichmentQueue({dataDir,roots:()=>['E:\\VRChat'],all:()=>items,get:id=>items.find(item=>item.id===id)||null,updateOnline:(id,patch)=>{updates.push({id,patch});const item=items.find(item=>item.id===id);item.online={...item.online,...patch};},fetch:async(url,init)=>{calls.push(url);return fetch(url,init);},testing:{intervalMs:0,lookup:async()=>['93.184.216.34']}});
 t.after(async()=>{queue.stop();await queue.waitIdle();fs.rmSync(dataDir,{recursive:true,force:true});});return {queue,updates,calls};
}
async function idle(queue){for(let i=0;i<600&&queue.progress.running;i++)await wait(5);assert(!queue.progress.running);await queue.waitIdle();}

test('another member cannot overwrite a new group binding after its old page or cover request finishes',async t=>{
 for(const phase of ['page','cover']){
  const items=[asset('a'),asset('b','Moon Dress_v1.0.zip')],chosen=source('7654321');let release,started;
  const began=new Promise(resolve=>started=resolve),held=new Promise(resolve=>release=resolve);
  const f=setup(t,items,async url=>{
   if(url.includes('/search/'))return html('<div class="item-card"><a class="item-card__title" href="/ja/items/1234567">Moon Dress</a></div>');
   if(url===source('1234567')){if(phase==='page'){started();await held;}return html(product('1234567','Moon Dress','https://cdn.example.org/old.png'));}
   if(url.endsWith('/old.png')){if(phase==='cover'){started();await held;}return new Response(png,{headers:{'content-type':'image/png'}});}
   return html(product('7654321','Star Dress'));
  });
  await f.queue.enqueue();await began;await wait(5);
  for(const item of items)item.manual={...item.manual,sourceUrl:chosen};
  items[1].online={...items[1].online,status:'pending',url:chosen,title:'New binding placeholder',coverFile:'offline.png'};
  // Only one member gets a replacement job here, deliberately reproducing the
  // old dispatcher while the queue itself must protect the other member.
  await f.queue.linkSource('a',chosen);release();await idle(f.queue);
  assert(!f.updates.some(update=>update.id==='b'&&update.patch.status==='matched'),phase+' old member cannot assign its former product');
  assert.equal(items[1].online.url,chosen);assert.equal(items[1].online.title,'New binding placeholder');assert.equal(items[1].online.coverFile,'offline.png');assert.equal(items[1].manual.notes,'private note b');
  await f.queue.linkSource('b',chosen);await idle(f.queue);assert.equal(items[1].online.candidates[0].url,chosen);assert.equal(items[1].manual.sourceUrl,chosen);
 }
});

test('group confirmation requires a current bound source, honors rejections and shares actual cover bytes',async t=>{
 const chosen=source('7654321'),cover='https://cdn.example.org/star.png',body=product('7654321','Star Dress',cover),items=[asset('a'),asset('b')];
 items[0].online={status:'review',candidates:[{url:chosen,title:'Star Dress',coverUrl:cover}]};items[1].online={status:'pending'};
 for(const item of items)item.manual={...item.manual,sourceUrl:chosen};
 const f=setup(t,items,async url=>{await wait(30);return url===cover?new Response(png,{headers:{'content-type':'image/png'}}):html(body);});
 await assert.rejects(f.queue.acceptCandidate('b',chosen),/候选|来源/,'default two-argument acceptance remains strict');
 items[1].manual.sourceUrl=source('1234567');await assert.rejects(f.queue.acceptCandidate('b',chosen,true),/候选|来源/,'group flag cannot authorize a different manual binding');
 items[1].manual.sourceUrl=chosen;items[1].online.rejectedUrls=['https://shop.booth.pm/en/items/7654321'];await assert.rejects(f.queue.acceptCandidate('b',chosen,true),/排除/,'group trust never bypasses a rejected canonical item');items[1].online.rejectedUrls=[];
 await Promise.all(items.map(item=>f.queue.acceptCandidate(item.id,chosen,true)));await idle(f.queue);
 assert.deepEqual(f.calls.sort(),[chosen,cover,'https://booth.pm/en/search/Star%20Dress'].sort());assert.equal(f.queue.progress.downloadedBytes,Buffer.byteLength(body)*2+png.length);
 for(const item of items){assert.equal(item.online.url,chosen);assert.equal(item.online.status,'matched');assert.equal(item.online.confirmedSource,true);assert.equal(item.online.matchEvidence.method,'manual');assert.equal(item.manual.sourceUrl,chosen);assert.equal(item.manual.notes,'private note '+item.id);}
 assert.equal(items[0].online.coverFile,items[1].online.coverFile);
});
