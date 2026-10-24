import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function comparable(value:string):string { const resolved=path.resolve(value); return process.platform==='win32'?resolved.toLowerCase():resolved; }
export function isWithin(target:string,root:string):boolean {
  const relative=path.relative(comparable(root),comparable(target));
  return relative==='' || (!relative.startsWith(`..${path.sep}`) && relative!=='..' && !path.isAbsolute(relative));
}
function existingRealPath(value:string):string { try{return fs.realpathSync.native(value)}catch{return path.resolve(value)} }
/** All writes pass here. Existing links anywhere in a destination are rejected. */
export function assertSafeWrite(target:string,dataDir:string,roots:string[],allowExternal=false):string {
  if(!path.isAbsolute(target)||!path.isAbsolute(dataDir)) throw new Error('写入路径必须是绝对路径。');
  const resolved=path.resolve(target), data=path.resolve(dataDir);
  const protectedRoots=roots.flatMap(root=>[path.resolve(root),existingRealPath(root)]);
  if(protectedRoots.some(root=>isWithin(resolved,root))) throw new Error('素材目录受到保护，不能写入或覆盖。');
  if(!allowExternal && !isWithin(resolved,data)) throw new Error('写入位置必须位于应用资料库内。');
  for(let current=resolved;;current=path.dirname(current)){
    try { const stat=fs.lstatSync(current);if(stat.isSymbolicLink())throw new Error('写入路径包含目录链接，已阻止。');if(stat.isFile()&&stat.nlink>1)throw new Error('写入路径包含硬链接文件，已阻止。'); }
    catch(error:any){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error}
    const parent=path.dirname(current);if(parent===current)break;
  }
  return resolved;
}
function sameOwnedFile(a:fs.BigIntStats,b:fs.BigIntStats):boolean {return a.isFile()&&b.isFile()&&!b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs}
/** Publish complete metadata without opening an existing temporary pathname for writing. */
export function writeOwnedAtomic(file:string,data:string|Buffer,dataDir:string,roots:string[],allowExternal=false):void {
  const target=assertSafeWrite(file,dataDir,roots,allowExternal),directory=path.dirname(target);
  fs.mkdirSync(directory,{recursive:true});assertSafeWrite(directory,dataDir,roots,allowExternal);
  const temporary=assertSafeWrite(target+'.'+crypto.randomUUID()+'.tmp',dataDir,roots,allowExternal);
  let owned:fs.BigIntStats|undefined;
  try{
    const descriptor=fs.openSync(temporary,'wx',0o600);
    try{owned=fs.fstatSync(descriptor,{bigint:true});if(!owned.isFile()||owned.nlink!==1n)throw new Error('临时文件包含硬链接，已停止保存。');fs.writeFileSync(descriptor,data)}finally{fs.closeSync(descriptor)}
    assertSafeWrite(target,dataDir,roots,allowExternal);assertSafeWrite(temporary,dataDir,roots,allowExternal);
    const ready=fs.lstatSync(temporary,{bigint:true});if(ready.nlink!==1n||!sameOwnedFile(owned,ready))throw new Error('临时文件已发生变化，已停止保存。');
    fs.renameSync(temporary,target);
  }finally{
    // A failed exclusive open never owns the colliding file. A substituted path is not ours either.
    if(owned)try{assertSafeWrite(directory,dataDir,roots,allowExternal);const current=fs.lstatSync(temporary,{bigint:true});if(sameOwnedFile(owned,current))fs.unlinkSync(temporary)}catch{}
  }
}
export function safeCoverPath(dataDir:string,file:string):string {
  if(!file || file!==path.basename(file) || /[\\/:\x00]/.test(file)) throw new Error('无效的封面文件名。');
  return assertSafeWrite(path.join(dataDir,'cache',file),dataDir,[]);
}
export async function copyCover(source:string,dataDir:string,roots:string[]):Promise<string> {
  const stat=await fsp.lstat(source);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>25*1024*1024)throw new Error('封面必须是小于 25 MB 的本地图片文件。');
  const extension=path.extname(source).toLowerCase();
  if(!['.png','.jpg','.jpeg','.webp','.gif','.bmp'].includes(extension))throw new Error('封面图片格式不支持。');
  const bytes=await fsp.readFile(source);
  const name=crypto.createHash('sha256').update(bytes).digest('hex')+extension;
  const directory=assertSafeWrite(path.join(dataDir,'cache'),dataDir,roots);
  await fsp.mkdir(directory,{recursive:true});
  const destination=assertSafeWrite(path.join(directory,name),dataDir,roots);
  if(!fs.existsSync(destination))try{await fsp.writeFile(destination,bytes,{flag:'wx'})}catch(error:any){if(error.code!=='EEXIST')throw error}
  return name;
}
