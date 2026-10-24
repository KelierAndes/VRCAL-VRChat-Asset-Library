const {test}=require('node:test'),assert=require('node:assert/strict');
let api;try{api=require('../dist/main/main/link-inbox-reader')}catch{}
const now=Date.parse('2026-10-24T04:00:00Z'),context={now,hours:6};
const row=(extra={})=>({key:'message-1',text:'https://pan.baidu.com/s/1SyntheticLink 提取码: Ab12',time:'今天 11:30',kind:'message',...extra});
const snapshot=(extra={})=>({url:'https://www.goofish.com/im',account:'synthetic-account-a',supported:true,rows:[row()],...extra});
test('scoped reader accepts recent links and hashes account identity before returning observations',()=>{
 assert.equal(typeof api?.interpretInboxSnapshot,'function');const result=api.interpretInboxSnapshot('xianyu',snapshot(),'foreground',context);
 assert.equal(result.state,'ready');assert.equal(result.observations.length,1);const o=result.observations[0];assert.equal(o.sourceAt,Date.parse('2026-10-24T03:30:00Z'));assert.match(o.accountKey,/^[a-f0-9]{64}$/);assert(!JSON.stringify(result).includes('synthetic-account-a'));
});
test('old, future, ambiguous time and unknown day do not become recent notifications',()=>{
 const s=snapshot({rows:[row({key:'old',time:'2026-10-20 11:30'}),row({key:'unknown',time:'11:30'}),row({key:'future',time:'2026-10-25 11:30'}),row({key:'malformed',time:'2026-02-30 11:30'})]});
 const result=api.interpretInboxSnapshot('xianyu',s,'foreground',context);assert.equal(result.observations.length,3);for(const o of result.observations)assert.equal(o.sourceAt,undefined);
});
test('background examines only unread previews with known recent times and never chat history',()=>{
 const s=snapshot({rows:[row(),row({key:'read',kind:'conversation',unread:false}),row({key:'unknown',kind:'conversation',unread:true,time:'11:30'}),row({key:'recent',kind:'conversation',unread:true})]});
 const result=api.interpretInboxSnapshot('xianyu',s,'background',context);assert.deepEqual(result.observations.map(o=>o.sourceKey),['recent']);
});
test('wrong hosts, missing account proof, loading/unknown structure and login pages fail closed',()=>{
 for(const extra of [{url:'https://www.goofish.com.evil.invalid/im'},{url:'https://www.goofish.com/item?id=1'},{account:''},{supported:false},{login:true}]){
  const r=api.interpretInboxSnapshot('xianyu',snapshot(extra),'foreground',context);assert.notEqual(r.state,'ready');assert.deepEqual(r.observations,[]);
 }
});
test('BOOTH only accepts concrete owned purchase pages; product links and signed download URLs are discarded',()=>{
 const s=snapshot({url:'https://accounts.booth.pm/library',rows:[row({kind:'purchase',key:'123',time:'2026-10-24T11:30:00+09:00',text:'',purchaseUrl:'https://accounts.booth.pm/orders/123'}),row({kind:'purchase',key:'product',purchaseUrl:'https://shop.booth.pm/items/123'}),row({kind:'purchase',key:'token',purchaseUrl:'https://accounts.booth.pm/orders/456?token=PRIVATE'})]});
 const result=api.interpretInboxSnapshot('booth',s,'background',context);assert.equal(result.observations.length,1);assert.equal(result.observations[0].boothDownloadPage,'https://accounts.booth.pm/orders/123');assert.equal(result.observations[0].sourceAt,Date.parse('2026-10-24T02:30:00Z'));assert(!JSON.stringify(result).includes('PRIVATE'));
});
test('oversized or malformed page payloads cannot reach the inbox',()=>{
 for(const value of [null,{},snapshot({rows:Array(101).fill(row())}),snapshot({account:'x'.repeat(513)}),snapshot({rows:[row({text:'x'.repeat(32769)})]})])assert.notEqual(api.interpretInboxSnapshot('xianyu',value,'foreground',context).state,'ready');
});
test('account or URL changes between capture and verification discard all observations',async()=>{
 const controller=new AbortController();let reads=0;const contents={isDestroyed:()=>false,getURL:()=> 'https://www.goofish.com/im',executeJavaScript:async()=>++reads===1?snapshot():snapshot({account:'synthetic-account-b',rows:[]})};
 const result=await api.readOwnedInbox('xianyu',[contents],'foreground',controller.signal,context,()=>true);
 assert.notEqual(result.state,'ready');assert.deepEqual(result.observations,[]);assert.equal(reads,2);
});
test('disabling or aborting during page evaluation discards the in-flight result',async()=>{
 let permitted=true;const controller=new AbortController();const contents={isDestroyed:()=>false,getURL:()=> 'https://www.goofish.com/im',executeJavaScript:async()=>{permitted=false;controller.abort();return snapshot()}};
 const result=await api.readOwnedInbox('xianyu',[contents],'foreground',controller.signal,context,()=>permitted);assert.equal(result.state,'paused');assert.deepEqual(result.observations,[]);
});
test('date-only old purchases are excluded; current date-only purchases remain unverified in foreground',()=>{
 const s=snapshot({url:'https://accounts.booth.pm/library',rows:['2026年10月20日','2026-10-24'].map((time,i)=>row({kind:'purchase',key:String(i),time,purchaseUrl:'https://accounts.booth.pm/orders/'+(i+10)}))});
 const foreground=api.interpretInboxSnapshot('booth',s,'foreground',context);assert.equal(foreground.observations.length,1);assert.equal(foreground.observations[0].sourceAt,undefined);assert.equal(api.interpretInboxSnapshot('booth',s,'background',context).observations.length,0);
});
test('selected six hour window and exact platform timezone control recency',()=>{
 for(const platform of ['booth','xianyu']){
  assert.equal(api.inboxSourceTime('2026-10-24 11:30',platform,now),Date.parse(platform==='booth'?'2026-10-24T02:30:00Z':'2026-10-24T03:30:00Z'));
  for(const value of ['2026-02-30T11:30:00Z','2026-10-24T11:30:00+14:30','2026-10-24T11:30:00+08:99'])assert.equal(api.inboxSourceTime(value,platform,now),undefined);
 }
 const s=snapshot({rows:[row({time:'2026-10-24 05:30'})]});assert.equal(api.interpretInboxSnapshot('xianyu',s,'foreground',context).observations.length,0);assert.equal(api.interpretInboxSnapshot('xianyu',s,'foreground',{now,hours:12}).observations.length,1);
});
test('unrelated pages, disabled readers and already aborted readers never evaluate DOM',async()=>{
 let evaluations=0;const page={isDestroyed:()=>false,getURL:()=> 'https://www.goofish.com/item?id=123',executeJavaScript:async()=>{evaluations++;return snapshot()}};
 await api.readOwnedInbox('xianyu',[page],'foreground',new AbortController().signal,context,()=>true);
 page.getURL=()=> 'https://www.goofish.com/im';await api.readOwnedInbox('xianyu',[page],'foreground',new AbortController().signal,context,()=>false);
 const c=new AbortController();c.abort();await api.readOwnedInbox('xianyu',[page],'background',c.signal,context,()=>true);assert.equal(evaluations,0);
});
test('same-URL login overlay does not report empty successful inbox',async()=>{
 const page={isDestroyed:()=>false,getURL:()=> 'https://www.goofish.com/im',executeJavaScript:async()=>snapshot({login:true,account:'',rows:[]})};
 assert.equal((await api.readOwnedInbox('xianyu',[page],'foreground',new AbortController().signal,context,()=>true)).state,'login');
});
test('captured links remain private on account verification failure and no browser action is available',async()=>{
 const privateLink='https://pan.baidu.com/s/1DoNotRevealSecret';let calls=0;
 const page={isDestroyed:()=>false,getURL:()=> 'https://www.goofish.com/im',executeJavaScript:async code=>{
  assert(!/fetch\(|XMLHttpRequest|document\.cookie|localStorage|sessionStorage|\.click\(|dispatchEvent|\.submit\(|location\s*=/.test(code));
  return ++calls===1?snapshot({rows:[row({text:privateLink})]}):snapshot({supported:false,rows:[]});
 }};
 const result=await api.readOwnedInbox('xianyu',[page],'foreground',new AbortController().signal,context,()=>true);assert(!JSON.stringify(result).includes(privateLink));assert.deepEqual(result.observations,[]);
});
test('navigation during capture and verification never returns the stale page links',async()=>{
 for(const changeAt of [1,2]){
  let url='https://www.goofish.com/im',calls=0;const page={isDestroyed:()=>false,getURL:()=>url,executeJavaScript:async()=>{if(++calls===changeAt)url='https://www.goofish.com/personal';return snapshot()}};
  const result=await api.readOwnedInbox('xianyu',[page],'foreground',new AbortController().signal,context,()=>true);assert.deepEqual(result.observations,[]);assert.notEqual(result.state,'ready');
 }
});
test('owned BOOTH library cards retain an explicit item selection without inventing an order path',()=>{
 const s=snapshot({url:'https://accounts.booth.pm/library',rows:[row({kind:'purchase',key:'item-123',text:'',libraryItem:'123',time:undefined})]});
 const result=api.interpretInboxSnapshot('booth',s,'foreground',context);assert.equal(result.observations.length,1);assert.equal(result.observations[0].boothLibraryItem,'123');assert.equal(result.observations[0].sourceUrl,'https://accounts.booth.pm/library');assert.equal(result.observations[0].boothDownloadPage,undefined);assert.equal(result.observations[0].sourceAt,undefined);
 assert.equal(api.interpretInboxSnapshot('booth',s,'background',context).observations.length,0);
});
test('page evaluation deadline and abort release a stalled official renderer',async()=>{
 assert.equal(typeof api.evaluateInboxPage,'function');const page={executeJavaScript:()=>new Promise(()=>{})};
 await assert.rejects(()=>api.evaluateInboxPage(page,'fixture',new AbortController().signal,5),/timeout/);
 const c=new AbortController(),pending=api.evaluateInboxPage(page,'fixture',c.signal);c.abort();await assert.rejects(()=>pending,/cancelled/);
});
