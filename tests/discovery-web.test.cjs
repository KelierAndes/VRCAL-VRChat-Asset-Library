const {test}=require('node:test'),assert=require('node:assert/strict');
const {buildWebDiscoveryPrompt,parseWebDiscoveryReply}=require('../dist/main/main/discovery-web');
const {ProductDiscovery}=require('../dist/main/main/discovery');
const request={description:'我想要黑白配色的哥特蕾丝礼裙',avatar:'Shinano',platforms:['booth']};
const plan={summary:'哥特蕾丝礼裙',boothQueries:['ゴシック ドレス しなの','gothic dress Shinano'],xianyuQuery:'VRChat 哥特 蕾丝 礼裙 Shinano',terms:['ゴシック','ドレス','gothic','dress','蕾丝']};
const html='<div class="market-items"><div class="item-card" data-product-id="1234567"><a class="item-card__title" href="/ja/items/1234567">Gothic Dress Shinano</a></div></div>';
const wait=async s=>{for(let i=0;i<100;i++){if(!s.snapshot().running)return s.snapshot();await new Promise(r=>setTimeout(r,3))}throw Error('timeout')};
test('web prompt is bounded, redacted and only opens a fixed official provider',()=>{
 const built=buildWebDiscoveryPrompt('qwen',{...request,description:request.description+' C:\\Users\\PrivateAlice\\private.png https://pan.baidu.com/s/private?pwd=1234',apiKey:'SECRET'});
 assert.equal(built.url,'https://www.qianwen.com/');assert(built.prompt.includes('VRChat'));assert(built.prompt.includes('boothQueries'));assert(built.prompt.includes('Shinano'));
 for(const secret of ['PrivateAlice','pan.baidu','SECRET'])assert(!built.prompt.includes(secret));
 assert.throws(()=>buildWebDiscoveryPrompt('https://evil.example',request));assert.throws(()=>buildWebDiscoveryPrompt('kimi',{...request,description:'x'.repeat(601)}));
 assert.equal(buildWebDiscoveryPrompt('kimi',request).url,'https://www.kimi.com/');assert.equal(buildWebDiscoveryPrompt('deepseek',request).url,'https://chat.deepseek.com/');
});
test('web response accepts one plain or fenced JSON plan and rejects links, extras and oversized data',()=>{
 assert.deepEqual(parseWebDiscoveryReply(JSON.stringify(plan)),plan);assert.deepEqual(parseWebDiscoveryReply('```json\n'+JSON.stringify(plan)+'\n```'),plan);
 for(const raw of [JSON.stringify({...plan,boothQueries:['https://evil.example']}),JSON.stringify({...plan,products:[]}),JSON.stringify({...plan,boothQueries:[]}),JSON.stringify({...plan,boothQueries:['gothic\ndress']}),JSON.stringify({...plan,xianyuQuery:'VRChat\t礼裙'}),'<script>bad</script>','x'.repeat(16001),'Text before\n```json\n'+JSON.stringify(plan)+'\n```'])assert.throws(()=>parseWebDiscoveryReply(raw));
});

test('explicit manual fallback accepts the full in-app answer envelope but rejects extra fields and malformed request IDs',()=>{
 const envelope={requestId:'11111111-1111-4111-8111-111111111111',plan};assert.deepEqual(parseWebDiscoveryReply(JSON.stringify(envelope)),plan);assert.deepEqual(parseWebDiscoveryReply('```json\n'+JSON.stringify(envelope)+'\n```'),plan);
 for(const value of [{...envelope,products:[]},{...envelope,requestId:'wrong'},{requestId:envelope.requestId,plan:{...plan,products:[]}}])assert.throws(()=>parseWebDiscoveryReply(JSON.stringify(value)));
});
test('web plan searches actual cards without API calls, does not invent products and keeps old results on invalid input',async()=>{
 let aiCalls=0;const queries=[];const service=new ProductDiscovery({ai:()=>({planSearch:async()=>{aiCalls++;throw Error('must not call API')},cancel:()=>true}),canNetwork:()=>true,xianyuEnabled:()=>false,booth:async(url)=>{queries.push(url);return {html,url}},xianyu:async()=>[],cover:async()=>''});
 service.startWithWebPlan(request,JSON.stringify(plan));const result=await wait(service);assert.equal(aiCalls,0);assert.equal(result.method,'web-ai');assert.equal(result.products.length,1);assert(result.notice.includes('你提供'));assert(queries[0].includes(encodeURIComponent('ゴシック ドレス しなの')));
 assert.throws(()=>service.startWithWebPlan(request,'bad'));assert.deepEqual(service.snapshot(),result);assert.throws(()=>service.startWithWebPlan({...request,platforms:['xianyu']},JSON.stringify(plan)),/启用/);
});
test('offline web search does not start network or cancel previous useful state',()=>{
 let calls=0;const service=new ProductDiscovery({ai:()=>({cancel:()=>true}),canNetwork:()=>false,xianyuEnabled:()=>true,booth:async()=>{calls++;return {html,url:''}},xianyu:async()=>[],cover:async()=>''});
 assert.throws(()=>service.startWithWebPlan(request,JSON.stringify(plan)),/联网/);assert.equal(calls,0);assert.equal(service.snapshot().running,false);
});
test('cancelling web-planned search discards late cards without affecting a following search',async()=>{
 let resolve;let calls=0;const service=new ProductDiscovery({ai:()=>({cancel:()=>true}),canNetwork:()=>true,xianyuEnabled:()=>true,booth:url=>++calls===1?new Promise(r=>resolve=()=>r({html,url})):Promise.resolve({html:html.replaceAll('1234567','7654321'),url}),xianyu:async()=>[],cover:async()=>''});
 service.startWithWebPlan(request,JSON.stringify(plan));await new Promise(r=>setTimeout(r,5));service.cancel();service.startWithWebPlan(request,JSON.stringify(plan));resolve();const result=await wait(service);assert.equal(result.products.length,1);assert.equal(result.products[0].url,'https://booth.pm/ja/items/7654321');
});
