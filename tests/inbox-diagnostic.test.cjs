const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const filename=path.resolve(__dirname,'../src/main/link-inbox-reader.ts'),load=Module.createRequire(path.resolve(__dirname,'../dist/main/main/link-inbox-reader.js')),compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled.require=load;compiled._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const api=compiled.exports,context={now:Date.parse('2026-10-24T09:00:00Z'),hours:6},snapshot=extra=>({url:'https://www.goofish.com/im',account:'synthetic-visible-owner',supported:false,rows:[],...extra});
test('a verified owner with an unsupported message layout is identified as a layout issue',()=>{const r=api.interpretInboxSnapshot('xianyu',snapshot({diagnostic:'message-layout'}),'foreground',context);assert.equal(r.state,'unsupported');assert.match(r.message,/聊天.*结构|消息.*结构/);assert(!r.message.includes('账号或'));assert.deepEqual(r.observations,[])});
test('an unselected conversation asks for opening a conversation rather than logging in again',()=>{const r=api.interpretInboxSnapshot('xianyu',snapshot({diagnostic:'chat-unselected'}),'foreground',context);assert.equal(r.state,'unsupported');assert.match(r.message,/打开.*会话|选择.*会话/);assert(!r.message.includes('登录'));assert.deepEqual(r.observations,[])});
test('missing owner proof explains the own account header and never accepts links',async()=>{let reads=0;const value=snapshot({account:'',diagnostic:'account-header'}),page={isDestroyed:()=>false,getURL:()=>value.url,executeJavaScript:async()=>{reads++;return value}};const r=await api.readOwnedInbox('xianyu',[page],'foreground',new AbortController().signal,context,()=>true);assert.equal(r.state,'unsupported');assert.match(r.message,/本人账号|账号栏|个人账号/);assert(!r.message.includes('已变化'));assert.equal(reads,1);assert.deepEqual(r.observations,[])});
test('diagnostics are fixed codes and cannot return page-supplied private text',()=>{const secret='PRIVATE-FIXTURE-CONTENT',r=api.interpretInboxSnapshot('xianyu',snapshot({supported:true,diagnostic:secret}),'foreground',context);assert.equal(r.state,'unsupported');assert.deepEqual(r.observations,[]);assert(!JSON.stringify(r).includes(secret))});
test('empty account remains rejected even if page claims supported and supplies a link',()=>{const r=api.interpretInboxSnapshot('xianyu',snapshot({account:'',supported:true,rows:[{key:'fake',kind:'message',text:'https://pan.baidu.com/s/1SyntheticNoOwner'}]}),'foreground',context);assert.equal(r.state,'unsupported');assert.deepEqual(r.observations,[])});
test('verified open empty chat is ready without confusing no links with failed identity',()=>{const r=api.interpretInboxSnapshot('xianyu',snapshot({supported:true,diagnostic:'empty'}),'foreground',context);assert.equal(r.state,'ready');assert.match(r.message,/未发现|没有.*链接/);assert.deepEqual(r.observations,[])});
test('capture diagnostics survive the owned-page reader without bypassing second account verification',async()=>{let reads=0;const value=snapshot({diagnostic:'message-layout'}),page={isDestroyed:()=>false,getURL:()=>value.url,executeJavaScript:async()=>{reads++;return value}};const r=await api.readOwnedInbox('xianyu',[page],'foreground',new AbortController().signal,context,()=>true);assert.equal(r.state,'unsupported');assert.match(r.message,/聊天.*结构|消息.*结构/);assert.equal(reads,1);assert.deepEqual(r.observations,[])});
test('relative unread preview gets a marked conservative source time and old days are excluded',()=>{const row=time=>({key:time,kind:'conversation',unread:true,time,text:'https://pan.baidu.com/s/1SyntheticTime'}),r=api.interpretInboxSnapshot('xianyu',snapshot({supported:true,rows:[row('2分钟前'),row('3天前')]}),'background',context);assert.equal(r.observations.length,1);assert.equal(r.observations[0].sourceAt,context.now-3*60000);assert.equal(r.observations[0].sourceTimeApproximate,true)});
test('undated message never borrows the current day or gets an approximation marker',()=>{const r=api.interpretInboxSnapshot('xianyu',snapshot({supported:true,rows:[{key:'no-day',kind:'message',time:'17:00',text:'https://pan.baidu.com/s/1SyntheticNoDay'}]}),'foreground',context);assert.equal(r.observations.length,1);assert.equal(r.observations[0].sourceAt,undefined);assert.equal(r.observations[0].sourceTimeApproximate,undefined)});
test('calendar-relative labels are marked approximate so a stale label cannot renew link age after midnight',()=>{
 for(const time of ['今天 17:00','今日 17:00','Today 17:00','昨天 17:00','昨日 17:00','Yesterday 17:00']){
  const r=api.interpretInboxSnapshot('xianyu',snapshot({supported:true,rows:[{key:time,kind:'message',time,text:'https://pan.baidu.com/s/1SyntheticCalendar'}]}),'foreground',{...context,hours:24});
  assert.equal(r.observations.length,1,time);assert.equal(r.observations[0].sourceTimeApproximate,true,time);
 }
 const absolute=api.interpretInboxSnapshot('xianyu',snapshot({supported:true,rows:[{key:'absolute',kind:'message',time:'2026-10-24 16:00',text:'https://pan.baidu.com/s/1SyntheticCalendar'}]}),'foreground',context);
 assert.equal(absolute.observations[0].sourceTimeApproximate,undefined);
});

test('an undated detected share points to the time-review list instead of an apparently empty pending list',()=>{
 const r=api.interpretInboxSnapshot('xianyu',snapshot({supported:true,rows:[{key:'message-0',kind:'message',time:'17:00',text:'https://pan.baidu.com/s/1SyntheticReview?pwd=Ab12'}]}),'foreground',context);
 assert.equal(r.state,'ready');assert.equal(r.observations.length,1);assert.equal(r.observations[0].sourceAt,undefined);
 assert.match(r.message,/已识别.*链接/);assert.match(r.message,/时间／提取码待核对/);assert(!r.message.includes('1SyntheticReview'));assert(!r.message.includes('Ab12'));
});

test('a detected share with conflicting codes points to review and never exposes the codes in diagnostics',()=>{
 const r=api.interpretInboxSnapshot('xianyu',snapshot({supported:true,rows:[{key:'message-0',kind:'message',time:'2026-10-24 16:00',text:'https://pan.baidu.com/s/1SyntheticConflict?pwd=Ab12 提取码: Cd34'}]}),'foreground',context);
 assert.equal(r.state,'ready');assert.equal(r.observations.length,1);assert.match(r.message,/提取码.*冲突/);assert.match(r.message,/时间／提取码待核对/);
 for(const privatePart of ['1SyntheticConflict','Ab12','Cd34'])assert(!r.message.includes(privatePart));
});

test('a recognized but old share explains the selected time window without reintroducing it',()=>{
 const r=api.interpretInboxSnapshot('xianyu',snapshot({supported:true,rows:[{key:'old-message',kind:'message',time:'2026-10-20 16:00',text:'https://pan.baidu.com/s/1SyntheticOld'}]}),'foreground',context);
 assert.equal(r.state,'ready');assert.deepEqual(r.observations,[]);assert.match(r.message,/早于.*6.*小时/);assert(!r.message.includes('1SyntheticOld'));
});

test('a second owned empty chat cannot replace the review hint of an already verified detected share',async()=>{
 const found=snapshot({supported:true,rows:[{key:'message-0',kind:'message',text:'https://pan.baidu.com/s/1SyntheticReview'}]}),empty=snapshot({supported:true,diagnostic:'empty'});
 const page=value=>({isDestroyed:()=>false,getURL:()=>value.url,executeJavaScript:async()=>value});
 const r=await api.readOwnedInbox('xianyu',[page(found),page(empty)],'foreground',new AbortController().signal,context,()=>true);
 assert.equal(r.state,'ready');assert.equal(r.observations.length,1);assert.match(r.message,/时间／提取码待核对/);assert(!r.message.includes('未发现'));
});
