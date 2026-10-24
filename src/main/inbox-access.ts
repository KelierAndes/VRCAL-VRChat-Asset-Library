import {validateInboxSettings,type InboxSettings} from '../shared/link-inbox';
import {INBOX_POLICY_VERSION,validInboxConsent,type InboxConsent} from '../shared/inbox-policy';
interface Deps {settings:()=>InboxSettings;consent:()=>InboxConsent|undefined;save:(settings:InboxSettings,consent?:InboxConsent)=>void;confirm:(background:boolean)=>Promise<boolean>;available:()=>boolean}
/** Renderer settings cannot substitute for a main-process consent dialog. */
export class InboxAccess {
 private revision=0;private pending?:{key:string;promise:Promise<void>};
 constructor(private readonly deps:Deps){}
 invalidate(){++this.revision;this.pending=undefined}
 async configure(value:unknown):Promise<void>{
  const next=validateInboxSettings(value),before=this.deps.settings();
  if(!next.enabled){this.invalidate();this.deps.save(next);return}
  const needsNotice=!before.enabled||!validInboxConsent(this.deps.consent(),next.background)||next.background&&!before.background;
  if(!needsNotice){this.invalidate();if(this.deps.available())this.deps.save(next);return}
  const key=JSON.stringify(next);if(this.pending?.key===key)return this.pending.promise;
  const revision=++this.revision,promise=(async()=>{const accepted=await this.deps.confirm(next.background);if(accepted===true&&revision===this.revision&&this.deps.available())this.deps.save(next,{version:INBOX_POLICY_VERSION,acceptedAt:Date.now(),scope:next.background?'background':'foreground'})})();
  this.pending={key,promise};try{await promise}finally{if(this.pending?.promise===promise)this.pending=undefined}
 }
}
