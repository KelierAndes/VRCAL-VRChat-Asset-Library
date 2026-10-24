import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {assertSafeWrite,isWithin,writeOwnedAtomic} from './safety';
import {isAvatarName} from './hints';

const UUID='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export const MANAGED_DOWNLOAD_DIRECTORY=new RegExp('^.+--vrcal-'+UUID+'$','i');
const MARKER='.vrcal-download-group.json';
interface DirectoryIdentity {device:string;inode:string;birthtime:string}
interface Group {id:string;key:string;directory:string;folder:string;identity:DirectoryIdentity}
const identity=(s:fs.BigIntStats):DirectoryIdentity=>({device:s.dev.toString(),inode:s.ino.toString(),birthtime:s.birthtimeNs.toString()});
const pathKey=(p:string)=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
const exists=(p:string)=>{try{fs.lstatSync(p);return true}catch(e:any){if(e.code==='ENOENT')return false;throw e}};
function filename(value:string):string {
 if(typeof value!=='string'||!value||value.length>200||value!==value.trim()||/[\\/:*?"<>|\x00-\x1f]/.test(value)||/[. ]$/.test(value)||/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(value)||value==='.'||value==='..')throw new Error('下载文件名无法安全保存。');
 return value;
}
function folderLabel(value:string):string {
 let label=String(value||'下载').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').trim().slice(0,70).replace(/[. ]+$/g,'');
 if(!label||label==='.'||label==='..')label='下载';
 if(/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(label))label='_'+label;
 return label;
}
/** Strip only known packaging prefixes, trailing versions and verified avatar aliases. */
export function downloadFamily(value:string):string {
 let name=path.basename(value).normalize('NFC').replace(/\.(?:zip|rar|7z|unitypackage|psd|mdp|spp|fbx|blend|vrm|obj)$/i,'');
 name=name.replace(/^(?:(?:MAT_TEX|PSD_mdp|PSD|TEX|TEXTURES|MATERIALS)[_\s]+)+/i,'');
 for(;;){const next=name.replace(/(?:[_\s-]+(?:ver(?:sion)?\.?|v)\s*\d+(?:\.\d+)*[a-z]?|[_\s-]+\d+(?:\.\d+)+)$/i,'').replace(/\s*\(\d+\)$/,'').trim();if(next===name)break;name=next}
 const parts=name.split(/[_\s]+/).filter(Boolean);
 while(parts.length>1&&isAvatarName(parts.at(-1)!))parts.pop();
 return parts.join('_')||path.basename(value);
}

/** New explicit downloads only. Never adopts an existing user directory or moves old files. */
export class DownloadFolders {
 private reserved=new Set<string>();
 private owned=new Map<string,Group>();
 constructor(private readonly dataDir:string,private readonly roots:()=>string[]){}
 private journal(){return assertSafeWrite(path.join(this.dataDir,'download-folders.json'),this.dataDir,this.roots())}
 private read():Group[]{
  try{const file=this.journal(),s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>2*1024*1024)return [];const v=JSON.parse(fs.readFileSync(file,'utf8'));if(v.schema!==1||!Array.isArray(v.groups))return [];
   return v.groups.slice(-5000).filter((g:any)=>g&&typeof g.id==='string'&&new RegExp('^'+UUID+'$','i').test(g.id)&&typeof g.key==='string'&&/^[a-f0-9]{64}$/.test(g.key)&&typeof g.directory==='string'&&path.isAbsolute(g.directory)&&typeof g.folder==='string'&&path.isAbsolute(g.folder)&&pathKey(path.dirname(g.folder))===pathKey(g.directory)&&MANAGED_DOWNLOAD_DIRECTORY.test(path.basename(g.folder))&&path.basename(g.folder).endsWith('--vrcal-'+g.id)&&g.identity&&['device','inode','birthtime'].every(k=>typeof g.identity[k]==='string'&&/^\d{1,40}$/.test(g.identity[k]))&&g.identity.inode!=='0'&&g.identity.birthtime!=='0').map((g:Group)=>({id:g.id,key:g.key,directory:g.directory,folder:g.folder,identity:g.identity}));
  }catch{return []}
 }
 private validate(g:Group):void {
  const folder=assertSafeWrite(g.folder,this.dataDir,[...this.roots(),this.dataDir],true),stat=fs.lstatSync(folder,{bigint:true});if(!stat.isDirectory()||stat.isSymbolicLink()||JSON.stringify(identity(stat))!==JSON.stringify(g.identity))throw new Error('下载归组目录已发生变化，请重新选择下载位置。');
  const marker=assertSafeWrite(path.join(folder,MARKER),this.dataDir,[...this.roots(),this.dataDir],true),s=fs.lstatSync(marker);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>2048)throw new Error('下载归组标记无效。');
  const v=JSON.parse(fs.readFileSync(marker,'utf8'));if(v.schema!==1||v.id!==g.id||v.key!==g.key)throw new Error('下载归组标记不一致。');
 }
 assertOwned(file:string):void {
  const folder=path.dirname(file);if(!MANAGED_DOWNLOAD_DIRECTORY.test(path.basename(folder)))return;
  const key=pathKey(folder),group=this.owned.get(key)??this.read().find(g=>pathKey(g.folder)===key);if(!group)throw new Error('下载归组记录缺失，请重新选择下载位置。');this.validate(group);this.owned.set(key,group);
 }
 reserve(directory:string,provider:'booth'|'baidu',sourceKey:string,label:string,name:string):{file:string;folder:string} {
  filename(name);if(!['booth','baidu'].includes(provider)||typeof sourceKey!=='string'||!sourceKey||sourceKey.length>4096)throw new Error('下载归组来源无效。');
  const root=assertSafeWrite(directory,this.dataDir,[...this.roots(),this.dataDir],true);const stat=fs.lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink()||isWithin(root,this.dataDir))throw new Error('请选择独立的下载保存文件夹。');
  const key=createHash('sha256').update(provider+'\0'+pathKey(root)+'\0'+sourceKey).digest('hex');const groups=this.read();let group=[...groups].reverse().find(g=>g.key===key);
  if(group){this.validate(group);const candidate=path.join(group.folder,name);if(exists(candidate)||exists(candidate+'.part')||this.reserved.has(pathKey(candidate)))group=undefined}
  if(!group){
   const id=randomUUID(),folder=assertSafeWrite(path.join(root,folderLabel(label)+'--vrcal-'+id),this.dataDir,[...this.roots(),this.dataDir],true);
   fs.mkdirSync(folder);const stamp=identity(fs.lstatSync(folder,{bigint:true}));if(stamp.inode==='0'||stamp.birthtime==='0')throw new Error('下载磁盘不支持可靠目录标识。');group={id,key,directory:root,folder,identity:stamp};const marker=assertSafeWrite(path.join(folder,MARKER),this.dataDir,[...this.roots(),this.dataDir],true);fs.writeFileSync(marker,JSON.stringify({schema:1,id,key}),{flag:'wx',mode:0o600});
   const next=[...groups,group];writeOwnedAtomic(this.journal(),JSON.stringify({schema:1,groups:next.slice(-5000)}),this.dataDir,this.roots());
  }
  this.validate(group);const file=assertSafeWrite(path.join(group.folder,name),this.dataDir,[...this.roots(),this.dataDir],true);if(exists(file)||exists(file+'.part')||this.reserved.has(pathKey(file)))throw new Error('下载文件已存在，请重新下载以分配新目录。');this.reserved.add(pathKey(file));this.owned.set(pathKey(group.folder),group);return {file,folder:group.folder};
 }
}
