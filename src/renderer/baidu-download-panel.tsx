import React,{useEffect,useState} from 'react';
import type {LibraryAPI} from '../shared/contracts';
import type {BaiduDownloadState} from '../shared/baidu-download';
import {t,useLanguage} from './i18n';
import './baidu-download-panel.css';

const bytes=(n:number)=>n>=1024**3?(n/1024**3).toFixed(1)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';
const status={downloading:'正在下载',paused:'已暂停',completed:'下载完成',interrupted:'下载中断',cancelled:'已取消'};
export function BaiduDownloadPanel({api,enabled}:{api:LibraryAPI;enabled:boolean}){
 useLanguage();const [state,setState]=useState<BaiduDownloadState>(),[text,setText]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Set<string>>(new Set());
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const value=await api.baiduDownloadsState();if(active)setState(value)}catch(e){if(active)setError(String(e))}finally{if(active)timer=setTimeout(poll,1000)}};void poll();return()=>{active=false;clearTimeout(timer)}},[api]);
 const act=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');try{await action()}catch(e){setError((e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method '[^']+': Error: /,''))}finally{try{setState(await api.baiduDownloadsState())}catch{}setBusy(false)}};
 const locked=busy||state?.busy||!enabled||!state?.loggedIn;
 const files=(state?.files??[]).filter(file=>!file.directory),scope=files.map(file=>file.id).join('|');
 useEffect(()=>{const valid=new Set(scope.split('|'));setSelected(previous=>new Set([...previous].filter(id=>valid.has(id))))},[scope]);
 const downloadFile=(id:string)=>act(async()=>{
  const current=await api.baiduDownloadsState();
  if(!current.downloadDir&&!await api.chooseBaiduDownloadDir())return;
  await api.downloadBaiduFile(id);
 });
 const downloadSelected=()=>act(async()=>{const current=await api.baiduDownloadsState();if(!current.downloadDir&&!await api.chooseBaiduDownloadDir())return;await api.downloadBaiduFiles([...selected]);setSelected(new Set())});
 return <section className="baidu-download-panel" aria-label={t('百度网盘链接下载')}>
  <div className="baidu-download-heading"><div><h3>{t('百度网盘链接下载')}</h3><p>{t('登录后，在本页粘贴链接、选择文件并查看下载进度。')}</p></div><span className="tiny-pill">{state?.loggedIn?t('百度账号已登录'):t('请先登录百度账号')}</span></div>
  {!state?.loggedIn&&<div className="baidu-login-first"><strong>{t('第一步：登录百度账号')}</strong><p>{t('仅登录和验证在官方窗口完成；文件列表和下载操作都在本应用页面中。')}</p><button className="button primary" disabled={busy||!enabled} onClick={()=>act(()=>api.openBaidu())}>{t('登录百度账号')}</button></div>}
  <form onSubmit={e=>{e.preventDefault();void act(()=>api.readBaiduShare(text,code))}}>
   <label>{t('分享链接或整段分享文字')}<textarea rows={2} maxLength={8192} value={text} onChange={e=>setText(e.target.value)} placeholder={t('粘贴百度网盘分享链接，可包含提取码')} disabled={locked}/></label>
   <div className="baidu-download-actions"><label>{t('提取码（链接已有可留空）')}<input value={code} onChange={e=>setCode(e.target.value)} maxLength={4} autoComplete="off" disabled={locked}/></label><button className="button primary" type="submit" disabled={locked||!text.trim()}>{state?.phase==='loading'?t('正在读取…'):t('读取分享文件')}</button></div>
  </form>
  <div className="baidu-download-save"><div><strong>{t('下载保存位置')}</strong><small>{state?.downloadDir||t('尚未选择，请先选择下载文件夹')}</small></div><button className="button small" disabled={busy||state?.busy} onClick={()=>act(()=>api.chooseBaiduDownloadDir())}>{t('选择保存文件夹')}</button></div>
  <p className="help-text">同一分享中能确认同名商品的材质、适配包会放在同一个新文件夹；下载完成自动加入素材库，无需刷新扫描。不会覆盖已有文件、自动解压或导入工程。</p>
  {(error||state?.message)&&<div className="baidu-download-message" role="status"><p>{t(error||state!.message)}</p><button className="button small" disabled={busy||!enabled} onClick={()=>act(()=>api.openBaidu())}>{t('重新登录／验证')}</button></div>}
  {!enabled&&<p className="help-text">{t('请先开启联网。')}</p>}
  {!!state?.tasks.length&&<div className="baidu-download-current" role="status"><strong>{t(status[state.tasks[0].state])} · {state.tasks[0].name}</strong><progress aria-label={t('最近下载进度')} max={Math.max(state.tasks[0].totalBytes,1)} value={state.tasks[0].receivedBytes}/><small>{bytes(state.tasks[0].receivedBytes)} / {state.tasks[0].totalBytes?bytes(state.tasks[0].totalBytes):'—'} · {bytes(Math.round(state.tasks[0].downloadBps))}/s</small></div>}
  {(state?.queued??0)>0&&<div className="baidu-download-selection" role="status"><span>还有 {state!.queued} 个文件等待下载，将依次处理。</span><button className="button small" disabled={busy} onClick={()=>act(()=>api.cancelBaiduDownloadBatch())}>取消后续队列</button></div>}
  {!!state?.files.length&&<><div className="baidu-download-heading"><strong>{state.title}</strong><button className="button small" disabled={locked||!state.canGoBack} onClick={()=>act(()=>api.backBaiduShare())}>{t('返回上一级')}</button></div><p className="help-text">当前列表 {state.files.length} 个条目。打开文件夹后，可勾选多个文件一起下载，每次最多 100 个。</p>
   {!!files.length&&<div className="baidu-download-selection"><label className="baidu-file-check"><input type="checkbox" aria-label={files.length>100?'全选前100个文件':'全选当前文件'} disabled={locked} checked={files.length>0&&files.slice(0,100).every(file=>selected.has(file.id))} onChange={e=>setSelected(e.target.checked?new Set(files.slice(0,100).map(file=>file.id)):new Set())}/>{files.length>100?'全选前100个文件':'全选当前文件'}</label><span>已勾选 {selected.size} 个</span><button className="button primary small" disabled={locked||!selected.size} onClick={()=>void downloadSelected()}>下载所选{selected.size?'（'+selected.size+'）':''}</button><button className="button small" disabled={locked||!selected.size} onClick={()=>setSelected(new Set())}>取消勾选</button></div>}
   <div className="baidu-share-files">{state.files.map(file=><div className="baidu-share-file" key={file.id}>{file.directory?<span aria-hidden="true">▣</span>:<input type="checkbox" className="baidu-file-checkbox" aria-label={'选择文件 '+file.name} checked={selected.has(file.id)} disabled={locked||!selected.has(file.id)&&selected.size>=100} onChange={e=>setSelected(previous=>{const next=new Set(previous);e.target.checked?next.add(file.id):next.delete(file.id);return next})}/>}<div><strong>{file.name}</strong><small>{file.directory?t('文件夹'):file.sizeText||'—'}</small></div><button className={'button small'+(file.directory?'':' primary')} disabled={locked} onClick={()=>file.directory?act(()=>api.openBaiduShareFolder(file.id)):downloadFile(file.id)}>{file.directory?t('打开文件夹'):t('下载此文件')}</button></div>)}</div></>}
  <details className="baidu-download-history" open><summary>{t('下载记录')} · {state?.tasks.length??0}</summary>{!state?.tasks.length&&<p className="help-text">{t('下载开始后，进度与完成记录会保留在这里。')}</p>}
   {state?.tasks.map(task=><article className="baidu-download-task" key={task.id}><div className="baidu-download-heading"><strong>{task.name}</strong><span className="tiny-pill">{t(status[task.state])}</span></div><progress aria-label={t('下载进度')} max={Math.max(task.totalBytes,1)} value={task.receivedBytes}/><p>{bytes(task.receivedBytes)} / {task.totalBytes?bytes(task.totalBytes):'—'} · {bytes(Math.round(task.downloadBps))}/s</p><div className="baidu-download-actions">{task.state==='downloading'&&<button className="button small" disabled={busy} onClick={()=>act(()=>api.controlBaiduDownload(task.id,'pause'))}>{t('暂停')}</button>}{task.state==='paused'&&<button className="button small" disabled={busy||!enabled} onClick={()=>act(()=>api.controlBaiduDownload(task.id,'resume'))}>{t('继续下载')}</button>}{['downloading','paused'].includes(task.state)&&<button className="button small" disabled={busy} onClick={()=>act(()=>api.controlBaiduDownload(task.id,'cancel'))}>{t('取消下载')}</button>}{task.state==='completed'&&<button className="button small" disabled={busy} onClick={()=>act(()=>api.revealBaiduDownload(task.id))}>{t('查看下载文件')}</button>}{task.state==='interrupted'&&<small>{t('请重新读取分享链接后重试下载。')}</small>}</div>{task.state==='completed'&&<p role="status">{task.assetId?'已加入素材库，无需扫描':task.importError||'文件已保存，可重试入库。'}{!task.assetId&&<button className="button small" disabled={busy||state?.busy} onClick={()=>act(()=>api.retryBaiduDownloadImport(task.id))}>重试入库</button>}</p>}{task.error&&<p role="status">{t(task.error)}</p>}</article>)}
  </details>
  <p className="help-text">{t('仅使用百度允许的网页下载。若百度要求安全验证或客户端，会在此提示，不会自动弹出下载网页或启动外部程序。')}</p>
 </section>;
}
