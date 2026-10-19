import { performance } from 'node:perf_hooks';
import type { TransferProgress } from '../shared/contracts';

/** Application response-body throughput. Request headers and TLS overhead are not measurable here. */
export class TransferMeter {
  private readonly startedAt:number;
  private arrivals:{at:number;bytes:number}[]=[];
  private requestStartedAt?:number;private lastByteAt?:number;
  private state:TransferProgress;
  constructor(url:string,kind:TransferProgress['kind'],label:string,phase:TransferProgress['phase']='connecting',private readonly now:()=>number=()=>performance.now()) {
    this.startedAt=now();
    this.state={url,kind,label,phase,receivedBytes:0,downloadBps:0,uploadBps:0,uploadBytes:0,elapsedMs:0};
  }
  setPhase(phase:TransferProgress['phase']):void {this.state.phase=phase;}
  /** Called immediately before fetch, after rate-limit waiting and URL validation. */
  startRequest():void {this.requestStartedAt=this.now();}
  setTotal(headers:Headers):void {
    const encoding=headers.get('content-encoding')?.trim().toLowerCase(),value=headers.get('content-length');
    // fetch can decode compressed bodies, so a compressed wire length cannot be a body progress total.
    if(encoding&&encoding!=='identity')return;
    if(value&&/^\d+$/.test(value)){const total=Number(value);if(Number.isSafeInteger(total)&&total>=0)this.state.totalBytes=total;}
  }
  received(bytes:number):void {
    if(!Number.isSafeInteger(bytes)||bytes<0)throw new Error('无效的下载字节数');
    this.state.receivedBytes+=bytes;
    if(bytes){const at=this.now();this.lastByteAt=at;this.arrivals.push({at,bytes});}
  }
  completedMetrics():{durationMs?:number;downloadBps?:number} {
    if(this.requestStartedAt===undefined||this.lastByteAt===undefined)return {};
    const durationMs=Math.max(0,this.lastByteAt-this.requestStartedAt);
    return {durationMs,downloadBps:durationMs>0?Math.round(this.state.receivedBytes/(durationMs/1000)):undefined};
  }
  snapshot():TransferProgress {
    const now=this.now(),elapsedMs=Math.max(0,now-this.startedAt);
    this.arrivals=this.arrivals.filter(point=>point.at>now-1000);
    const bytes=this.arrivals.reduce((sum,point)=>sum+point.bytes,0);
    const windowMs=Math.min(1000,elapsedMs);
    const downloadBps=this.state.phase==='downloading'&&windowMs>0?Math.round(bytes/(windowMs/1000)):0;
    return {...this.state,elapsedMs,downloadBps,uploadBps:0,uploadBytes:0};
  }
}
