import fs from 'node:fs';
import path from 'node:path';
import {createGunzip} from 'node:zlib';
import {spawn} from 'node:child_process';
import * as yauzl from 'yauzl';
import type {FileListing} from '../shared/contracts';
const LIMIT=2000;
const pause=()=>new Promise<void>(resolve=>setImmediate(resolve));
export function zipFiles(source:string,limit=LIMIT):Promise<FileListing>{return new Promise((resolve,reject)=>{
  yauzl.open(source,{lazyEntries:true,decodeStrings:true},(error,zip)=>{
    if(error||!zip){reject(error??new Error('压缩包无法读取。'));return}
    const entries:FileListing['entries']=[];let settled=false,encrypted=false;
    const finish=(truncated:boolean)=>{if(settled)return;settled=true;zip.close();resolve({entries,truncated:truncated||encrypted,message:encrypted?'包内目录可读取，但存在加密内容；适配信息以文件名线索为准。':undefined})};
    zip.on('entry',entry=>{encrypted||=!!(entry.generalPurposeBitFlag&1);entries.push({name:entry.fileName,size:entry.uncompressedSize,directory:entry.fileName.endsWith('/')});if(entries.length>=limit)finish(true);else zip.readEntry()});
    zip.on('end',()=>finish(false));zip.on('error',error=>{if(!settled){settled=true;zip.close();reject(error)}});zip.readEntry();
  });
})}
export async function unityFiles(source:string,limits={maxBytes:128*1024*1024,maxTime:30000,maxEntries:LIMIT}):Promise<FileListing>{
  const entries:FileListing['entries']=[];const assets=new Map<string,number>();let truncated=false;
  const input=fs.createReadStream(source),gunzip=createGunzip();input.on('error',error=>gunzip.destroy(error));input.pipe(gunzip);
  let buffer=Buffer.alloc(0),remaining=0,padding=0,filename='',saved:Buffer[]=[];let stopped=false,decompressedBytes=0;
  const timer=setTimeout(()=>{truncated=true;stopped=true;input.destroy();gunzip.destroy()},limits.maxTime);
  try{
    for await(const chunk of gunzip){decompressedBytes+=(chunk as Buffer).length;if(decompressedBytes>limits.maxBytes){truncated=true;stopped=true;input.destroy();gunzip.destroy();break}buffer=Buffer.concat([buffer,chunk as Buffer]);
      while(buffer.length){
        if(remaining>0){const length=Math.min(remaining,buffer.length);if(filename.endsWith('/pathname')&&remaining<=65536)saved.push(buffer.subarray(0,length));remaining-=length;buffer=buffer.subarray(length);if(remaining>0)break;
          if(filename.endsWith('/pathname')){const name=Buffer.concat(saved).toString('utf8').trim().replace(/\0/g,'');if(name)entries.push({name,size:assets.get(filename.split('/')[0])??0,directory:false});saved=[]}if(entries.length>=limits.maxEntries){truncated=true;stopped=true;input.destroy();gunzip.destroy();break}
        }
        if(padding){const length=Math.min(padding,buffer.length);padding-=length;buffer=buffer.subarray(length);if(padding)break}
        if(buffer.length<512)break;
        const header=buffer.subarray(0,512);buffer=buffer.subarray(512);if(header.every(byte=>byte===0)){stopped=true;input.destroy();gunzip.destroy();break}
        filename=header.subarray(0,100).toString('utf8').replace(/\0.*$/s,'');const prefix=header.subarray(345,500).toString('utf8').replace(/\0.*$/s,'');if(prefix)filename=prefix+'/'+filename;
        remaining=parseInt(header.subarray(124,136).toString('ascii').replace(/\0/g,'').trim()||'0',8);if(!Number.isFinite(remaining)||remaining<0)throw new Error('Unitypackage 包头无效。');padding=(512-remaining%512)%512;saved=[];
        if(filename.endsWith('/asset'))assets.set(filename.split('/')[0],remaining);
      }
      if(stopped)break;await pause();
    }
  }catch(error){if(!stopped)throw error}finally{clearTimeout(timer);input.destroy();gunzip.destroy()}
  return {entries,truncated,message:truncated?`包内列表达到读取上限（最多 ${limits.maxEntries.toLocaleString('zh-CN')} 条、${Math.round(limits.maxBytes/1024/1024*10)/10} MB 数据或 ${limits.maxTime/1000} 秒）；展示已读取的路径，未解压到磁盘。`:entries.length?'只读取包内的路径记录，未解压到磁盘。':'未找到路径记录；包可能损坏或采用不同格式。'};
}
export function externalArchiveFiles(source:string,timeoutMs=15000,signal?:AbortSignal):Promise<FileListing>{return new Promise(resolve=>{
  const tar=process.platform==='win32'?path.join(process.env.SystemRoot??'C:\\Windows','System32','tar.exe'):'tar';
  const child=spawn(tar,['-tf',source],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='',settled=false;
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  const fallback=()=>({entries:[],truncated:false,message:'此 RAR / 7z 格式暂不能列出内容。可右键定位文件并用已有压缩工具查看；应用不会解压或修改它。'});
  const timer=setTimeout(()=>{child.kill();finish(fallback())},timeoutMs);
  const finish=(result:FileListing)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(result)};
  const abort=()=>{child.kill();finish({entries:[],truncated:true,message:'素材包读取已取消。'})};
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return}
  child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>2*1024*1024)child.kill()});child.stderr.on('data',chunk=>{error+=chunk.toString('utf8').slice(0,2000)});
  child.on('error',()=>finish(fallback()));child.on('close',code=>{if(code!==0){finish(fallback());return}const names=output.split(/\r?\n/).filter(Boolean);finish({entries:names.slice(0,LIMIT).map(name=>({name,size:0,directory:name.endsWith('/')})),truncated:names.length>LIMIT,message:'只读取文件目录；此格式未统计单个文件大小。'})});
})}
