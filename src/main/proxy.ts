import { performance } from 'node:perf_hooks';
import type { ProxyStatus, QueueProgress } from '../shared/contracts';

const TARGET='https://booth.pm/';
type Fetch=(url:string,init?:RequestInit)=>Promise<Response>;
export interface ProxyDependencies {
  resolveProxy:(url:string)=>Promise<string>;fetch:Fetch;
  onChange?:(status:ProxyStatus)=>void;onStatus?:(status:ProxyStatus)=>void;
  /** Test overrides cannot shorten production cooldown or timeout. */
  testing?:{timeoutMs?:number;cooldownMs?:number;now?:()=>number};
}

/** Chromium PAC syntax, with credentials discarded before anything reaches the UI. */
export function proxyRoute(raw:string):Pick<ProxyStatus,'mode'|'route'|'endpoint'> {
  const routes:string[]=[];let endpoint:string|undefined,first:'direct'|'proxy'|undefined;
  for(const part of raw.split(';').slice(0,12)){
    const match=part.trim().match(/^(DIRECT|PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)(?:\s+(.+))?$/i);if(!match)continue;
    const kind=match[1].toUpperCase();
    if(kind==='DIRECT'){first??='direct';routes.push('DIRECT');continue;}
    if(!match[2])continue;
    try {
      const address=match[2].replace(/^[a-z][\w+.-]*:\/\//i,''),url=new URL(`http://${address}`);
      const explicitPort=address.match(/:(\d{1,5})\/?$/)?.[1],port=explicitPort?Number(explicitPort):0;
      if(!url.hostname||port<1||port>65535||url.pathname!=='/'||url.search||url.hash)continue;
      const host=url.hostname.toLowerCase(),safe=`${host}:${port}`;
      if(!first){first='proxy';endpoint=safe;}routes.push(`${kind} ${safe}`);
    }catch{/* Unknown or malformed rules are never echoed, because they can contain credentials. */}
  }
  return first?{mode:first,route:routes.join(' ; '),endpoint}:{mode:'unknown',route:'无法识别当前网络路线'};
}

export class ProxyMonitor {
  private value:ProxyStatus={mode:'unknown',route:'尚未读取网络路线',status:'unchecked'};
  private enabled=true;private generation=0;private lastProbe=-Infinity;private inFlight?:Promise<ProxyStatus>;private abort?:AbortController;private observed='';
  private downloadEvidence?:{sequence:number;checkedAt:string};private evidenceSequence=0;
  private readonly now:()=>number;private readonly timeout:number;private readonly cooldown:number;
  constructor(private readonly deps:ProxyDependencies){
    const testing=process.env.NODE_ENV==='test'?deps.testing:undefined;
    this.now=testing?.now??(()=>performance.now());this.timeout=testing?.timeoutMs??10000;this.cooldown=testing?.cooldownMs??30000;
  }
  get status():ProxyStatus{return {...this.value};}
  private publish(patch:Partial<ProxyStatus>):ProxyStatus {this.value={...this.value,...patch};const status=this.status;this.deps.onChange?.(status);this.deps.onStatus?.(status);return status;}
  setEnabled(enabled:boolean):void {
    if(this.enabled===enabled)return;this.enabled=enabled;this.generation++;
    if(!enabled){this.abort?.abort();this.publish({status:'disabled',message:'联网已关闭；没有进行网络检测'});}
    else this.publish({status:'unchecked',message:'已开启联网，可检测当前网络路线'});
  }
  async inspect():Promise<ProxyStatus> {
    if(!this.enabled)return this.status;const generation=this.generation;
    try{
      const route=proxyRoute(await this.deps.resolveProxy(TARGET));if(generation!==this.generation)return this.status;
      return this.publish({...route,status:'unchecked',message:route.mode==='proxy'?'检测到代理设置；尚未验证是否能访问 BOOTH':route.mode==='direct'?'BOOTH 使用直连；尚未验证连通性':'未能识别网络路线，可检测 BOOTH 连通性'});
    }catch{
      if(generation!==this.generation)return this.status;
      return this.publish({mode:'unknown',route:'无法读取当前网络路线',endpoint:undefined,status:'error',message:'读取代理设置失败；没有更改系统配置'});
    }
  }
  async check():Promise<ProxyStatus> {
    if(!this.enabled)return this.status;if(this.inFlight)return this.inFlight;
    if(this.now()-this.lastProbe<this.cooldown)return this.status;
    this.lastProbe=this.now();const check=this.probe();this.inFlight=check;
    try{return await check;}finally{if(this.inFlight===check)this.inFlight=undefined;}
  }
  private async probe():Promise<ProxyStatus> {
    const generation=this.generation,evidenceAtStart=this.evidenceSequence;await this.inspect();if(!this.enabled||generation!==this.generation)return this.status;
    this.publish({status:'checking',message:'正在使用当前网络路线连接 BOOTH…'});
    const controller=new AbortController();this.abort=controller;let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const fetch=this.deps.fetch(TARGET,{method:'HEAD',redirect:'manual',credentials:'omit',signal:controller.signal,headers:{'User-Agent':'VRChatAssetLibrary/1.1 (+local personal catalog)','Accept':'text/html'}}).then(async response=>{if(controller.signal.aborted){await response.body?.cancel();throw new Error('检测已中止');}return response;});
      const response=await Promise.race([fetch,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('检测超时'));},this.timeout);})]);
      await response.body?.cancel();if(!this.enabled||generation!==this.generation)return this.status;
      const restricted=[401,403,429].includes(response.status),success=response.status>=200&&response.status<400;
      const message=restricted?`已连接 BOOTH，但网站访问受限（HTTP ${response.status}）；不能据此判断代理失联`:success?'当前网络路线可以连接 BOOTH':`已连接 BOOTH，网站返回 HTTP ${response.status}；请查看来源网页`;
      return this.publish({status:'available',checkedAt:new Date().toISOString(),message});
    }catch{
      if(!this.enabled||generation!==this.generation)return this.status;
      if(this.downloadEvidence&&this.downloadEvidence.sequence>evidenceAtStart)return this.publish({status:'available',checkedAt:this.downloadEvidence.checkedAt,message:'实际商品下载成功，独立连接检测未成功'});
      return this.publish({status:'error',checkedAt:new Date().toISOString(),message:'网站或连接检测失败／超时，暂不能判断是代理、网络还是 BOOTH 的问题'});
    }finally{if(timer)clearTimeout(timer);if(this.abort===controller)this.abort=undefined;}
  }
  observeTransfer(progress:QueueProgress):void {
    if(!this.enabled)return;
    const transfer=progress.transfer,latest=progress.recentTransfers?.[0];if(!transfer||!latest||latest.url!==transfer.url||latest.fromCache)return;
    const key=`${latest.finishedAt}|${latest.url}|${latest.status}|${latest.receivedBytes}`;if(this.observed===key)return;
    if(transfer.phase==='complete'&&latest.status==='complete'&&latest.receivedBytes>0){this.observed=key;this.downloadEvidence={sequence:++this.evidenceSequence,checkedAt:latest.finishedAt};if(!this.inFlight)this.publish({status:'available',checkedAt:latest.finishedAt,message:'已通过实际联网下载确认当前网络路线可用'});}
    else if(transfer.phase==='error'&&latest.status==='error'){this.observed=key;if(!this.inFlight)this.publish({status:'error',checkedAt:latest.finishedAt,message:'商品或连接读取失败；可检测网络，不能据此判断代理失联'});}
  }
}
