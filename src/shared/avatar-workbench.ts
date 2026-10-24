import type {ProjectImportJob} from './project-contracts';

export interface ProjectDependencyEvidence {
  id:string;label:string;state:'files-found'|'declared'|'unknown';version?:string;evidence?:string;
}
export interface ProjectReadiness {
  projectId:string;checkedAt:string;unityVersion:string;dependencies:ProjectDependencyEvidence[];notes:string[];
}
export interface ImportCheck {
  id:string;state:'pass'|'warning'|'blocked'|'unknown';title:string;detail:string;
}
export interface ImportReview {appearance?:boolean;movement?:boolean;menu?:boolean;updatedAt?:string}
export type ImportReviewPatch=Partial<Pick<ImportReview,'appearance'|'movement'|'menu'>>;
export interface ImportStage {id:string;title:string;state:'done'|'waiting'|'attention'|'not-requested';detail:string}

export function cleanImportReview(value:unknown):ImportReview|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const input=value as Record<string,unknown>,result:ImportReview={};
  for(const key of ['appearance','movement','menu'] as const)if(typeof input[key]==='boolean')result[key]=input[key];
  if(typeof input.updatedAt==='string'&&Number.isFinite(Date.parse(input.updatedAt)))result.updatedAt=input.updatedAt.slice(0,40);
  return Object.keys(result).length?result:undefined;
}

/** Each stage names its actual evidence; manual checks never imply an SDK build passed. */
export function importStages(job:ProjectImportJob):ImportStage[] {
  const completed=job.state==='completed',ma=job.maSetup;
  const stages:ImportStage[]=[{id:'files',title:'文件导入',state:completed?'done':['failed','cancelled'].includes(job.state)?'attention':'waiting',detail:completed?'文件已交给工程。':job.state==='waiting-unity'?'请在 Unity 确认导入窗口。':job.state==='importing'?'Unity 正在导入，完成后会自动更新。':job.state==='cancelled'?'导入已取消。':job.state==='failed'?'导入未完成，请查看原因。':'正在复制所选文件。'}];
  const requested=ma?.assembly===true,applied=ma?.state==='applied';
  stages.push({id:'assembly',title:'角色装配',state:!requested?'not-requested':applied?'done':ma?.state==='error'||ma?.state==='skipped'?'attention':'waiting',detail:!requested?'此次没有请求骨骼装配。':applied?`已装配到 ${ma?.avatarName||'所选角色'}；效果仍需检查。`:ma?.state==='waiting-import'?'等待文件导入完成。':ma?.state==='skipped'?'已跳过装配。':ma?.state==='error'?'需要在 Unity 处理装配问题。':'有多个候选或缺少条件时，请到 Unity 选择。'});
  const menuRequested=!!ma&&(!requested||ma.menuWithAssembly===true);
  stages.push({id:'menu',title:'游戏内菜单',state:!menuRequested?'not-requested':applied?'done':ma?.state==='error'||ma?.state==='skipped'?'attention':'waiting',detail:!menuRequested?'未额外配置；素材原有预设按原样保留。':applied?ma?.menuMode==='preserved'?'保留作者已有 MA 菜单，请检查其入口。':ma?.menuMode==='created'?'已创建显隐开关；游戏内同步仍需测试。':'Unity 已返回菜单配置回执。':'等待菜单配置回执。'});
  const checks=job.review,required=menuRequested?['appearance','movement','menu'] as const:['appearance','movement'] as const,reviewed=required.every(k=>checks?.[k]===true);
  stages.push({id:'review',title:'效果检查',state:completed&&reviewed?'done':'waiting',detail:completed&&reviewed?'由你标记已检查，不代表 SDK 构建或上传验证。':'请检查外观、动作，以及需要的菜单切换；不会自动判定穿模或同步正确。'});
  return stages;
}
