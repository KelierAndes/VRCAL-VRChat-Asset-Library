import path from 'node:path';
import {fork} from 'node:child_process';
import type {ModelSource,ModelIndex} from './model-preview-files';
import type {ModelBundle,ModelSceneBundle} from '../shared/model-preview';
interface Child {on:(e:string,cb:(...args:any[])=>void)=>unknown;once:(e:string,cb:(...args:any[])=>void)=>unknown;kill:()=>unknown;send?:(v:unknown)=>unknown;postMessage?:(v:unknown)=>unknown}
function task<T>(request:unknown,signal?:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{
 if(signal?.aborted){reject(new Error('预览读取已取消。'));return}let child:Child|undefined,done=false,timer:ReturnType<typeof setTimeout>|undefined;
 const finish=(error?:Error,result?:T)=>{if(done)return;done=true;if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);child?.kill();if(error)reject(error);else resolve(result!)};
 const abort=()=>finish(new Error('预览读取已取消。'));
 try{const entry=path.join(__dirname,'model-preview-worker.js'),env:NodeJS.ProcessEnv={};for(const key of ['SystemRoot','WINDIR','PATH','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  if(process.versions.electron&&(process as NodeJS.Process&{type?:string}).type==='browser'){const {utilityProcess,session}=require('electron') as typeof import('electron');const offline=session.fromPartition('vrc-model-reader');offline.webRequest.onBeforeRequest((_request,callback)=>callback({cancel:true}));child=utilityProcess.fork(entry,[],{env,stdio:'ignore',serviceName:'3D 模型只读预览',execArgv:['--max-old-space-size=384'],session:offline}) as unknown as Child}
  else child=fork(entry,[],{env,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced',execArgv:['--max-old-space-size=384']}) as unknown as Child;
  child.on('message',(message:any)=>message?.ok?finish(undefined,message.result as T):finish(new Error(String(message?.error||'模型读取失败。'))));child.once('error',()=>finish(new Error('模型解析进程未能启动。')));child.once('exit',()=>finish(new Error('模型解析中断，素材过大或格式不支持；资料库可继续使用。')));
  child.once('spawn',()=>{if(!done){if(child?.postMessage)child.postMessage(request);else child?.send?.(request)}});timer=setTimeout(()=>finish(new Error('模型预览读取超时，请选择更小的素材目录。')),45000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 }catch(e){finish(e instanceof Error?e:new Error('模型预览读取失败。'))}
})}
export const readModelIndex=(source:string,signal?:AbortSignal,sourceLimit=16)=>task<ModelIndex>({action:'index',source,sourceLimit},signal);
export const readModelBundle=(model:ModelSource,signal?:AbortSignal)=>task<ModelBundle>({action:'load',model},signal);
export const readModelScene=(primary:ModelSource,reference:ModelSource|undefined,signal?:AbortSignal)=>task<ModelSceneBundle>({action:'scene',primary,reference},signal);
