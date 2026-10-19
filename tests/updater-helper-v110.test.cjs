const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const helper=path.resolve(__dirname,'../assets/update-helper.ps1'),token='11111111-1111-4111-8111-111111111111';
function exe(seed){const bytes=Buffer.alloc(1024,seed);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.write('PE\0\0',128);return bytes}
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-helper-')),data=path.join(root,'profile'),stage=path.join(data,'updates',token),source=path.join(root,'protected'),target=path.join(root,'current.exe'),staged=path.join(stage,'update.exe'),manifest=path.join(stage,'install.json'),harness=path.join(root,'harness.ps1'),launchLog=path.join(root,'launch-log.txt');fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(source);fs.writeFileSync(target,exe(1));fs.writeFileSync(staged,exe(2));const plan={schema:1,version:'1.10.0',token,dataDir:data,stageDir:stage,target,staged,protectedRoots:[source],sha256:hash(exe(2)),size:1024,expectedTargetSha256:hash(exe(1)),expectedTargetSize:1024,parentPid:2147483647};fs.writeFileSync(harness,`param([string]$Helper,[string]$ManifestFile,[string]$Mode,[string]$LaunchLog)
. $Helper
$script:LaunchCalls=0
function Start-Process {
 [CmdletBinding()] param([string]$FilePath,[string]$WorkingDirectory,[string]$ArgumentList,[switch]$PassThru,[string]$WindowStyle)
 $script:LaunchCalls++
 [IO.File]::AppendAllText($LaunchLog,$FilePath+[Environment]::NewLine)
 if($Mode -eq 'fail-first' -and $script:LaunchCalls -eq 1){throw 'Synthetic restart failure'}
 if($script:LaunchCalls -eq 1 -and $Mode -notin @('no-startup','early-exit')){
  $plan=Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json
  if($ArgumentList -ne ('--vrc-update-token='+$plan.token)){throw 'Expected only the update token argument'}
  $receipt=@{schema=1;token=$plan.token;target=$plan.target;sha256=$plan.sha256;size=$plan.size;version=$plan.version;pid=2147483645;parentPid=2147483646;startupReady=$true;at=[DateTime]::UtcNow.ToString('o')}
  switch($Mode){
   'forged-token' {$receipt.token='22222222-2222-4222-8222-222222222222'}
   'forged-target' {$receipt.target=$ManifestFile}
   'forged-hash' {$receipt.sha256='0'*64}
   'unrelated-pid' {$receipt.pid=$PID}
   'forged-parent' {$receipt.parentPid=$PID}
   'unhealthy' {$receipt.startupReady=$false}
   'stale' {$receipt.at=[DateTime]::UtcNow.AddDays(-1).ToString('o')}
  }
  [IO.File]::WriteAllText([IO.Path]::Combine($plan.stageDir,'startup-ready.json'),($receipt|ConvertTo-Json))
 }
 return [pscustomobject]@{Id=2147483646}
}
function New-VrcProcessTracker($Launcher,$Plan){
 $root=@{id=2147483646;startedAt=1;path=$Plan.target;parentId=0;depth=0;taskOwned=$true}
 $app=@{id=2147483645;startedAt=2;path=$Plan.target;parentId=2147483646;depth=1;taskOwned=$true}
 return @{root=$root;members=@{'2147483646'=$root;'2147483645'=$app};launchedAt=[DateTime]::UtcNow}
}
function Update-VrcProcessTracker($Tracker){if($Mode -eq 'early-exit'){throw 'The updated launcher exited before startup was confirmed.'}}
function Get-VrcLiveProcess($Identity){
 if($Mode -eq 'dead-app' -and $Identity.id -eq 2147483645){return $null}
 $process=[pscustomobject]@{Id=$Identity.id}
 $process|Add-Member -MemberType ScriptMethod -Name Dispose -Value {}
 $process|Add-Member -MemberType ScriptMethod -Name Kill -Value {[IO.File]::AppendAllText(($LaunchLog+'.stopped'),([string]$this.Id+[Environment]::NewLine))}
 $process|Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {param($Timeout) return $true}
 return $process
}
$approvalPlan=Get-Content -LiteralPath $ManifestFile -Raw | ConvertFrom-Json
if($Mode -ne 'no-approval'){
 $approval=@{schema=1;token=$approvalPlan.token;parentPid=$approvalPlan.parentPid;helperPid=$PID;approved=$true}
 switch($Mode){'wrong-approval-pid' {$approval.helperPid=$PID+1};'wrong-approval-token' {$approval.token='22222222-2222-4222-8222-222222222222'};'wrong-approval-parent' {$approval.parentPid=1};'false-approval' {$approval.approved=$false}}
 [IO.File]::WriteAllText([IO.Path]::Combine($approvalPlan.stageDir,'install-approved.json'),($approval|ConvertTo-Json))
}
try { Invoke-VrcUpdate $ManifestFile 180; exit 0 } catch {
 [Console]::Error.WriteLine($_.Exception.Message)
 $receiptFile=[IO.Path]::Combine($approvalPlan.stageDir,'startup-ready.json')
 try {
  [Console]::Error.WriteLine('Synthetic host: '+(@{powershell=$PSVersionTable.PSVersion.ToString();culture=[Threading.Thread]::CurrentThread.CurrentCulture.Name}|ConvertTo-Json -Compress))
  if(Test-Path -LiteralPath $receiptFile){
   $info=Get-Item -LiteralPath $receiptFile -Force
   [Console]::Error.WriteLine('Synthetic receipt file: '+(@{length=$info.Length;directory=$info.PSIsContainer}|ConvertTo-Json -Compress))
   [Console]::Error.WriteLine('Synthetic receipt: '+[IO.File]::ReadAllText($receiptFile))
   [Console]::Error.WriteLine('Synthetic plan: '+($approvalPlan|ConvertTo-Json -Compress))
   $parsed=Get-Content -LiteralPath $receiptFile -Raw -Encoding UTF8|ConvertFrom-Json
   $expected=@{schema=1;token=$approvalPlan.token;target=$approvalPlan.target;sha256=$approvalPlan.sha256;size=$approvalPlan.size;version=$approvalPlan.version;pid=2147483645;parentPid=2147483646;startupReady=$true}
   foreach($field in $expected.Keys){$actual=$parsed.$field;$value=$expected[$field];$type=if($null -eq $actual){'null'}else{$actual.GetType().FullName};[Console]::Error.WriteLine('Synthetic field: '+(@{field=$field;actual=$actual;actualType=$type;expected=$value;expectedType=$value.GetType().FullName;equal=($actual -ceq $value)}|ConvertTo-Json -Compress))}
  }
 } catch {[Console]::Error.WriteLine('Synthetic diagnostics: '+$_.Exception.Message)}
 exit 7
}
`);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,data,stage,source,target,staged,manifest,plan,launchLog,run(mode='success'){fs.writeFileSync(manifest,JSON.stringify(plan));return spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',harness,'-Helper',helper,'-ManifestFile',manifest,'-Mode',mode,'-LaunchLog',launchLog],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,PORTABLE_EXECUTABLE_FILE:target}})}}}
test('helper verifies and swaps synthetic executables on the same volume, with restart stubbed',t=>{const f=fixture(t),result=f.run();assert.equal(result.status,0,result.stderr);assert.deepEqual(fs.readFileSync(f.target),exe(2));assert.equal(JSON.parse(fs.readFileSync(path.join(f.stage,'result.json'),'utf8').replace(/^\uFEFF/,'')).status,'completed');assert.equal(fs.readFileSync(f.launchLog,'utf8').trim(),f.target);assert(!fs.existsSync(path.join(f.root,'.vrc-update-'+token+'.rollback.exe')))});
test('helper restores original bytes when the synthetic restart fails and retains an error record',t=>{const f=fixture(t),result=f.run('fail-first');assert.equal(result.status,7);assert.match(result.stderr,/Synthetic restart failure/);assert.deepEqual(fs.readFileSync(f.target),exe(1));const report=JSON.parse(fs.readFileSync(path.join(f.stage,'result.json'),'utf8').replace(/^\uFEFF/,''));assert.equal(report.status,'error');assert(!fs.existsSync(path.join(f.root,'.vrc-update-'+token+'.new.exe')));assert(!fs.existsSync(path.join(f.root,'.vrc-update-'+token+'.rollback.exe')))});
test('helper independently rejects forged destinations, cache paths and changed bytes before replacement',t=>{for(const mutate of [f=>{f.plan.target=path.join(f.source,'source.exe');fs.writeFileSync(f.plan.target,exe(1))},f=>{f.plan.staged=f.target},f=>{f.plan.sha256='0'.repeat(64)},f=>{f.plan.expectedTargetSha256='0'.repeat(64)},f=>{f.plan.protectedRoots=[f.root]},f=>{f.plan.stageDir=f.root}]){const f=fixture(t);mutate(f);const result=f.run();assert.equal(result.status,7,result.stderr);assert.deepEqual(fs.readFileSync(f.target),exe(1));assert(!fs.existsSync(f.launchLog))}});
test('helper rejects junctions and refuses to overwrite a preexisting reserved rollback copy',t=>{const f=fixture(t),reserved=path.join(f.root,'.vrc-update-'+token+'.rollback.exe');fs.writeFileSync(reserved,'user file');let result=f.run();assert.equal(result.status,7);assert.equal(fs.readFileSync(reserved,'utf8'),'user file');assert.deepEqual(fs.readFileSync(f.target),exe(1));fs.unlinkSync(reserved);const linked=path.join(f.root,'linked');try{fs.symlinkSync(f.source,linked,'junction')}catch{t.diagnostic('junction creation unavailable');return}f.plan.staged=path.join(linked,'update.exe');fs.writeFileSync(path.join(f.source,'update.exe'),exe(2));result=f.run();assert.equal(result.status,7);assert.deepEqual(fs.readFileSync(f.target),exe(1));assert(!fs.existsSync(f.launchLog))});
test('a created launcher without application startup confirmation restores the previous executable',t=>{const f=fixture(t),result=f.run('no-startup');assert.equal(result.status,7,result.stderr);assert.deepEqual(fs.readFileSync(f.target),exe(1));assert.equal(JSON.parse(fs.readFileSync(path.join(f.stage,'result.json'),'utf8').replace(/^\uFEFF/,'')).status,'error')});
test('forged, stale, unhealthy or unrelated startup receipts restore the old launcher',t=>{for(const mode of ['forged-token','forged-target','forged-hash','unrelated-pid','forged-parent','unhealthy','stale','dead-app','early-exit']){const f=fixture(t),result=f.run(mode);assert.equal(result.status,7,mode+': '+result.stderr);assert.deepEqual(fs.readFileSync(f.target),exe(1));assert.equal(JSON.parse(fs.readFileSync(path.join(f.stage,'result.json'),'utf8').replace(/^\uFEFF/,'')).status,'error')}});
test('startup timeout stops only the identified synthetic task tree before rollback',t=>{const f=fixture(t),start=Date.now(),result=f.run('no-startup');assert.equal(result.status,7,result.stderr);assert.match(result.stderr,/did not confirm successful startup/);assert(Date.now()-start<10000);assert.deepEqual(fs.readFileSync(f.launchLog+'.stopped','utf8').trim().split(/\r?\n/),['2147483645','2147483646']);assert.deepEqual(fs.readFileSync(f.target),exe(1))});
test('preexisting startup receipts are preserved and prevent any replacement',t=>{const f=fixture(t),receipt=path.join(f.stage,'startup-ready.json');fs.writeFileSync(receipt,'user file');const result=f.run();assert.equal(result.status,7,result.stderr);assert.equal(fs.readFileSync(receipt,'utf8'),'user file');assert.deepEqual(fs.readFileSync(f.target),exe(1));assert(!fs.existsSync(f.launchLog))});
test('process cleanup checks creation identity and preserves other live processes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-process-')),script=path.join(root,'process-test.ps1');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(script,`param([string]$Helper)
. $Helper
$executable=[IO.Path]::Combine($env:SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe')
$owned=Start-Process -FilePath $executable -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30' -PassThru -WindowStyle Hidden
$other=Start-Process -FilePath $executable -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30' -PassThru -WindowStyle Hidden
try {
 $tracker=New-VrcProcessTracker $owned @{target=$executable;token='${token}'}
 Update-VrcProcessTracker $tracker
 $current=Get-Process -Id $PID
 $tracker.members[[string]$PID]=@{id=$PID;startedAt=($current.StartTime.ToUniversalTime().Ticks+1);path=$current.Path;parentId=0;depth=2;taskOwned=$true}
 $tracker.members[[string]$other.Id]=@{id=$other.Id;startedAt=$other.StartTime.ToUniversalTime().Ticks;path=$other.Path;parentId=0;depth=1;taskOwned=$false}
 Stop-VrcUpdateProcesses $tracker
 if(Get-Process -Id $owned.Id -ErrorAction SilentlyContinue){throw 'The owned process was not stopped'}
 if(-not(Get-Process -Id $other.Id -ErrorAction SilentlyContinue)){throw 'An unrelated process was stopped'}
 if(-not(Get-Process -Id $PID -ErrorAction SilentlyContinue)){throw 'A mismatched creation identity was stopped'}
 exit 0
} catch {[Console]::Error.WriteLine($_.Exception.Message);exit 7}
finally {foreach($child in @($owned,$other)){try{if(-not $child.HasExited){$child.Kill();$null=$child.WaitForExit(5000)}}catch{};$child.Dispose()}}
`);
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,'-Helper',helper],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stderr);
});

test('missing or mismatched install approval preserves the original launcher after parent exit',t=>{for(const mode of ['no-approval','wrong-approval-pid','wrong-approval-token','wrong-approval-parent','false-approval']){const f=fixture(t),result=f.run(mode);assert.equal(result.status,7,mode+': '+result.stderr);assert.deepEqual(fs.readFileSync(f.target),exe(1));assert(!fs.existsSync(f.launchLog));assert(!fs.existsSync(path.join(f.root,'.vrc-update-'+token+'.rollback.exe')))}});
