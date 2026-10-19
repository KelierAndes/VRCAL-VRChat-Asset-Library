import path from 'node:path';
import {validateArchiveSource} from './archive-path';
import {zipFiles,unityFiles} from './archive-formats';
import type {FileListing} from '../shared/contracts';

interface Request {source:string;roots:string[];limit:number;maxBytes:number;maxTime:number}
const port=(process as unknown as {parentPort?:{on:(event:string,callback:(event:{data:unknown})=>void)=>void;postMessage:(value:unknown)=>void}}).parentPort;
let started=false;
async function run(value:unknown):Promise<void> {
 if(started)return;started=true;
 const send=(message:unknown)=>{if(port)port.postMessage(message);else process.send?.(message);setTimeout(()=>process.exit(0),20)};
 try{
  const request=value as Request;
  if(!request)throw new Error('解析任务无效。');
  const source=await validateArchiveSource(request.source,request.roots);
  const limit=Math.max(1,Math.min(2000,Number(request.limit)||2000)),maxBytes=Math.max(1024,Math.min(128*1024*1024,Number(request.maxBytes)||128*1024*1024)),maxTime=Math.max(100,Math.min(30000,Number(request.maxTime)||15000));
  const extension=path.extname(source).toLowerCase();
  let listing:FileListing;
  if(extension==='.zip')listing=await zipFiles(source,limit);
  else if(extension==='.unitypackage')listing=await unityFiles(source,{maxBytes,maxTime,maxEntries:limit});
  else throw new Error('此类型不是支持的素材包。');
  const entries=listing.entries.slice(0,limit).map(entry=>({name:String(entry.name).slice(0,4096).replace(/\0/g,''),size:Number.isFinite(entry.size)?Math.max(0,entry.size):0,directory:!!entry.directory}));
  send({ok:true,listing:{entries,truncated:listing.truncated||listing.entries.length>limit,message:listing.message?.slice(0,2000)}});
 }catch(error){send({ok:false,error:error instanceof Error?error.message:'素材包无法解析。'})}
}
if(port)port.on('message',event=>void run(event.data));else process.once('message',value=>void run(value));
// This fixed parser has no network operation or writable-material interface.
globalThis.fetch=async()=>{throw new Error('素材包解析不使用网络。')};
