import React,{useEffect,useState} from 'react';
import type {LibraryAPI} from '../shared/contracts';
import type {BaiduDownloadState} from '../shared/baidu-download';
import {t,useLanguage} from './i18n';
import './baidu-download-panel.css';

const bytes=(n:number)=>n>=1024**3?(n/1024**3).toFixed(1)+' GB':n>=1024**2?(n/1024**2).toFixed(1)+' MB':n>=1024?(n/1024).toFixed(1)+' KB':n+' B';
const status={downloading:'正在下载',paused:'已暂停',completed:'下载完成',interrupted:'下载中断',cancelled:'已取消'};
export function BaiduDownloadPanel({api,enabled}:{api:LibraryAPI;enabled:boolean}){
 useLanguage();const [state,setState]=useState<BaiduDownloadState>(),[text,setText]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const value=await api.baiduDownloadsState();if(active)setState(value)}catch(e){if(active)setError(String(e))}finally{if(active)timer=setTimeout(poll,1000)}};void poll();return()=>{active=false;clearTimeout(timer)}},[api]);
 const act=async(action:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');try{await action()}catch(e){setError((e instanceof Error?e.message:String(e)).replace(/^Error invoking remote method '[^']+': Error: /,''))}finally{try{setState(await api.baiduDownloadsState())}catch{}setBusy(false)}};
 const locked=busy||state?.busy||!enabled||!state?.loggedIn;
 return <section className="baidu-download-panel" aria-label={t('百度网盘链接下载')}>
  <div className="baidu-download-heading"><div><h3>{t('百度网盘链接下载')}</h3><p>{t('登录后，在本页粘贴链接、选择文件并查看下载进度。')}</p></div><span className="tiny-pill">{state?.loggedIn?t('百度账号已登录'):t('请先登录百度账号')}</span></div>
  {!state?.loggedIn&&<div className="baidu-login-first"><strong>{t('第一步：登录百度账号')}</strong><p>{t('仅登录和验证在官方窗口完成；文件列表和下载操作都在本应用页面中。')}</p><button className="button primary" disabled={busy||!enabled} onClick={()=>act(()=>api.openBaidu())}>{t('登录百度账号')}</button></div>}
  <form onSubmit={e=>{e.preventDefault();void act(()=>api.readBaiduShare(text,code))}}>
   <label>{t('分享链接或整段分享文字')}<textarea rows={2} maxLength={8192} value={text} onChange={e=>setText(e.target.value)} placeholder={t('粘贴百度网盘分享链接，可包含提取码')} disabled={locked}/></label>
   <div className="baidu-download-actions"><label>{t('提取码（链接已有可留空）')}<input value={code} onChange={e=>setCode(e.target.value)} maxLength={4} autoComplete="off" disabled={locked}/></label><button className="button primary" type="submit" disabled={locked||!text.trim()}>{state?.phase==='loading'?t('正在读取…'):t('读取分享文件')}</button></div>
  </form>
  <div className="baidu-download-save"><div><strong>{t('下载保存位置')}</strong><small>{state?.downloadDir||t('尚未选择，请先选择下载文件夹')}</small></div><button className="button small" disabled={busy||state?.busy} onClick={()=>act(()=>api.chooseBaiduDownloadDir())}>{t('选择保存文件夹')}</button></div>
  <p className="help-text">{t('每次下载放入独立子文件夹，避免覆盖已有文件；不会自动解压或导入工程。')}</p>
  {(error||state?.message)&&<div className="baidu-download-message" role="status"><p>{t(error||state!.message)}</p><button className="button small" disabled={busy||!enabled} onClick={()=>act(()=>api.openBaidu())}>{t('重新登录／验证')}</button></div>}
  {!enabled&&<p className="help-text">{t('请先开启联网。')}</p>}
  {!!state?.tasks.length&&<div className="baidu-download-current" role="status"><strong>{t(status[state.tasks[0].state])} · {state.tasks[0].name}</strong><progress aria-label={t('最近下载进度')} max={Math.max(state.tasks[0].totalBytes,1)} value={state.tasks[0].receivedBytes}/><small>{bytes(state.tasks[0].receivedBytes)} / {state.tasks[0].totalBytes?bytes(state.tasks[0].totalBytes):'—'} · {bytes(Math.round(state.tasks[0].downloadBps))}/s</small></div>}
  {!!state?.files.length&&<><div className="baidu-download-heading"><strong>{state.title}</strong><button className="button small" disabled={locked||!state.canGoBack} onClick={()=>act(()=>api.backBaiduShare())}>{t('返回上一级')}</button></div><p className="help-text">{t('当前网页列表中的 {count} 个条目；打开文件夹后选择单个文件下载。',{count:state.files.length})}</p>
   <div className="baidu-share-files">{state.files.map(file=><div className="baidu-share-file" key={file.id}><span aria-hidden="true">{file.directory?'▣':'↓'}</span><div><strong>{file.name}</strong><small>{file.directory?t('文件夹'):file.sizeText||'—'}</small></div><button className={'button small'+(file.directory?'':' primary')} disabled={locked||(!file.directory&&!state.downloadDir)} onClick={()=>act(()=>file.directory?api.openBaiduShareFolder(file.id):api.downloadBaiduFile(file.id))}>{file.directory?t('打开文件夹'):t('下载此文件')}</button></div>)}</div></>}
  <details className="baidu-download-history" open><summary>{t('下载记录')} · {state?.tasks.length??0}</summary>{!state?.tasks.length&&<p className="help-text">{t('下载开始后，进度与完成记录会保留在这里。')}</p>}
   {state?.tasks.map(task=><article className="baidu-download-task" key={task.id}><div className="baidu-download-heading"><strong>{task.name}</strong><span className="tiny-pill">{t(status[task.state])}</span></div><progress aria-label={t('下载进度')} max={Math.max(task.totalBytes,1)} value={task.receivedBytes}/><p>{bytes(task.receivedBytes)} / {task.totalBytes?bytes(task.totalBytes):'—'} · {bytes(Math.round(task.downloadBps))}/s</p><div className="baidu-download-actions">{task.state==='downloading'&&<button className="button small" disabled={busy} onClick={()=>act(()=>api.controlBaiduDownload(task.id,'pause'))}>{t('暂停')}</button>}{task.state==='paused'&&<button className="button small" disabled={busy||!enabled} onClick={()=>act(()=>api.controlBaiduDownload(task.id,'resume'))}>{t('继续下载')}</button>}{['downloading','paused'].includes(task.state)&&<button className="button small" disabled={busy} onClick={()=>act(()=>api.controlBaiduDownload(task.id,'cancel'))}>{t('取消下载')}</button>}{task.state==='completed'&&<button className="button small" disabled={busy} onClick={()=>act(()=>api.revealBaiduDownload(task.id))}>{t('查看下载文件')}</button>}{task.state==='interrupted'&&<small>{t('请重新读取分享链接后重试下载。')}</small>}</div>{task.error&&<p role="status">{t(task.error)}</p>}</article>)}
  </details>
  <p className="help-text">{t('仅使用百度允许的网页下载。若百度要求安全验证或客户端，会在此提示，不会自动弹出下载网页或启动外部程序。')}</p>
 </section>;
}
