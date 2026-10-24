import type {InboxObservation,InboxPlatform,InboxSettings,InboxStatus} from '../shared/link-inbox';

export interface InboxReadContext {now:number;hours:6|12|24}
export interface InboxReadResult {observations:InboxObservation[];state:InboxStatus['state'];message:string}
export interface InboxReader {platform:InboxPlatform;read:(mode:'foreground'|'background',signal:AbortSignal,context:InboxReadContext)=>Promise<InboxReadResult>}
interface Deps {settings:()=>InboxSettings;canNetwork:()=>boolean;readers:InboxReader[];ingest:(observation:InboxObservation)=>void;changed:()=>void;now?:()=>number;readTimeoutMs?:number}
/** Foreground checks only observe an already-open page. Network navigation is limited to the three-minute background pass. */
export class LinkInboxMonitor {
 private timer?:ReturnType<typeof setTimeout>;private abort?:AbortController;private busy=false;private closed=false;private lastBackground=0;
 private states=new Map<InboxPlatform,InboxStatus>();private retries=new Map<InboxPlatform,{at:number;failures:number}>();
 constructor(private readonly deps:Deps){for(const reader of deps.readers)this.states.set(reader.platform,{platform:reader.platform,state:'paused',message:'识别尚未开启。'})}
 private now(){return this.deps.now?.()??Date.now()}
 statuses():InboxStatus[]{return [...this.states.values()].map(s=>({...s}))}
 start(){if(this.closed||this.timer)return;this.timer=setTimeout(()=>{this.timer=undefined;const background=this.deps.settings().background&&this.now()-this.lastBackground>=180000;void this.check(background?'background':'foreground').finally(()=>this.start())},30000);this.timer.unref?.()}
 pause(){this.abort?.abort();for(const [platform,status] of this.states)this.states.set(platform,{...status,state:'paused',message:'已暂停检查。'});this.deps.changed()}
 stop(){this.closed=true;this.pause();if(this.timer)clearTimeout(this.timer);this.timer=undefined}
 async check(mode:'foreground'|'background'){
  const settings=this.deps.settings();if(this.closed||this.busy||!settings.enabled||!this.deps.canNetwork()||mode==='background'&&!settings.background)return;
  this.busy=true;const controller=this.abort=new AbortController();if(mode==='background')this.lastBackground=this.now();
  const active=()=>!this.closed&&!controller.signal.aborted&&this.deps.canNetwork()&&this.deps.settings().enabled&&(mode==='foreground'||this.deps.settings().background);
  try{for(const reader of this.deps.readers){if(!active())break;const retry=this.retries.get(reader.platform);if(retry&&retry.at>this.now())continue;
   this.states.set(reader.platform,{platform:reader.platform,state:'checking',message:'正在检查近期交付链接…'});this.deps.changed();
   const local=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,abortListener:(()=>void)|undefined;
   try{
    const cancelled=new Promise<never>((_,reject)=>{abortListener=()=>{local.abort();reject(new Error('cancelled'))};controller.signal.addEventListener('abort',abortListener,{once:true});if(controller.signal.aborted)abortListener()});
    const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{local.abort();reject(new Error('timeout'))},this.deps.readTimeoutMs??45000);timer.unref?.()});
    const result=await Promise.race([reader.read(mode,local.signal,{now:this.now(),hours:settings.hours}),cancelled,timeout]);
    if(!active())break;
    if(!result||!['paused','login','ready','unsupported','error'].includes(result.state)||typeof result.message!=='string'||!Array.isArray(result.observations)||result.observations.length>300||result.observations.some(o=>!o||o.platform!==reader.platform))throw new Error('invalid capture');
    // A logged-out, unknown or unsupported page never supplies data to the library.
    if(result.state==='ready')for(const observation of result.observations){if(!active())break;this.deps.ingest(observation)}
    this.states.set(reader.platform,{platform:reader.platform,state:result.state,message:result.message.slice(0,200),checkedAt:this.now()});this.retries.delete(reader.platform);
   }catch{if(active()){const failures=Math.min(5,(retry?.failures??0)+1);this.retries.set(reader.platform,{failures,at:this.now()+180000*2**failures});this.states.set(reader.platform,{platform:reader.platform,state:'error',message:'检查暂未完成，已延后重试；请查看账号登录及页面验证状态。',checkedAt:this.now()})}}
   finally{local.abort();if(timer)clearTimeout(timer);if(abortListener)controller.signal.removeEventListener('abort',abortListener);if(!this.closed)this.deps.changed()}
  }}finally{this.busy=false;if(this.abort===controller)this.abort=undefined}
 }
}
