import fs from 'node:fs';
import path from 'node:path';
import {fork} from 'node:child_process';
import {validateArchiveSource} from './archive-path';
import {externalArchiveFiles} from './archive-formats';
import type {FileListing} from '../shared/contracts';

export interface ArchiveReadOptions {limit?:number;maxBytes?:number;maxTime?:number;signal?:AbortSignal}
interface Job {source:string;roots:string[];options:ArchiveReadOptions;resolve:(listing:FileListing)=>void;reject:(error:Error)=>void;queuedAbort?:()=>void}
interface Child {on:(event:string,callback:(...args:any[])=>void)=>unknown;once:(event:string,callback:(...args:any[])=>void)=>unknown;kill:()=>unknown;send?:(value:unknown)=>unknown;postMessage?:(value:unknown)=>unknown;pid?:number}
const jobs:Job[]=[];let active=0;

/** Bounded isolated readers; archive content never executes in the library process. */
export function readArchive(source:string,roots:string[],options:ArchiveReadOptions={}):Promise<FileListing> {
 return new Promise((resolve,reject)=>{
  if(options.signal?.aborted){reject(new Error('素材包读取已取消。'));return}
  const job:Job={source,roots:[...roots],options,resolve,reject};
  job.queuedAbort=()=>{const index=jobs.indexOf(job);if(index>=0){jobs.splice(index,1);reject(new Error('素材包读取已取消。'));}};
  options.signal?.addEventListener('abort',job.queuedAbort,{once:true});jobs.push(job);start();
 });
}
function start():void {while(active<2&&jobs.length){const job=jobs.shift()!;job.options.signal?.removeEventListener('abort',job.queuedAbort!);if(job.options.signal?.aborted){job.reject(new Error('素材包读取已取消。'));continue}active++;void run(job).finally(()=>{active--;start()});}}
async function run(job:Job):Promise<void> {
 if(['.rar','.7z'].includes(path.extname(job.source).toLowerCase())){
  try{const source=await validateArchiveSource(job.source,job.roots);if(job.options.signal?.aborted)throw new Error('素材包读取已取消。');const listing=await externalArchiveFiles(source,job.options.maxTime??15000,job.options.signal);if(job.options.signal?.aborted)throw new Error('素材包读取已取消。');const limit=Math.min(2000,job.options.limit??2000);job.resolve({...listing,entries:listing.entries.slice(0,limit),truncated:listing.truncated||listing.entries.length>limit});}
  catch(error){job.reject(error instanceof Error?error:new Error('素材包读取失败。'));}return;
 }
 await new Promise<void>(done=>{
  let child:Child|undefined,finished=false,timer:ReturnType<typeof setTimeout>|undefined;
  const finish=(error?:Error,listing?:FileListing)=>{if(finished)return;finished=true;if(timer)clearTimeout(timer);job.options.signal?.removeEventListener('abort',abort);child?.kill();if(error)job.reject(error);else job.resolve(listing!);done();};
  const abort=()=>finish(new Error('素材包读取已取消。'));
  try{
   if(!path.isAbsolute(job.source)||!job.roots.length)throw new Error('解析任务路径无效。');
   const entry=path.join(__dirname,'archive-worker.js');if(!fs.existsSync(entry))throw new Error('素材包读取模块缺失，请重新打开完整程序。');
   const env:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP','LANG','LC_ALL'])if(process.env[key])env[key]=process.env[key];
   if(process.versions.electron&&(process as NodeJS.Process&{type?:string}).type==='browser'){
    const {utilityProcess,session}=require('electron') as typeof import('electron');const offline=session.fromPartition('vrc-archive-offline');offline.webRequest.onBeforeRequest((_details,callback)=>callback({cancel:true}));
    child=utilityProcess.fork(entry,[],{env,stdio:'ignore',serviceName:'素材包只读解析',execArgv:['--max-old-space-size=160'],session:offline}) as unknown as Child;
   }else child=fork(entry,[],{env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=160']}) as unknown as Child;
   child.on('message',(response:any)=>{if(!response||response.ok!==true){finish(new Error(typeof response?.error==='string'?response.error:'素材包无法解析。'));return}const listing=response.listing;if(!listing||!Array.isArray(listing.entries)||listing.entries.length>2000){finish(new Error('素材包返回的列表无效。'));return}finish(undefined,{entries:listing.entries,truncated:!!listing.truncated,message:typeof listing.message==='string'?listing.message:undefined});});
   child.once('error',()=>finish(new Error('素材包解析进程未能启动。')));child.once('exit',()=>finish(new Error('素材包解析提前结束；资料库仍可浏览。')));
   const payload={source:job.source,roots:job.roots,limit:job.options.limit??2000,maxBytes:job.options.maxBytes??128*1024*1024,maxTime:job.options.maxTime??15000};
   const send=()=>{if(!finished){if(child?.postMessage)child.postMessage(payload);else child?.send?.(payload);}};
   child.once('spawn',send);
   job.options.signal?.addEventListener('abort',abort,{once:true});if(job.options.signal?.aborted){abort();return}
   timer=setTimeout(()=>finish(new Error('素材包读取超时，已停止此任务；其他素材仍可浏览。')),Math.max(100,Math.min(30000,job.options.maxTime??15000))+1200);
  }catch(error){finish(error instanceof Error?error:new Error('素材包读取失败。'))}
 });
}
