import type {UnityDiagnosticAdvice} from '../shared/unity-diagnostics';

export interface UnityDiagnosisAttempt {
  inFlight:boolean;
  retries:number;
  nextAttemptAt?:number;
  advice?:UnityDiagnosticAdvice;
  error?:string;
  code?:string;
}
/** Bounded renderer-session memory; it stores suggestions, never keys or raw log contents. */
export class UnityDiagnosisSession {
  private readonly entries=new Map<string,UnityDiagnosisAttempt>();
  private readonly now:()=>number;
  private readonly capacity:number;
  constructor(options:{now?:()=>number;capacity?:number}={}){
    this.now=options.now??Date.now;
    this.capacity=Math.max(1,Math.min(1000,Math.floor(options.capacity??200)));
  }
  get(key:string):UnityDiagnosisAttempt|undefined {const entry=this.entries.get(key);return entry?structuredClone(entry):undefined;}
  /** Undefined means complete, terminal failure, or already in flight. New errors first settle for 2s. */
  delay(key:string):number|undefined {
    const entry=this.entries.get(key);
    if(!entry)return 2000;
    if(entry.inFlight||entry.advice||entry.nextAttemptAt===undefined)return undefined;
    return Math.max(0,entry.nextAttemptAt-this.now());
  }
  async run(key:string,operation:()=>Promise<UnityDiagnosticAdvice>,options:{manual?:boolean}={}):Promise<UnityDiagnosisAttempt|undefined> {
    const previous=this.entries.get(key);
    if(previous?.inFlight)return this.get(key);
    if(previous&&!options.manual&&(previous.advice||previous.nextAttemptAt===undefined||previous.nextAttemptAt>this.now()))return this.get(key);
    if(!previous&&this.entries.size>=this.capacity){
      const oldest=[...this.entries].find(([,entry])=>!entry.inFlight)?.[0];
      if(oldest===undefined)return undefined;
      this.entries.delete(oldest);
    }
    const entry:UnityDiagnosisAttempt={inFlight:true,retries:options.manual?0:previous?.retries??0};
    this.entries.set(key,entry);
    try {entry.advice=structuredClone(await operation());}
    catch(error){
      entry.error=(error instanceof Error?error.message:String(error)).replace(/^Error invoking remote method '[^']+': Error: /,'').slice(0,1000);
      const code=error&&typeof error==='object'?(error as {code?:unknown}).code:undefined;
      if(typeof code==='string')entry.code=code.slice(0,60);
      // Provider/network/format failures can have been billed. Only these transient control states retry.
      if(['busy','rate-limit','cancelled'].includes(entry.code??'')&&entry.retries<3){entry.retries++;entry.nextAttemptAt=this.now()+30000;}
    }finally{entry.inFlight=false;}
    return this.get(key);
  }
}
