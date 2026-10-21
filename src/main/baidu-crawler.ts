import type {BaiduScanState} from '../shared/cloud-contracts';
import {cloudPath,type BaiduDirectoryCapture} from './baidu-page';

interface Task {schema:1;accountKey:string;root:string;phase:BaiduScanState['phase'];pending:string[];done:string[];files:string[];failures:{path:string;reason:string}[];error?:string}
interface Dependencies {
 identity:()=>Promise<string|undefined>;
 readDirectory:(path:string,accept:(capture:BaiduDirectoryCapture)=>Promise<void>,check:()=>void)=>Promise<void>;
 commit:(capture:BaiduDirectoryCapture)=>Promise<void>;
 load?:()=>unknown;save:(task:unknown)=>void;onChanged:()=>void;
}
class Interrupted extends Error {}
const within=(path:string,root:string)=>path===root||path.startsWith(root==='/'?'/':root+'/');
const empty=():Task=>({schema:1,accountKey:'',root:'',phase:'idle',pending:[],done:[],files:[],failures:[]});

/** Serial metadata traversal. Only the driver operates the ordinary official webpage. */
export class BaiduCrawler {
 private task:Task=empty();private running?:Promise<void>;private requested?:'paused'|'stopped';
 constructor(private readonly deps:Dependencies){
  try{
   const data=deps.load?.() as Task|undefined;if(!data)return;
   if(data.schema!==1||!/^baidu:[a-f0-9]{64}$/.test(data.accountKey)||!['running','paused','completed','stopped'].includes(data.phase))throw new Error();
   cloudPath(data.root);
   for(const paths of [data.pending,data.done,data.files])if(!Array.isArray(paths)||paths.length>50000||paths.some(p=>cloudPath(p)!==p||!within(p,data.root))||new Set(paths).size!==paths.length)throw new Error();
   if(data.pending.length+data.done.length>2000||!Array.isArray(data.failures)||data.failures.length>2000||data.failures.some(f=>cloudPath(f.path)!==f.path||!within(f.path,data.root)))throw new Error();
   this.task={schema:1,accountKey:data.accountKey,root:data.root,phase:data.phase==='running'?'paused':data.phase,pending:[...data.pending],done:[...data.done],files:[...data.files],failures:data.failures.map(f=>({path:f.path,reason:String(f.reason).slice(0,100)}))};
  }catch{this.task=empty()}
 }
 state():BaiduScanState {const t=this.task;return {phase:t.phase,rootPath:t.root,currentPath:t.pending[0]??'',directoriesRead:t.done.length,directoriesPending:t.pending.length,filesRead:t.files.length,failedDirectories:t.failures.length,failures:structuredClone(t.failures.slice(-20)),...(t.error?{error:t.error}:{})}}
 async start(root:string):Promise<void>{if(this.running)throw new Error('baidu-scan-busy');cloudPath(root);const accountKey=await this.deps.identity();if(!accountKey)throw new Error('baidu-login-identity-required');this.task={...empty(),accountKey,root,pending:[root],phase:'running'};this.requested=undefined;this.publish();this.kick()}
 pause():void {if(this.task.phase==='running'){this.requested='paused';this.task.phase='paused';try{this.publish()}catch{/* In-memory pause still applies if the disk is full. */}}}
 stop():void {this.requested='stopped';if(this.task.phase!=='idle'){this.task.phase='stopped';try{this.publish()}catch{/* Keep the stop request even when task persistence fails. */}}}
 async resume():Promise<void>{await this.waitIdle();if(!['paused','stopped'].includes(this.task.phase)||!this.task.pending.length)return;await this.sameAccount();this.task.phase='running';this.task.error=undefined;this.requested=undefined;this.publish();this.kick()}
 async retry():Promise<void>{await this.waitIdle();if(!this.task.failures.length)return;await this.sameAccount();this.task.pending=[...new Set([...this.task.pending,...this.task.failures.map(f=>f.path)])];this.task.failures=[];this.task.phase='running';this.task.error=undefined;this.requested=undefined;this.publish();this.kick()}
 async waitIdle():Promise<void>{await this.running}
 private check=()=>{if(this.requested)throw new Interrupted(this.requested)};
 private async sameAccount(){if(await this.deps.identity()!==this.task.accountKey)throw new Interrupted('baidu-account-or-page-changed')}
 private publish(){try{this.deps.save(structuredClone(this.task))}catch{this.task.phase='paused';this.task.error='baidu-task-save-failed';this.requested='paused';this.deps.onChanged();throw new Interrupted('baidu-task-save-failed')}this.deps.onChanged()}
 private kick(){this.running=this.run().catch(error=>{this.task.phase=this.requested??'paused';this.task.error=error instanceof Error?error.message:'baidu-scan-failed';try{this.publish()}catch{this.deps.onChanged()}}).finally(()=>{this.running=undefined})}
 private async run(){
  while(this.task.pending.length){
   this.check();await this.sameAccount();const path=this.task.pending[0];
   try{
    await this.deps.readDirectory(path,async capture=>{
     this.check();await this.sameAccount();
     if(capture.accountKey!==this.task.accountKey||capture.directoryPath!==path||!within(path,this.task.root))throw new Error('baidu-out-of-scope');
     for(const item of capture.items)if(cloudPath(item.path)!==(path==='/'?'':path)+'/'+item.name||!within(item.path,this.task.root))throw new Error('baidu-out-of-scope');
     const files=new Set(this.task.files),directories=new Set([...this.task.pending,...this.task.done,...this.task.failures.map(f=>f.path)]);
     for(const item of capture.items){if(item.directory)directories.add(item.path);else files.add(item.path)}
     if(files.size>50000||directories.size>2000)throw new Interrupted('baidu-scan-limit');
     await this.deps.commit(capture);this.check();await this.sameAccount();
     this.task.files=[...files];for(const item of capture.items)if(item.directory&&!this.task.pending.includes(item.path)&&!this.task.done.includes(item.path)&&!this.task.failures.some(f=>f.path===item.path))this.task.pending.push(item.path);
     this.publish();
    },this.check);
    this.check();await this.sameAccount();this.task.pending.shift();this.task.done.push(path);
   }catch(error){
    if(error instanceof Interrupted||error instanceof Error&&/baidu-(?:account-or-page-changed|offline|scan-limit|page-changed)/.test(error.message))throw error;
    this.task.pending.shift();this.task.failures.push({path,reason:error instanceof Error?error.message.slice(0,100):'baidu-scan-failed'});
   }
   this.publish();
  }
  this.check();this.task.phase='completed';this.publish();
 }
}
