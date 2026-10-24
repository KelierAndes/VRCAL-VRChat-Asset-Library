const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
process.env.NODE_ENV='test';
const {Store}=require('../dist/main/main/store'),{EnrichmentQueue}=require('../dist/main/main/online'),{importBoothDownload}=require('../dist/main/main/booth-import');
const source=id=>'https://booth.pm/ja/items/'+id,correct=source('7654321'),old=source('1234567');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzX8AAAAASUVORK5CYII=','base64');
const html=body=>new Response(body,{headers:{'content-type':'text/html'}});
const product=(id,title,cover)=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',url:source(id),name:title,brand:{name:'Fixture Creator'},image:cover})+'</script><div class="market-item-detail-article"><div class="item-category"><a href="/en/browse/3D%20Clothing">3D Clothing</a></div></div>';
async function setup(t,phase='page',fail=false){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-booth-binding-race-')),dataDir=path.join(base,'data'),downloads=path.join(base,'downloads'),file=path.join(downloads,'Moon Dress.zip');fs.mkdirSync(downloads);fs.writeFileSync(file,'original completed download bytes');const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),before=hash(),store=new Store(dataDir,[]),{assetId}=await importBoothDownload(store,file,undefined,downloads);
 let release,started,held=false;const began=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve),updates=[],calls=[];
 const queue=new EnrichmentQueue({dataDir,roots:()=>[],all:()=>store.all(),get:id=>store.getRaw(id),updateOnline:(id,patch)=>{updates.push(structuredClone(patch));store.updateOnline(id,patch)},testing:{intervalMs:0,lookup:async()=>['93.184.216.34']},fetch:async url=>{
  calls.push(url);const hold=phase==='page'?url===old:url==='https://cdn.example.org/old.png';
  if(hold&&!held){held=true;started();await gate;if(fail)throw new Error('late failure from replaced source')}
  if(url.includes('cdn.example.org'))return new Response(png,{headers:{'content-type':'image/png'}});
  if(url.includes('/search/'))return html('<div class="item-card"><a class="item-card__title" href="/ja/items/1234567">Moon Dress</a></div>');
  return html(url===correct?product('7654321','Completely different correct product','https://cdn.example.org/correct.png'):product('1234567','Moon Dress','https://cdn.example.org/old.png'));
 }});
 t.after(async()=>{queue.stop();release();await queue.waitIdle();assert.equal(hash(),before);store.close();const resolved=fs.realpathSync(base);assert(path.basename(resolved).startsWith('vrc-booth-binding-race-')&&path.dirname(resolved)===fs.realpathSync(os.tmpdir()));fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3})});
 return {store,queue,assetId,downloads,file,began,release,updates,calls,repair:()=>importBoothDownload(store,file,correct,downloads)};
}
test('restoring a download source replaces an old page or cover worker and completes the correct product and cover',async t=>{
 for(const phase of ['page','cover']){const f=await setup(t,phase);await f.queue.enqueue();await f.began;await f.repair();await f.queue.enqueue([f.assetId]);f.release();await f.queue.waitIdle();const asset=f.store.getRaw(f.assetId);
  assert.equal(asset.online.url,correct);assert.equal(asset.online.status,'matched');assert.equal(asset.online.title,'Completely different correct product');assert.equal(asset.online.confirmedSource,true);assert.equal(asset.online.matchEvidence.method,'booth-download');assert(asset.online.coverFile&&fs.existsSync(path.join(f.store.dataDir,'cache',asset.online.coverFile)));assert(f.calls.includes(correct));assert(!f.updates.some(patch=>patch.url===old||patch.status==='matched'&&patch.title==='Moon Dress'));assert.equal(f.queue.progress.paused,false);
 }
});
test('a late old-source failure cannot replace the restored binding or pause unrelated queue work',async t=>{
 const f=await setup(t,'page',true);await f.queue.enqueue();await f.began;await f.repair();f.release();await f.queue.waitIdle();const asset=f.store.getRaw(f.assetId);assert.equal(asset.online.url,correct);assert.equal(asset.online.status,'pending');assert.equal(asset.online.confirmedSource,true);assert.equal(f.queue.progress.paused,false);assert(!f.updates.some(patch=>patch.status==='failed'));
 await f.queue.enqueue([f.assetId]);await f.queue.waitIdle();assert.equal(f.store.getRaw(f.assetId).online.status,'matched');
});
test('pause and immediate resume keep the replacement download job without reviving its old source',async t=>{
 const f=await setup(t);await f.queue.enqueue();await f.began;await f.repair();await f.queue.enqueue([f.assetId]);f.queue.pause();await f.queue.resume();f.release();await f.queue.waitIdle();const asset=f.store.getRaw(f.assetId);assert.equal(asset.online.url,correct);assert.equal(asset.online.status,'matched');assert.equal(asset.online.matchEvidence.method,'booth-download');assert(!f.updates.some(patch=>patch.url===old));assert.equal(f.queue.progress.pending,0);
});
