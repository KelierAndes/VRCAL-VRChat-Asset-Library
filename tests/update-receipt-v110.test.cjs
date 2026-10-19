const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const token='11111111-1111-4111-8111-111111111111',hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-receipt-')),data=path.join(root,'profile'),stage=path.join(data,'updates',token),source=path.join(root,'materials'),target=path.join(root,'current.exe');
 fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(source);const bytes=Buffer.alloc(1024,2);fs.writeFileSync(target,bytes);
 const manifest=path.join(stage,'install.json'),receipt=path.join(stage,'startup-ready.json'),plan={schema:1,version:'1.10.0',token,dataDir:data,stageDir:stage,target,staged:path.join(stage,'update.exe'),protectedRoots:[source],sha256:hash(bytes),size:bytes.length,expectedTargetSha256:'1'.repeat(64),expectedTargetSize:1024,parentPid:2147483647};
 fs.writeFileSync(manifest,JSON.stringify(plan));const argv=process.argv,portable=process.env.PORTABLE_EXECUTABLE_FILE;process.argv=[process.execPath,'app','--vrc-update-token='+token];process.env.PORTABLE_EXECUTABLE_FILE=target;
 t.after(()=>{process.argv=argv;if(portable===undefined)delete process.env.PORTABLE_EXECUTABLE_FILE;else process.env.PORTABLE_EXECUTABLE_FILE=portable;fs.rmSync(root,{recursive:true,force:true})});
 const receiver=path.resolve(__dirname,'../dist/main/main/update-receipt.js');assert(fs.existsSync(receiver),'Startup receipt receiver must exist');
 return {root,data,stage,source,target,manifest,receipt,plan,writePlan(){fs.writeFileSync(manifest,JSON.stringify(plan))},ack:()=>require(receiver).acknowledgeUpdateStartup(data,[source],'1.10.0')};
}
test('startup acknowledgement derives its destination from the token and validates the installed bytes',async t=>{const f=fixture(t);assert.equal(await f.ack(),true);const receipt=JSON.parse(fs.readFileSync(f.receipt,'utf8'));assert.equal(receipt.token,token);assert.equal(receipt.target,f.target);assert.equal(receipt.sha256,f.plan.sha256);assert.equal(receipt.pid,process.pid);assert.equal(receipt.startupReady,true);assert.equal(receipt.version,'1.10.0');assert.equal(fs.readdirSync(f.stage).some(file=>file.endsWith('.tmp')),false);await assert.rejects(f.ack);assert.equal(JSON.parse(fs.readFileSync(f.receipt,'utf8')).pid,process.pid)});
test('normal launches do not write an update receipt',async t=>{const f=fixture(t);process.argv=[process.execPath,'app'];assert.equal(await f.ack(),false);assert(!fs.existsSync(f.receipt))});
test('invalid or duplicate token arguments cannot select any receipt path',async t=>{const f=fixture(t);for(const args of [['--vrc-update-token=../../arbitrary'],['--vrc-update-token='+token,'--vrc-update-token='+token],['--vrc-update-token']]){process.argv=[process.execPath,'app',...args];await assert.rejects(f.ack);assert(!fs.existsSync(f.receipt))}});
test('forged manifests, changed executables and protected destinations never acknowledge startup',async t=>{const f=fixture(t),original={...f.plan};for(const mutate of [()=>{f.plan.target=path.join(f.root,'other.exe')},()=>{f.plan.token='22222222-2222-4222-8222-222222222222'},()=>{f.plan.dataDir=f.root},()=>{f.plan.stageDir=f.root},()=>{f.plan.staged=f.target},()=>{f.plan.sha256='0'.repeat(64)},()=>{f.plan.version='1.9.2'},()=>{f.plan.protectedRoots=[f.root]}]){Object.assign(f.plan,original);mutate();f.writePlan();await assert.rejects(f.ack);assert(!fs.existsSync(f.receipt))}Object.assign(f.plan,original);f.writePlan();fs.writeFileSync(f.target,Buffer.alloc(1024,3));await assert.rejects(f.ack);assert(!fs.existsSync(f.receipt))});
test('receipt creation preserves preexisting files and rejects linked stage directories',async t=>{const f=fixture(t);fs.writeFileSync(f.receipt,'user data');await assert.rejects(f.ack);assert.equal(fs.readFileSync(f.receipt,'utf8'),'user data');fs.unlinkSync(f.receipt);fs.renameSync(f.stage,f.stage+'-actual');fs.symlinkSync(f.stage+'-actual',f.stage,'junction');await assert.rejects(f.ack);assert(!fs.existsSync(f.receipt))});
test('filesystems without hard links publish a complete receipt atomically with a same-directory rename',async t=>{
 const f=fixture(t),fsp=require('node:fs/promises'),link=fsp.link,rename=fsp.rename;let published=false;
 t.after(()=>{fsp.link=link;fsp.rename=rename});
 fsp.link=async()=>{throw Object.assign(new Error('Hard links are unsupported'),{code:'ENOTSUP'})};
 fsp.rename=async(from,to)=>{assert.equal(path.dirname(from),f.stage);assert.equal(to,f.receipt);assert(!fs.existsSync(to));const ready=JSON.parse(fs.readFileSync(from,'utf8'));assert.equal(ready.token,token);assert.equal(ready.startupReady,true);published=true;return rename(from,to)};
 assert.equal(await f.ack(),true);assert(published);assert.equal(JSON.parse(fs.readFileSync(f.receipt,'utf8')).sha256,f.plan.sha256);assert.equal(fs.readdirSync(f.stage).some(file=>file.endsWith('.tmp')),false);
});
test('unsupported-link fallback refuses a preexisting receipt and permission failures do not use rename',async t=>{
 const f=fixture(t),fsp=require('node:fs/promises'),link=fsp.link,rename=fsp.rename;let renamed=false;
 t.after(()=>{fsp.link=link;fsp.rename=rename});fsp.rename=async()=>{renamed=true;throw new Error('Unexpected rename')};
 fsp.link=async()=>{fs.writeFileSync(f.receipt,'preserve me');throw Object.assign(new Error('Hard links are unsupported'),{code:'EPERM'})};
 await assert.rejects(f.ack);assert(!renamed);assert.equal(fs.readFileSync(f.receipt,'utf8'),'preserve me');fs.unlinkSync(f.receipt);
 fsp.link=async()=>{throw Object.assign(new Error('Access denied'),{code:'EACCES'})};await assert.rejects(f.ack,/Access denied/);assert(!renamed);assert(!fs.existsSync(f.receipt));assert.equal(fs.readdirSync(f.stage).some(file=>file.endsWith('.tmp')),false);
});
