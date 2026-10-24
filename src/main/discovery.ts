import {randomUUID} from 'node:crypto';
import type {AiService} from './ai-service';
import type {ProductCandidate} from '../shared/contracts';
import type {DiscoveryState,DiscoveryRequest,DiscoveryPlatform,DiscoveryPlan} from '../shared/discovery';
import {discoveryRequest,discoveryUrl,discoveryItem,discoveryImage,localDiscoveryPlan,parseBoothDiscovery,decorateDiscovery} from './discovery-parser';
import {parseWebDiscoveryReply} from './discovery-web';
interface Dependencies {ai:()=>AiService;canNetwork:()=>boolean;xianyuEnabled:()=>boolean;booth:(url:string,signal:AbortSignal)=>Promise<{html:string;url:string}>;xianyu:(query:string,signal:AbortSignal)=>Promise<ProductCandidate[]>;cover:(url:string,signal:AbortSignal)=>Promise<string>}
export class ProductDiscovery {
 private state:DiscoveryState={running:false,notice:'描述你想找的素材，结果来自网站实际商品。',products:[],sources:{}};
 private active?:{id:string;controller:AbortController;ai:AiService};
 constructor(private deps:Dependencies){}
 snapshot():DiscoveryState{return structuredClone(this.state)}
 cancel():void {const task=this.active;if(task){task.controller.abort();task.ai.cancel(task.id);this.active=undefined;this.state.running=false;this.state.notice='已停止，已找到的商品仍可查看。'}}
 start(value:unknown):DiscoveryState {return this.begin(value)}
 startWithWebPlan(value:unknown,reply:unknown):DiscoveryState {const plan=parseWebDiscoveryReply(reply);return this.begin(value,plan)}
 private begin(value:unknown,plan?:DiscoveryPlan):DiscoveryState {
  const request=discoveryRequest(value);if(!this.deps.canNetwork())throw new Error('请先开启联网。');if(request.platforms.includes('xianyu')&&!this.deps.xianyuEnabled())throw new Error('请先在设置中启用闲鱼辅助搜索。');
  this.cancel();const task={id:randomUUID(),controller:new AbortController(),ai:this.deps.ai()};this.active=task;
  this.state={running:true,request,products:[],sources:{},notice:plan?'正在使用你提供的网页 AI 检索词…':'正在整理检索词…'};void this.run(request,task,plan);return this.snapshot();
 }
 product(url:string):{platform:DiscoveryPlatform;url:string}|undefined {const found=this.state.products.find(p=>p.url===url);if(found&&discoveryItem(url,found.platform)===url)return {platform:found.platform,url};}
 searchLink(platform:DiscoveryPlatform):string {const p=this.state.plan;if(!p||!this.state.request?.platforms.includes(platform))throw new Error('请先进行一次搜索。');return discoveryUrl(platform,platform==='booth'?p.boothQueries[0]:p.xianyuQuery);}
 private async run(request:DiscoveryRequest,task:NonNullable<ProductDiscovery['active']>,webPlan?:DiscoveryPlan):Promise<void>{
  const live=()=>this.active===task&&!task.controller.signal.aborted&&this.deps.canNetwork();
  try{
   const result=webPlan?undefined:await task.ai.planSearch(request.description,request.avatar||'',task.id);if(!live())return;
   const plan=webPlan||(result?.ok?result.record.suggestion:localDiscoveryPlan(request));this.state.plan=plan;this.state.method=webPlan?'web-ai':result?.ok?'ai':'local';
   const note=webPlan?'已使用你提供的网页 AI 检索词；商品来自实际搜索页面，回答本身不作为商品或适配证明。':result?.ok?'AI 已整理检索词；商品来自实际搜索页面。':(result?.message||'AI 未启用。')+' 本次使用本地常见词规则，不代表已使用 AI。';this.state.notice=note;
   // Each platform can fail independently. BOOTH page/cover access shares the enrichment limiter and cache.
   for(const platform of request.platforms){
    if(!live())return;this.state.sources[platform]='正在搜索…';
    try{
     const queries=platform==='booth'?plan.boothQueries:[plan.xianyuQuery];let found=0,warning='';
     for(const query of queries){
      if(!live())return;
      try{
       const rows=platform==='booth'?await this.deps.booth(discoveryUrl(platform,query),task.controller.signal).then(p=>parseBoothDiscovery(p.html,p.url)):await this.deps.xianyu(query,task.controller.signal);
       if(!live())return;
       for(const product of rows){
        const url=discoveryItem(product.url,platform);if(!url||this.state.products.some(p=>p.url===url)||found>=12)continue;
        this.state.products.push(decorateDiscovery({...product,url,coverUrl:discoveryImage(product.coverUrl,platform)},platform,query,request,plan));found++;
       }
      }catch(e){if(!live())return;warning=e instanceof Error?e.message:'网页暂时不可用。';break}
      if(found>=12)break;
     }
     this.state.sources[platform]=warning||`已找到 ${found} 件商品${found?'，正在读取封面…':'；可以修改描述或在站内继续搜索。'}`;
     for(const p of this.state.products.filter(p=>p.platform===platform&&p.coverUrl)){
      if(!live())return;
      try{const file=await this.deps.cover(p.coverUrl!,task.controller.signal);if(!live())return;p.coverFile=file}catch{if(!live())return;/* Existing products remain useful when an image fails. */}
     }
     if(!warning&&found)this.state.sources[platform]=`已找到 ${found} 件商品 · 匹配依据来自标题，适配与授权请核对商品页。`;
    }catch(e){if(!live())return;this.state.sources[platform]=e instanceof Error?e.message:'暂时无法读取此网站。'}
   }
   if(live()){this.state.products.sort((a,b)=>b.matchedTerms.length-a.matchedTerms.length);this.state.finishedAt=Date.now();this.state.notice=note;}
  }catch(e){if(live())this.state.notice=e instanceof Error?e.message:'搜索暂时失败。';}
  finally{if(this.active===task){this.state.running=false;this.active=undefined;}}
 }
}
