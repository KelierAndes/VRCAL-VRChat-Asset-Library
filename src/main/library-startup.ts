import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {assertUserStorage} from './storage';
import {assertSafeWrite} from './safety';

export interface LibraryProbe {ok:boolean;reason?:string}
/** Validate an existing library using read-only SQLite, without creating a profile. */
export function probeLibrary(directory:string,roots:string[],allowC=false):LibraryProbe {
 try {
  const folder=assertUserStorage(directory,roots,allowC),file=assertSafeWrite(path.join(folder,'library.sqlite'),folder,roots);
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size<100)return {ok:false,reason:'原位置的 library.sqlite 不是有效的数据库文件。'};
  const fd=fs.openSync(file,'r');try{const current=fs.fstatSync(fd),header=Buffer.alloc(16);if(current.dev!==stat.dev||current.ino!==stat.ino||fs.readSync(fd,header,0,16,0)!==16||!header.equals(Buffer.from('SQLite format 3\0')))return {ok:false,reason:'原位置的 library.sqlite 不是有效的数据库文件。'};}finally{fs.closeSync(fd)}
  const db=new DatabaseSync(file,{readOnly:true});try{
   db.prepare('SELECT id,path,record FROM assets LIMIT 1').get();
   db.prepare('SELECT key,value FROM settings LIMIT 1').get();
   const check=db.prepare('PRAGMA quick_check(1)').get();if(!check||Object.values(check)[0]!=='ok')return {ok:false,reason:'原位置的资料库数据库未通过只读检查。'};
  }finally{db.close()}
  return {ok:true};
 } catch(error:any) {
  return {ok:false,reason:['ENOENT','ENOTDIR'].includes(error.code)?'原位置找不到 library.sqlite，请检查磁盘连接或文件夹是否移动。':error instanceof Error?error.message:'资料库文件暂时无法读取。'};
 }
}

export function existingLibraryDirectory(selected:string,roots:string[],allowC=false):string {
 const folder=assertUserStorage(selected,roots,allowC),direct=probeLibrary(folder,roots,allowC);
 if(direct.ok)return folder;
 // The user may choose either the library itself or the parent selected at first run.
 if(!fs.existsSync(path.join(folder,'library.sqlite'))){const child=path.join(folder,'VRChatAssetLibrary');if(probeLibrary(child,roots,allowC).ok)return child;}
 throw new Error('请选择包含有效 library.sqlite 的已有资料库文件夹；当前选择不会新建资料库。');
}
