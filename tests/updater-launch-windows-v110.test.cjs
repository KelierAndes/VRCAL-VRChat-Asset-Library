const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function exe(seed){const bytes=Buffer.alloc(1024,seed);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.write('PE\0\0',128);return bytes}

test('hidden Windows update helper acknowledges readiness and outlives its normally exiting parent',{skip:process.platform!=='win32',timeout:30000},async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-launch-os-')),backend=path.join(root,'dist','main','main'),assets=path.join(root,'assets'),data=path.join(root,'profile'),materials=path.join(root,'materials'),target=path.join(root,'current.exe'),parent=path.join(root,'parent.cjs'),exited=path.join(root,'parent-exiting.json'),completed=path.join(root,'helper-completed.json');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 for(const directory of [backend,assets,data,materials])fs.mkdirSync(directory,{recursive:true});
 for(const name of ['updater.js','safety.js'])fs.copyFileSync(path.resolve(__dirname,'../dist/main/main',name),path.join(backend,name));
 fs.copyFileSync(path.resolve(__dirname,'../assets/update-launcher.ps1'),path.join(assets,'update-launcher.ps1'));
 const original=exe(1),source=path.join(materials,'source.txt');fs.writeFileSync(target,original);fs.writeFileSync(source,'Original material remains untouched.');
 fs.writeFileSync(path.join(assets,'update-helper.ps1'),`param([string]$Manifest)
$ErrorActionPreference='Stop'
$plan=Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
trap {[IO.File]::WriteAllText([IO.Path]::Combine([IO.Path]::GetDirectoryName($plan.target),'helper-error.txt'),[string]$_);exit 9}
$receipt=@{token=$plan.token;parentPid=$plan.parentPid;helperPid=$PID}
[IO.File]::WriteAllText([IO.Path]::Combine($plan.stageDir,'helper-ready.json'),($receipt|ConvertTo-Json -Compress))
$deadline=[DateTime]::UtcNow.AddSeconds(15)
while(Get-Process -Id $plan.parentPid -ErrorAction SilentlyContinue){
 if([DateTime]::UtcNow -gt $deadline){exit 8}
 Start-Sleep -Milliseconds 40
}
$approval=Get-Content -LiteralPath ([IO.Path]::Combine($plan.stageDir,'install-approved.json')) -Raw | ConvertFrom-Json
if($approval.token -ne $plan.token -or $approval.parentPid -ne $plan.parentPid -or $approval.helperPid -ne $PID -or $approval.approved -ne $true){throw 'Invalid approval'}
$receipt.parentStopped=$true
[IO.File]::WriteAllText([IO.Path]::Combine([IO.Path]::GetDirectoryName($plan.target),'helper-completed.json'),($receipt|ConvertTo-Json -Compress))
`);
 fs.writeFileSync(parent,`const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname,target=path.join(root,'current.exe');process.env.PORTABLE_EXECUTABLE_FILE=target;
const {AppUpdater}=require('./dist/main/main/updater');
const bytes=Buffer.alloc(1024,2);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.write('PE\\0\\0',128);
const base='https://github.com/NecoAya/VRCAL-VRChat-Asset-Library',release={tag_name:'v1.10.0',draft:false,prerelease:false,html_url:base+'/releases/tag/v1.10.0',assets:[{name:'VRC-Asset-Library-1.10.0-x64.exe',state:'uploaded',size:bytes.length,digest:'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex'),browser_download_url:base+'/releases/download/v1.10.0/VRC-Asset-Library-1.10.0-x64.exe'}]};
const updater=new AppUpdater({version:'1.9.2',dataDir:path.join(root,'profile'),roots:()=>[path.join(root,'materials')],executable:target,packaged:true,canNetwork:()=>true,fetch:async url=>url.includes('/releases/latest')?Response.json(release):new Response(bytes),quit:()=>fs.writeFileSync(path.join(root,'parent-exiting.json'),JSON.stringify({parentPid:process.pid}))});
(async()=>{await updater.check();await updater.download();await updater.install();updater.close()})().catch(error=>{console.error(error);process.exitCode=1});
`);
 const result=spawnSync(process.execPath,[parent],{encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,PORTABLE_EXECUTABLE_FILE:target}});
 assert.equal(result.error,undefined,result.error?.message);assert.equal(result.status,0,result.stderr);
 assert(fs.existsSync(exited),'The parent may quit only after the real helper acknowledges readiness.');
 const deadline=Date.now()+10000;while(!fs.existsSync(completed)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,40));
 assert(fs.existsSync(completed),'The helper must survive normal parent exit and complete its own work. '+(fs.existsSync(path.join(root,'helper-error.txt'))?fs.readFileSync(path.join(root,'helper-error.txt'),'utf8'):''));
 const completion=JSON.parse(fs.readFileSync(completed,'utf8')),parentExit=JSON.parse(fs.readFileSync(exited,'utf8'));
 assert.equal(completion.parentPid,parentExit.parentPid);assert.equal(completion.parentStopped,true);assert.notEqual(completion.helperPid,parentExit.parentPid);assert(Number.isSafeInteger(completion.helperPid));
 const [token]=fs.readdirSync(path.join(data,'updates')),ready=JSON.parse(fs.readFileSync(path.join(data,'updates',token,'helper-ready.json'),'utf8'));assert.equal(ready.token,token);assert.equal(ready.helperPid,completion.helperPid);
 assert.equal(digest(fs.readFileSync(target)),digest(original));assert.equal(fs.readFileSync(source,'utf8'),'Original material remains untouched.');
});
