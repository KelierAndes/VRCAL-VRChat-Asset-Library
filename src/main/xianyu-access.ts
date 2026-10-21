export const XIANYU_USAGE_NOTICE={
 title:'闲鱼辅助搜索 · 免责声明与使用提醒',
 message:'仅用于辅助搜索，不可用于购买。',
 detail:'闲鱼搜索结果仅作为图片、商品名称的检索线索，不代表正版来源、授权或商品真实性。\n请核对原作者与授权；存在 BOOTH 原作页面时，优先回原作者页面确认。\n\n本应用不提供闲鱼下单、支付或交易服务。'
} as const;

interface XianyuAccessDependencies {
 enabled:()=>boolean;save:(enabled:boolean)=>void;confirm:()=>Promise<boolean>;
 close:()=>void;changed:()=>void;available:()=>boolean;
}
/** Only an explicit acceptance can turn a hidden optional tool on. */
export class XianyuAccess {
 private revision=0;private pending?:Promise<boolean>;
 constructor(private readonly deps:XianyuAccessDependencies){}
 async setEnabled(value:unknown):Promise<boolean> {
  if(typeof value!=='boolean')throw new Error('闲鱼辅助搜索设置无效。');
  if(!value){this.revision++;this.deps.save(false);this.deps.close();this.deps.changed();return false}
  if(this.deps.enabled())return true;
  if(this.pending)return this.pending;
  const revision=this.revision,pending=(async()=>{
   const accepted=await this.deps.confirm();
   if(accepted===true&&revision===this.revision&&this.deps.available()){this.deps.save(true);this.deps.changed()}
   return this.deps.enabled();
  })();
  this.pending=pending;try{return await pending}finally{if(this.pending===pending)this.pending=undefined}
 }
}
