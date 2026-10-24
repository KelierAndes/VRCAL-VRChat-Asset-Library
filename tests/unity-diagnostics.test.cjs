const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {UnityDiagnosticsMonitor,redactUnityDiagnosticText}=require('../dist/main/main/unity-diagnostics');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrcal-diagnostics-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const project={id:'registered',kind:'unity-project',path:path.join(root,'日本語 工程')};
 for(const name of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(project.path,name),{recursive:true});
 fs.writeFileSync(path.join(project.path,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2022.3.22f1\n');
 fs.writeFileSync(path.join(project.path,'Packages/manifest.json'),'{"dependencies":{}}');
 const logPath=path.join(root,'Editor.log'); let now=Date.now();
 const monitor=new UnityDiagnosticsMonitor({logPath,now:()=>now});
 return {root,project,logPath,monitor,now:()=>now,advance:ms=>{now+=ms},read:()=>monitor.read(project,[root]),write:text=>fs.writeFileSync(logPath,text),append:text=>fs.appendFileSync(logPath,text),header:p=>`Built from '2022.3/staging' branch\nCOMMAND LINE ARGUMENTS:\nUnity.exe\n-projectPath\n${p||project.path}\nInitialize engine version: 2022.3.22f1\n`};
}
const compile="Assets/Test.cs(12,5): error CS0246: The type or namespace name 'Missing' could not be found\n";
test('requires a registered project and startup ownership, never arbitrary path mentions',async t=>{
 const f=fixture(t); f.write(`Error: path ${f.project.path}\n${compile}`);
 assert.equal((await f.read()).status,'unverified');assert.equal((await f.read()).issues.length,0);
 f.write(f.header(path.join(f.root,'Another'))+compile);
 const wrong=await f.read();assert.equal(wrong.status,'other-project');assert.equal(wrong.issues.length,0);assert(!JSON.stringify(wrong).includes('Another'));
 await assert.rejects(()=>f.monitor.read({...f.project,kind:'file'},[f.root]));
 await assert.rejects(()=>f.monitor.read(f.project,[]));
});
test('groups compiler failures and duplicates, keeps observation timestamps stable, reads only',async t=>{
 const f=fixture(t);f.write(f.header()+compile+compile+'All compiler errors have to be fixed before you can enter playmode!\n');
 const before=crypto.createHash('sha256').update(fs.readFileSync(f.logPath)).digest('hex');
 const result=await f.read();assert.equal(result.status,'ready');assert.equal(result.issues.length,1);
 assert.equal(result.issues[0].kind,'compile');assert.equal(result.issues[0].code,'CS0246');assert.equal(result.issues[0].relativePath,'Assets/Test.cs');assert.equal(result.issues[0].line,12);assert.equal(result.issues[0].count,2);assert(result.issues[0].suggestions.length);
 f.advance(5000);const again=await f.read();assert.equal(again.revision,result.revision);assert.equal(again.issues[0].lastObservedAt,result.issues[0].lastObservedAt);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(f.logPath)).digest('hex'),before);
 assert.deepEqual(fs.readdirSync(f.project.path).sort(),['Assets','Packages','ProjectSettings']);
});
test('waits for complete UTF-8 lines and does not lose chunked exceptions or repeat old errors',async t=>{
 const f=fixture(t); f.write(f.header());await f.read();
 const line=Buffer.from('NullReferenceException: 中文 missing\n');const cut=line.indexOf(Buffer.from('中文'))+1;
 fs.appendFileSync(f.logPath,line.subarray(0,cut));assert.equal((await f.read()).issues.length,0);
 fs.appendFileSync(f.logPath,line.subarray(cut));const a=await f.read();assert.equal(a.issues.length,1);assert.match(a.issues[0].message,/中文/);
 f.append('  at Example.Update () (at Assets/Test.cs:42)\n');const b=await f.read();assert.match(b.issues[0].detail,/Assets\/Test.cs:42/);assert.equal(b.issues[0].count,1);
});
test('invalidates ownership on truncation, rotation and appended unrelated sessions',async t=>{
 const f=fixture(t);f.write(f.header()+compile);const first=await f.read();
 f.write('Error: no owner\n');assert.equal((await f.read()).issues.length,0);
 fs.renameSync(f.logPath,path.join(f.root,'Editor-prev.log'));f.write(f.header()+compile);const second=await f.read();assert.notEqual(second.sessionId,first.sessionId);
 f.append(f.header(path.join(f.root,'Other'))+'NullReferenceException: PRIVATE_OTHER_PROJECT\n');const third=await f.read();assert.equal(third.status,'other-project');assert.equal(third.issues.length,0);assert(!JSON.stringify(third).includes('PRIVATE_OTHER_PROJECT'));
});
test('cold start proves the whole long session but retains only recent diagnostic content',async t=>{
 const f=fixture(t);f.write(f.header()+'NullReferenceException: OLD_ERROR_OUTSIDE_TAIL\n'+'ordinary output\n'.repeat(100000)+'NullReferenceException: RECENT_ERROR\n');
 const r=await f.read();assert.equal(r.status,'ready');assert.equal(r.issues.length,1);assert.match(r.issues[0].message,/RECENT_ERROR/);assert(!JSON.stringify(r).includes('OLD_ERROR_OUTSIDE_TAIL'));assert.equal(r.truncated,true);
});
test('cold scan sees a different project in the middle, never trusting head plus tail alone',async t=>{
 const f=fixture(t);f.write(f.header()+'ordinary output\n'.repeat(100000)+f.header(path.join(f.root,'PRIVATE_OTHER_PROJECT'))+'ordinary output\n'.repeat(100000)+'NullReferenceException: OTHER_PRIVATE_ERROR\n');
 const result=await f.read();assert.equal(result.status,'other-project');assert.deepEqual(result.issues,[]);assert(!JSON.stringify(result).includes('PRIVATE_OTHER_PROJECT'));assert(!JSON.stringify(result).includes('OTHER_PRIVATE_ERROR'));
});
test('cold scans exceeding the safety bound return no unproven tail content',async t=>{
 const f=fixture(t);f.write(f.header());f.append(Buffer.alloc(33*1024*1024,120));f.append('\nNullReferenceException: UNPROVEN_TAIL\n');
 const result=await f.read();assert.equal(result.status,'unverified');assert.deepEqual(result.issues,[]);assert.equal(result.truncated,true);assert(!JSON.stringify(result).includes('UNPROVEN_TAIL'));
});
test('cold scan preserves startup ownership across a streaming chunk boundary',async t=>{
 const f=fixture(t),padding='ordinary output\n'.repeat(16380);f.write(padding+f.header()+compile);
 const result=await f.read();assert.equal(result.status,'ready');assert.equal(result.issues[0].code,'CS0246');
});
test('a cold scan time limit never publishes a partially proven session',async t=>{
 const {performance}=require('node:perf_hooks');let elapsed=0;
 const f=fixture(t);f.write(f.header()+'ordinary output\n'.repeat(100000)+compile);
 t.mock.method(performance,'now',()=>elapsed+=1001);
 const result=await f.read();assert.equal(result.status,'unverified');assert.equal(result.truncated,true);assert.deepEqual(result.issues,[]);
});
test('a cold scan discards output when the underlying log changes during the read',async t=>{
 const f=fixture(t);f.write(f.header()+compile);const promises=require('node:fs/promises'),originalOpen=promises.open.bind(promises);let changed=false;
 t.mock.method(promises,'open',async(...args)=>{const file=await originalOpen(...args);if(args[0]===f.logPath){const read=file.read.bind(file);file.read=async(...readArgs)=>{const result=await read(...readArgs);if(!changed){changed=true;f.append(f.header(path.join(f.root,'ChangedProject'))+'NullReferenceException: FOREIGN\n');}return result;};}return file;});
 const result=await f.read();assert.equal(result.status,'unverified');assert.deepEqual(result.issues,[]);assert(!JSON.stringify(result).includes('FOREIGN'));
});
test('oversized lines are discarded until newline and stale logs do not become new failures',async t=>{
 const f=fixture(t);f.write(f.header());await f.read();f.append('x'.repeat(50000));await f.read();f.append('NullReferenceException: fragment must be dropped\n'+compile);
 const result=await f.read();assert.equal(result.issues.length,1);assert.equal(result.issues[0].code,'CS0246');assert(result.truncated);
 f.advance(48*60*60*1000);const stale=await f.read();assert.equal(stale.status,'stale');assert.equal(stale.issues.length,0);
});
test('redacts credentials, personal paths, e-mail and private links before returning diagnostics',async t=>{
 const f=fixture(t);f.write(f.header()+`Error: token=secret-token password="hidden pass" Cookie: sid=topsecret email=user@example.com C:\\Users\\Alice\\Private\\thing.txt https://pan.baidu.com/s/private?pwd=1234\n`);
 const json=JSON.stringify(await f.read());for(const secret of ['secret-token','hidden pass','topsecret','user@example.com','Alice','private?pwd'])assert(!json.includes(secret),secret);
 const redacted=redactUnityDiagnosticText('Authorization: Bearer ABCDEF\napi_key: "secret-value"\n/Users/Somebody/private/file.txt\nAssets/Script.cs');
 for(const secret of ['ABCDEF','secret-value','Somebody'])assert(!redacted.includes(secret));assert(redacted.includes('Assets/Script.cs'));
});
test('an unowned new engine startup revokes the previous session even without command arguments',async t=>{
 const f=fixture(t);f.write(f.header()+compile);await f.read();
 f.append('Initialize engine version: 2022.3.22f1\nNullReferenceException: UNKNOWN_SESSION\n');
 const result=await f.read();assert.equal(result.status,'unverified');assert.equal(result.issues.length,0);
});
test('verified incremental streams can grow beyond the initial read limit without duplicating errors',async t=>{
 const f=fixture(t);f.write(f.header()+compile);const first=await f.read();
 for(let i=0;i<5;i++){f.append('ordinary output\n'.repeat(20000));const result=await f.read();assert.equal(result.status,'ready');assert.equal(result.issues[0].count,1);assert.equal(result.sessionId,first.sessionId);}
 f.append(compile);assert.equal((await f.read()).issues[0].count,2);
});
test('rapidly switching projects does not retain errors from the previous selection',async t=>{
 const f=fixture(t);f.write(f.header()+compile);await f.read();
 const other={id:'other',kind:'unity-project',path:path.join(f.root,'Second')};for(const part of ['Assets','Packages','ProjectSettings'])fs.mkdirSync(path.join(other.path,part),{recursive:true});
 const a=await f.monitor.read(other,[f.root]);assert.equal(a.status,'other-project');assert.deepEqual(a.issues,[]);
 const b=await f.read();assert.equal(b.status,'ready');assert.equal(b.issues.length,1);
});
test('issue memory is bounded and symlink log targets are not followed',async t=>{
 const f=fixture(t);f.write(f.header()+Array.from({length:200},(_,i)=>`NullReferenceException: issue ${i}\n`).join(''));
 const result=await f.read();assert(result.issues.length<=100);assert.equal(result.truncated,true);
 fs.renameSync(f.logPath,path.join(f.root,'real.log'));
 try{fs.symlinkSync(path.join(f.root,'real.log'),f.logPath)}catch(error){if(error.code==='EPERM'){t.diagnostic('Symlink creation requires privilege on this host; bounded issue assertion completed.');return;}throw error;}
 const linked=await f.read();assert.equal(linked.status,'unavailable');assert.equal(linked.issues.length,0);
});
test('recognizes compiler messages without locations, plain Exception and compiler warnings',async t=>{
 const f=fixture(t);f.write(f.header()+"error CS0006: Metadata file 'Missing.dll' could not be found\nException: something failed\nAssets/Test.cs(3,1): warning CS0168: unused local\n");
 const result=await f.read();assert.equal(result.issues.length,3);assert.equal(result.issues[0].kind,'compile');assert.equal(result.issues[0].code,'CS0006');assert.equal(result.issues[1].kind,'exception');assert.equal(result.issues[2].severity,'warning');
});
test('relative file locations are redacted too, not only message bodies',async t=>{
 const f=fixture(t);f.write(f.header()+'Assets/user@example.com/Script.cs(1,1): error CS0246: missing type\n');
 const result=await f.read();assert(!JSON.stringify(result).includes('user@example.com'));
});
test('automatic diagnosis key ignores duplicate counts, observation times and new warnings',async t=>{
 const {unityDiagnosticAnalysisKey}=require('../dist/main/shared/unity-diagnostics');
 const f=fixture(t);f.write(f.header()+compile);const first=await f.read();
 f.advance(5000);f.append(compile+'Assets/A.cs(1,1): warning CS0168: unused\n');const repeated=await f.read();
 assert.equal(unityDiagnosticAnalysisKey(first),unityDiagnosticAnalysisKey(repeated));
 f.append('NullReferenceException: new failure\n');const changed=await f.read();assert.notEqual(unityDiagnosticAnalysisKey(first),unityDiagnosticAnalysisKey(changed));
 assert.notEqual(unityDiagnosticAnalysisKey(first),unityDiagnosticAnalysisKey({...first,projectVersion:'2022.3.99f1'}));
});
test('repeating the same exception stack does not grow detail or request another AI analysis',async t=>{
 const {unityDiagnosticAnalysisKey}=require('../dist/main/shared/unity-diagnostics');
 const f=fixture(t),exception='NullReferenceException: missing\n  at Example.Update () (at Assets/Test.cs:42)\n';
 f.write(f.header()+exception);const first=await f.read();f.append(exception);const next=await f.read();
 assert.equal(next.issues[0].count,2);assert.equal(next.issues[0].detail,first.issues[0].detail);assert.equal(unityDiagnosticAnalysisKey(next),unityDiagnosticAnalysisKey(first));
});
