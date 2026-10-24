import React,{useState} from 'react';
import type {LibraryAPI} from '../shared/contracts';
import type {ProjectImportJob} from '../shared/project-contracts';
import {importStages,type ImportReviewPatch} from '../shared/avatar-workbench';

export function ImportProgress({job,api,onRefresh,onError}:{job:ProjectImportJob;api:LibraryAPI;onRefresh:()=>void;onError:(message:string)=>void}){
 const [saving,setSaving]=useState(false);
 const save=async(patch:ImportReviewPatch)=>{setSaving(true);try{await api.reviewProjectImport(job.id,patch);onRefresh()}catch(e){onError(e instanceof Error?e.message:String(e))}finally{setSaving(false)}};
 return <div className="import-progress"><ol className="import-stages" aria-label="导入与装配进度">{importStages(job).map(stage=><li key={stage.id} data-stage={stage.id} data-state={stage.state}><span className="stage-indicator" aria-label={stage.state==='done'?'已完成':stage.state==='attention'?'需要处理':stage.state==='not-requested'?'未请求':'待完成'}>{stage.state==='done'?'✓':stage.state==='attention'?'!':stage.state==='not-requested'?'—':'·'}</span><div><strong>{stage.title}</strong><small>{stage.detail}</small></div></li>)}</ol>
 {job.state==='completed'&&<details className="import-user-review"><summary>记录我的效果检查{job.review?.updatedAt?' · 已保存':''}</summary><p className="help-text">在 Unity 或游戏中实际检查后再勾选。这是你的检查记录，不会被当作自动适配或 SDK 构建通过。</p><div>{([['appearance','外观与身体遮挡正常'],['movement','抬手、蹲下等动作正常'],['menu','菜单切换与同步正常']] as const).map(([key,label])=><label key={key}><input type="checkbox" checked={job.review?.[key]===true} disabled={saving} onChange={e=>save({[key]:e.target.checked})}/>{label}</label>)}</div>{job.review?.updatedAt&&<small>上次记录：{new Date(job.review.updatedAt).toLocaleString()}</small>}</details>}
 </div>;
}
