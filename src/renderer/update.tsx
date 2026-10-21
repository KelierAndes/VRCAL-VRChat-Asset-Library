import React, { useEffect, useRef, useState } from 'react';
import type { LibraryAPI, UpdateState } from '../shared/contracts';
import { t, useLanguage } from './i18n';

const statusLabels: Record<UpdateState['status'], string> = {
  idle: '尚未检查更新', checking: '正在检查更新…', available: '有可用更新',
  'up-to-date': '已是最新版本', downloading: '正在下载更新…', ready: '更新已下载',
  installing: '正在准备重启…', error: '更新未完成', unsupported: '此版本不支持自动安装'
};
const size = (bytes: number) => bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
type Runner = (action: () => Promise<unknown>, message?: string) => Promise<boolean>;

export function UpdateSettings({ api, run, onShowHistory, navigationDisabled=false }: { api: LibraryAPI; run: Runner; onShowHistory?:()=>void; navigationDisabled?:boolean }) {
  useLanguage();
  const [state, setState] = useState<UpdateState>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const mounted = useRef(true);
  const read = async () => {
    try { const next = await api.updateState(); if (mounted.current) { setState(next); setError(''); } }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '无法读取更新状态，请重试。'); }
  };
  useEffect(() => { mounted.current = true; void read(); const timer = setInterval(() => void read(), 1000); return () => { mounted.current = false; clearInterval(timer); }; }, [api]);
  const action = async (operation: () => Promise<unknown>) => {
    if (pending) return;
    setPending(true);
    try { await run(operation); await read(); } finally { if (mounted.current) setPending(false); }
  };
  // Starting a download may await the complete transfer. Cancellation has its
  // own lock so it remains available while that request is still pending.
  const cancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    try { await run(() => api.cancelUpdate()); await read(); }
    finally { if (mounted.current) setCancelling(false); }
  };
  const downloading = state?.status === 'downloading';
  const working = pending || downloading || state?.status === 'checking' || state?.status === 'installing';
  const progress = state?.totalBytes ? Math.min(100, state.receivedBytes / state.totalBytes * 100) : undefined;
  return <section className="setting-block update-settings" aria-label={t('应用更新')}>
    <h3>{t('应用更新')}</h3>
    <p>{t('当前版本：{version}', { version: state?.currentVersion ?? '…' })}{state?.latestVersion && <><br/>{t('最新版本：{version}', { version: state.latestVersion })}</>}</p>
    <p role="status">{state ? t(statusLabels[state.status]) : t('正在读取更新状态…')}</p>
    {state?.message && <p className={`help-text${state.status === 'error' ? ' error-text' : ''}`}>{t(state.message)}</p>}
    {error && <p className="error-text" role="alert">{t(error)}</p>}
    {state && (state.receivedBytes > 0 || downloading || state.status === 'ready') && <div className="update-progress">
      <progress aria-label={t('更新下载进度')} max={100} value={progress}/>
      <span>{t('已下载 {received}{total}', { received: size(state.receivedBytes), total: state.totalBytes ? ` / ${size(state.totalBytes)}` : '' })}{downloading && state.downloadBps !== undefined ? ` · ${size(state.downloadBps)}/s` : ''}</span>
    </div>}
    {state && !state.canInstall && <p className="help-text">{t('自动安装仅适用于 Windows 便携版；其他版本可打开发布页面手动更新。')}</p>}
    {state?.releaseNotes && <details className="update-release-notes"><summary>{t('更新说明')}</summary><p>{state.releaseNotes}</p></details>}
    <div className="setting-actions">
      {onShowHistory && <button className="button" data-update-action="history" disabled={navigationDisabled} onClick={onShowHistory}>{t('查看更新记录')}</button>}
      <button className="button" data-update-action="check" disabled={working} onClick={() => void action(() => api.checkForUpdates())}>{t('检查更新')}</button>
      {state?.status === 'available' && state.canInstall && <button className="button primary" data-update-action="download" disabled={working} onClick={() => void action(() => api.downloadUpdate())}>{t('下载更新')}</button>}
      {state?.status === 'ready' && state.canInstall && <button className="button primary" data-update-action="install" disabled={working} onClick={() => void action(() => api.installUpdate())}>{t('重启并更新')}</button>}
      {downloading && <button className="button" data-update-action="cancel" disabled={cancelling} onClick={() => void cancel()}>{t('取消下载')}</button>}
      <button className="button" data-update-action="release" onClick={() => void run(() => api.openUpdatePage())}>{t('打开发布页面')}</button>
    </div>
  </section>;
}
