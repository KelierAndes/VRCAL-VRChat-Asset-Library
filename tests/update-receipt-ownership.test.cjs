const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const build=process.env.VRCAL_WRITE_TEST_BUILD||path.join(__dirname,'../dist/main'),{acknowledgeUpdateStartup}=require(path.join(build,'main/update-receipt'));
const token='11111111-1111-4111-8111-111111111111';
function fixture(t){
 const area=fs.mkdtempSync(path.join(os.tmpdir(),'vrc-receipt-ownership-')),data=path.join(area,'Library'),stage=path.join(data,'updates',token),root=path.join(area,'Source'),target=path.join(area,'current.exe'),bytes=Buffer.alloc(1024,3);fs.mkdirSync(stage,{recursive:true});fs.mkdirSync(root);fs.writeFileSync(target,bytes);
 fs.writeFileSync(path.join(stage,'install.json'),JSON.stringify({schema:1,version:'1.10.0',token,dataDir:data,stageDir:stage,target,staged:path.join(stage,'update.exe'),protectedRoots:[root],sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length,expectedTargetSha256:'1'.repeat(64),expectedTargetSize:1024,parentPid:2147483647}));
 const argv=process.argv,portable=process.env.PORTABLE_EXECUTABLE_FILE;process.argv=[process.execPath,'app','--vrc-update-token='+token];process.env.PORTABLE_EXECUTABLE_FILE=target;
 t.after(()=>{process.argv=argv;if(portable===undefined)delete process.env.PORTABLE_EXECUTABLE_FILE;else process.env.PORTABLE_EXECUTABLE_FILE=portable;const actual=fs.realpathSync(area);assert.equal(path.dirname(actual),fs.realpathSync(os.tmpdir()));assert(path.basename(actual).startsWith('vrc-receipt-ownership-'));fs.rmSync(actual,{recursive:true,force:true,maxRetries:3})});
 return {stage,receipt:path.join(stage,'startup-ready.json'),ack:()=>acknowledgeUpdateStartup(data,[root],'1.10.0')};
}
test('update receipt publication removes only its own temporary hardlink and retains the receipt with one name',async t=>{
 const f=fixture(t);assert.equal(await f.ack(),true);assert.equal(fs.lstatSync(f.receipt).nlink,1);assert.equal(JSON.parse(fs.readFileSync(f.receipt,'utf8')).startupReady,true);assert(!fs.readdirSync(f.stage).some(name=>name.endsWith('.tmp')));
});
test('a failed exclusive receipt temporary open never deletes the preexisting colliding file',async t=>{
 const f=fixture(t),open=fsp.open;let collision;
 fsp.open=async function(file,flags,...args){if(flags==='wx'&&path.dirname(file)===f.stage){collision=file;fs.writeFileSync(file,'FOREIGN FILE')}return open.call(this,file,flags,...args)};
 try{await assert.rejects(f.ack,error=>error.code==='EEXIST')}finally{fsp.open=open}
 assert(collision);assert.equal(fs.readFileSync(collision,'utf8'),'FOREIGN FILE');assert(!fs.existsSync(f.receipt));
});
test('failed receipt publication preserves a different inode substituted at its temporary pathname',async t=>{
 const f=fixture(t),link=fsp.link;let replaced;
 fsp.link=async function(from){fs.renameSync(from,from+'.held');fs.writeFileSync(from,'FOREIGN REPLACEMENT');replaced=from;throw Object.assign(Error('synthetic denied publication'),{code:'EACCES'})};
 try{await assert.rejects(f.ack,error=>error.code==='EACCES')}finally{fsp.link=link}
 assert(replaced);assert.equal(fs.readFileSync(replaced,'utf8'),'FOREIGN REPLACEMENT');assert(!fs.existsSync(f.receipt));
});
