const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const root='E:\\VRChat';
const output=path.resolve(__dirname,'..','..','source-audit.json');
const excluded=new Set(['library','temp','obj','logs','.git','node_modules','packagecache','_internal']);
const installs=new Set(['unity','unityhub','vrchat creator companion']);
async function inventory(){
 const entries={}; const samples={}; let count=0;
 async function walk(dir,depth){
  let children;try{children=await fs.readdir(dir,{withFileTypes:true})}catch{return}
  for(const child of children){
   const full=path.join(dir,child.name);let stat;try{stat=await fs.lstat(full)}catch{continue}
   if(stat.isSymbolicLink()) continue;
   if(child.isDirectory()){if(excluded.has(child.name.toLowerCase()) || (depth===0 && installs.has(child.name.toLowerCase())))continue;await walk(full,depth+1)}
   else if(child.isFile()){
    const relative=path.relative(root,full);entries[relative]=[stat.size,stat.mtimeMs];count++;
    const group=relative.split(path.sep)[0];
    if(!samples[group] && stat.size>0 && stat.size<8*1024*1024 && /\.(unitypackage|zip|fbx|blend|png|txt|asset)$/i.test(child.name)){
     try{samples[group]={path:relative,sha256:crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex')}}catch{}
    }
   }
  }
 }
 await walk(root,0);return{root,count,entries,samples,time:new Date().toISOString()};
}
(async()=>{const current=await inventory();if(process.argv.includes('--compare')){
 const baseline=JSON.parse(await fs.readFile(output,'utf8'));
 const changed=Object.keys(baseline.entries).filter(k=>JSON.stringify(baseline.entries[k])!==JSON.stringify(current.entries[k]));
 const added=Object.keys(current.entries).filter(k=>!baseline.entries[k]);
 const samples=Object.keys(baseline.samples).map(k=>({group:k,path:baseline.samples[k].path,match:baseline.samples[k].sha256===current.samples[k]?.sha256}));
 const result={files:current.count,changed:changed.slice(0,20),changedCount:changed.length,addedCount:added.length,samples};
 await fs.writeFile(path.resolve(__dirname,'..','..','source-audit-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(changed.length || added.length || samples.some(x=>!x.match))process.exitCode=1;
}else{await fs.writeFile(output,JSON.stringify(current));console.log(JSON.stringify({files:current.count,samples:Object.keys(current.samples).length}))}})().catch(e=>{console.error(e.message);process.exitCode=1});
