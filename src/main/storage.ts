import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {assertSafeWrite,isWithin} from './safety';
export interface LocationConfig {dataDir?:string;backupDir?:string}
export function readLocation(file:string):LocationConfig {
 try {const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8192)return {};const data=JSON.parse(fs.readFileSync(file,'utf8'));return {dataDir:typeof data.dataDir==='string'&&path.isAbsolute(data.dataDir)?data.dataDir:undefined,backupDir:typeof data.backupDir==='string'&&path.isAbsolute(data.backupDir)?data.backupDir:undefined}}catch{return {}}
}
export function assertUserStorage(target:string,roots:string[],allowC=false):string {
 const resolved=assertSafeWrite(target,path.dirname(target),roots,true);
 if(!allowC&&/^c:[\\/]/i.test(resolved))throw new Error('请选择 C 盘以外的保存位置。');
 return resolved;
}
export function writeLocation(file:string,config:LocationConfig,roots:string[]):void {
 const target=assertSafeWrite(file,path.dirname(file),roots,true),temporary=assertSafeWrite(target+'.tmp',path.dirname(file),roots,true);
 fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(temporary,JSON.stringify(config,null,2));fs.renameSync(temporary,target);
}
async function digest(file:string):Promise<string>{const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex')}
/** Copy application-owned database/cache only. Original files and the old profile stay intact. */
export async function copyLibraryData(source:string,target:string,roots:string[],allowC=false):Promise<{files:number;bytes:number}> {
 const destination=assertUserStorage(target,roots,allowC);
 if(isWithin(destination,source)||isWithin(source,destination))throw new Error('新资料库位置不能与原位置相互包含。');
 if(fs.existsSync(destination)&&(await fsp.readdir(destination)).length)throw new Error('目标资料库文件夹已有内容，请选择一个新位置。');
 const database=path.join(source,'library.sqlite');const info=await fsp.lstat(database);if(!info.isFile()||info.isSymbolicLink())throw new Error('原资料库数据库无法读取。');
 const createdFiles:string[]=[],createdDirs:string[]=[];let bytes=0;
 const make=async(directory:string)=>{assertUserStorage(directory,roots,allowC);if(!fs.existsSync(directory)){await fsp.mkdir(directory);createdDirs.push(directory)}};
 const copy=async(from:string,to:string)=>{const stat=await fsp.lstat(from);if(stat.isSymbolicLink())throw new Error('资料库包含目录链接，迁移已停止。');if(stat.isDirectory()){await make(to);for(const name of await fsp.readdir(from))await copy(path.join(from,name),path.join(to,name));return}if(!stat.isFile())return;assertUserStorage(to,roots,allowC);await fsp.copyFile(from,to,fs.constants.COPYFILE_EXCL);createdFiles.push(to);if(await digest(from)!==await digest(to))throw new Error('资料库复制校验失败，原位置仍保留。');bytes+=stat.size};
 try{
  const parent=path.dirname(destination);await fsp.mkdir(assertUserStorage(parent,roots,allowC),{recursive:true});await make(destination);
  await copy(database,path.join(destination,'library.sqlite'));
  for(const name of ['queue.json','cache','booth-downloads.json','booth-session-cookies.bin','booth-session','xianyu-session','xianyu-session-cookies.bin'])if(fs.existsSync(path.join(source,name)))await copy(path.join(source,name),path.join(destination,name));
  const sourceSession=path.join(source,'session'),keyFile=path.join(sourceSession,'Local State');
  if(fs.existsSync(keyFile)){const stat=await fsp.lstat(sourceSession);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('资料库浏览会话包含目录链接，迁移已停止。');await make(path.join(destination,'session'));await copy(keyFile,path.join(destination,'session','Local State'));}
  return {files:createdFiles.length,bytes};
 }catch(error){
  // Remove only files created by this failed copy, after checking the destination boundary.
  for(const file of createdFiles.reverse())if(isWithin(file,destination))try{assertUserStorage(file,roots,allowC);await fsp.unlink(file)}catch{}
  for(const directory of createdDirs.reverse())if(isWithin(directory,destination))try{await fsp.rmdir(directory)}catch{}
  throw error;
 }
}
