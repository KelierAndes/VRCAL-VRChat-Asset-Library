const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');const Module=require('node:module');
const filename=path.resolve(__dirname,'../src/renderer/unity-diagnosis-session.ts');const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;loaded._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);const {UnityDiagnosisSession}=loaded.exports;
const advice={summary:'缺少引用',facts:['CS0246'],causes:['依赖缺失'],steps:['检查依赖'],verification:['重新编译'],missingInformation:[]};
const error=code=>Object.assign(new Error('暂时不可用'),{code});
test('successful advice survives page consumer disposal without another request',async()=>{
 const session=new UnityDiagnosisSession();let calls=0;await session.run('same-report',async()=>{calls++;return advice});
 const afterReopen=session.get('same-report');assert.deepEqual(afterReopen.advice,advice);assert.equal(session.delay('same-report'),undefined);
 await session.run('same-report',async()=>{calls++;return advice});assert.equal(calls,1);afterReopen.advice.steps.push('modified externally');assert.equal(session.get('same-report').advice.steps.length,1);
});
test('busy, rate-limit and cancelled each get no more than three retries at 30-second intervals',async()=>{
 for(const code of ['busy','rate-limit','cancelled']){let now=100,calls=0;const session=new UnityDiagnosisSession({now:()=>now});const fail=async()=>{calls++;throw error(code)};
  await session.run(code,fail);assert.equal(calls,1);assert.equal(session.delay(code),30000);now+=29999;await session.run(code,fail);assert.equal(calls,1);assert.equal(session.delay(code),1);
  for(let retry=0;retry<3;retry++){now+=retry?30000:1;await session.run(code,fail);assert.equal(calls,retry+2);}
  assert.equal(session.delay(code),undefined);now+=3600000;await session.run(code,fail);assert.equal(calls,4);assert.equal(session.get(code).code,code);
 }
});
test('network, authentication, malformed output, daily limit and ordinary errors never loop automatically',async()=>{
 for(const code of ['network','authentication','invalid-response','daily-limit',undefined]){let now=0,calls=0;const session=new UnityDiagnosisSession({now:()=>now});const fail=async()=>{calls++;throw error(code)};
  await session.run('report',fail);now+=86400000;await session.run('report',fail);assert.equal(calls,1);assert.equal(session.delay('report'),undefined);
  await session.run('report',async()=>{calls++;return advice},{manual:true});assert.equal(calls,2);assert.deepEqual(session.get('report').advice,advice);
 }
});
test('same report deduplicates in flight and late completion is available to a new consumer',async()=>{
 const session=new UnityDiagnosisSession();let resolve,calls=0;const request=session.run('a',()=>{calls++;return new Promise(r=>resolve=r)});
 assert.equal(session.get('a').inFlight,true);assert.equal(session.delay('a'),undefined);await session.run('a',async()=>{calls++;return advice});assert.equal(calls,1);resolve(advice);await request;assert.deepEqual(session.get('a').advice,advice);
});
test('session advice cache evicts oldest completed entries and is bounded',async()=>{
 const session=new UnityDiagnosisSession({capacity:2});for(const key of ['a','b','c'])await session.run(key,async()=>({...advice,summary:key}));assert.equal(session.get('a'),undefined);assert.equal(session.get('b').advice.summary,'b');assert.equal(session.get('c').advice.summary,'c');
});
