/** A conservative lower bound for an explicitly displayed relative time, never an exact timestamp. */
export function relativeInboxTime(raw:string,now:number):number|undefined {
 if(typeof raw!=='string'||raw.length>32||!Number.isSafeInteger(now)||now<=0)return;
 const value=raw.trim();let elapsed:number;
 if(value==='刚刚')elapsed=60000;
 else {
  const match=/^(0|[1-9]\d{0,8})(分钟|小时|天)前$/.exec(value);if(!match)return;
  const amount=Number(match[1]),unit=match[2]==='分钟'?60000:match[2]==='小时'?3600000:86400000;
  elapsed=(amount+1)*unit;
 }
 const at=now-elapsed;return Number.isSafeInteger(elapsed)&&Number.isSafeInteger(at)&&at>0?at:undefined;
}
