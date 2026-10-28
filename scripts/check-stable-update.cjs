// Check the real stable metadata with the current or an extracted older updater.
// This script permits only the GitHub latest JSON request. It never downloads or installs an asset.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const endpoint='https://api.github.com/repos/NecoAya/VRCAL-VRChat-Asset-Library/releases/latest';
async function sha256(file){const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('hex')}
async function checkStableUpdate({currentVersion,expectedVersion='1.4.0',expectedStatus='available',executable,updaterModule=path.resolve(__dirname,'../dist/main/main/updater.js'),request=globalThis.fetch}){
 assert.equal(typeof currentVersion,'string','Pass the real current version');
 assert.match(expectedVersion,/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/,'Expected version must be stable');
 assert(['available','up-to-date'].includes(expectedStatus),'Expected status must be available or up-to-date');
 assert(path.isAbsolute(executable)&&fs.statSync(executable).isFile(),'Pass an existing absolute portable executable path');
 assert(path.isAbsolute(updaterModule),'Updater module path must be absolute');
 const {AppUpdater}=require(updaterModule),before=await sha256(executable),requests=[],dataDir=path.join(os.tmpdir(),'vrc-check-only-'+crypto.randomUUID()),previous=process.env.PORTABLE_EXECUTABLE_FILE;
 process.env.PORTABLE_EXECUTABLE_FILE=executable;let updater;
 try{
  updater=new AppUpdater({version:currentVersion,dataDir,roots:()=>[],executable,packaged:true,canNetwork:()=>true,fetch:async(url,init)=>{
   assert.equal(url,endpoint,'Check-only script blocked a payload or another endpoint');assert.equal(requests.length,0,'Only one metadata request is allowed');requests.push(url);return request(url,init);
  },quit:()=>{throw Error('Check-only script must never quit the application')},launchHelper:async()=>{throw Error('Check-only script must never start an update helper')}});
  const state=await updater.check(),after=await sha256(executable);
  assert.equal(state.status,expectedStatus,state.message);assert.equal(state.currentVersion,currentVersion);assert.equal(state.latestVersion,expectedVersion);assert.equal(state.receivedBytes,0);assert.equal(after,before,'Check changed the portable executable');assert.equal(fs.existsSync(dataDir),false,'Check created a staging profile');
  return {ok:true,currentVersion,expectedVersion,updaterModule,executable,state,requests,noPayloadDownloaded:true,executableUnchanged:true,sha256:before};
 }finally{updater?.close();if(previous===undefined)delete process.env.PORTABLE_EXECUTABLE_FILE;else process.env.PORTABLE_EXECUTABLE_FILE=previous}
}
module.exports={checkStableUpdate};
if(require.main===module)(async()=>{
 const names={'--current-version':'currentVersion','--expected-version':'expectedVersion','--expect-status':'expectedStatus','--executable':'executable','--updater-module':'updaterModule','--report':'report'},options={};
 for(let index=2;index<process.argv.length;index+=2){const key=names[process.argv[index]],value=process.argv[index+1];if(!key||!value||value.startsWith('--'))throw Error('Usage: node scripts/check-stable-update.cjs --current-version 1.3.0 --expected-version 1.4.0 --expect-status available --executable ABSOLUTE_EXE [--updater-module ABSOLUTE_JS] [--report ABSOLUTE_JSON]');options[key]=value}
 if(options.report)assert(path.isAbsolute(options.report),'Report path must be absolute');
 const report=await checkStableUpdate(options);if(options.report)fs.writeFileSync(options.report,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
