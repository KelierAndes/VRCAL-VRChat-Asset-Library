import { t, useLanguage, localeName } from './i18n';
import React, { useState } from 'react';
import type { LibraryAPI, Snapshot } from '../shared/contracts';

type Runner=(action:()=>Promise<unknown>,message?:string)=>Promise<boolean>;
export function SourceUndo({record,api,run,compact=false}:{record?:Snapshot['sourceUndo'];api:LibraryAPI;run:Runner;compact?:boolean}) {
  useLanguage();
  const [pending,setPending]=useState(false);
  if(!record)return null;
  const undo=async()=>{if(pending)return;setPending(true);await run(async()=>{if(!await api.undoSource(record.token))throw new Error(t("这条来源撤回记录已经使用或已失效，请查看最新记录。"))},t("已撤回「{v0}」的来源", {v0: record.title}));setPending(false)};
  const button=<button className={`button small source-undo-button ${compact?'compact':''}`} aria-label={t("撤回来源：{v0}", {v0: record.title})} title={t("撤回「{v0}」的上一次来源确认，恢复之前的来源和候选；你的其他标注保留。", {v0: record.title})} disabled={pending} onClick={()=>void undo()}>↶ <span>{pending?t("正在撤回…"):t("撤回来源")}</span>{compact&&<small>{record.title}</small>}</button>;
  return compact?button:<div className="source-undo-banner" role="status"><div><strong>{t("刚刚确认的来源")}</strong><span title={record.title}>{record.title}</span><small title={record.sourceUrl}>{record.sourceUrl}</small></div>{button}</div>;
}
