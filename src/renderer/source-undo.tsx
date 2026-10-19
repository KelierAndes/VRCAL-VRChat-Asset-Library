import React, { useState } from 'react';
import type { LibraryAPI, Snapshot } from '../shared/contracts';

type Runner=(action:()=>Promise<unknown>,message?:string)=>Promise<boolean>;
export function SourceUndo({record,api,run,compact=false}:{record?:Snapshot['sourceUndo'];api:LibraryAPI;run:Runner;compact?:boolean}) {
  const [pending,setPending]=useState(false);
  if(!record)return null;
  const undo=async()=>{if(pending)return;setPending(true);await run(async()=>{if(!await api.undoSource(record.token))throw new Error('这条来源撤回记录已经使用或已失效，请查看最新记录。')},`已撤回「${record.title}」的来源`);setPending(false)};
  const button=<button className={`button small source-undo-button ${compact?'compact':''}`} aria-label={`撤回来源：${record.title}`} title={`撤回「${record.title}」的上一次来源确认，恢复之前的来源和候选；你的其他标注保留。`} disabled={pending} onClick={()=>void undo()}>↶ <span>{pending?'正在撤回…':'撤回来源'}</span>{compact&&<small>{record.title}</small>}</button>;
  return compact?button:<div className="source-undo-banner" role="status"><div><strong>刚刚确认的来源</strong><span title={record.title}>{record.title}</span><small title={record.sourceUrl}>{record.sourceUrl}</small></div>{button}</div>;
}
