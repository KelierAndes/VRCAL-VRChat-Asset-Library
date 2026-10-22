import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertSafeWrite} from './safety';
import {communityUrl} from '../shared/community';
import {STAR_MILESTONES,type StarInvite,type StarMilestone} from '../shared/star-invite';

interface Usage {version:1;count:number;notified:StarMilestone[]}
interface Dependencies {dataDir:()=>string;roots:()=>string[];openExternal:(url:string)=>Promise<unknown>}
const stale=()=>new Error('启动提示已处理，请重新打开应用后再查看。');

/** Local-only app usage. Kept outside database backups so restoring annotations cannot rewind invitations. */
export class LaunchInvites {
 private started=false;
 private invite:StarInvite|null=null;
 private opening?:Promise<void>;
 constructor(private readonly deps:Dependencies){}
 private file():string {const directory=this.deps.dataDir();return assertSafeWrite(path.join(directory,'app-usage.json'),directory,this.deps.roots())}
 private existing(file:string):void {const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>4096)throw Error('Invalid usage file');}
 private read(file:string):Usage {
  if(!fs.existsSync(file))return {version:1,count:0,notified:[]};
  this.existing(file);const value=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!value||value.version!==1||!Number.isSafeInteger(value.count)||value.count<0||!Array.isArray(value.notified)||value.notified.length>STAR_MILESTONES.length||new Set(value.notified).size!==value.notified.length||value.notified.some((n:unknown)=>!STAR_MILESTONES.includes(n as StarMilestone)||Number(n)>value.count))throw Error('Invalid usage record');
  return {version:1,count:value.count,notified:value.notified};
 }
 private write(file:string,value:Usage):void {
  const directory=this.deps.dataDir(),roots=this.deps.roots(),temporary=assertSafeWrite(path.join(directory,'app-usage-'+randomUUID()+'.tmp'),directory,roots);
  fs.mkdirSync(path.dirname(file),{recursive:true});let created=false;
  try{fs.writeFileSync(temporary,JSON.stringify(value),{flag:'wx'});created=true;assertSafeWrite(file,directory,roots);if(fs.existsSync(file))this.existing(file);fs.renameSync(temporary,file);created=false}
  finally{if(created)try{fs.unlinkSync(assertSafeWrite(temporary,directory,roots))}catch{/* Never make a reminder failure prevent the library from opening. */}}
 }
 start():StarInvite|null {
  if(this.started)return this.invite;this.started=true;
  try{
   const file=this.file(),value=this.read(file);value.count=Math.min(Number.MAX_SAFE_INTEGER,value.count+1);
   const count=STAR_MILESTONES.find(n=>n===value.count&&!value.notified.includes(n));
   if(count)value.notified.push(count);
   this.write(file,value);
   if(count)this.invite={count,projectUrl:communityUrl('source')};
  }catch{/* Corrupt, protected or unavailable usage data is left alone; core features remain usable. */}
  return this.invite;
 }
 dismiss(count:unknown):void {if(this.invite?.count!==count||this.opening)throw stale();this.invite=null;}
 open(count:unknown):Promise<void> {
  if(!this.invite||this.invite.count!==count)return Promise.reject(stale());
  if(this.opening)return this.opening;
  // Set the lock before invoking Electron, including a synchronously throwing adapter.
  let resolve!:()=>void,reject!:(error:unknown)=>void;
  const pending=new Promise<void>((ok,fail)=>{resolve=ok;reject=fail});this.opening=pending;
  try{Promise.resolve(this.deps.openExternal(communityUrl('source'))).then(()=>{this.opening=undefined;this.invite=null;resolve()},error=>{this.opening=undefined;reject(error)})}
  catch(error){this.opening=undefined;reject(error)}
  return pending;
 }
}
