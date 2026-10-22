import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {LibraryAPI} from '../shared/contracts';
import type {StarInvite} from '../shared/star-invite';
import {t,useLanguage} from './i18n';
import './star-invite.css';

export function StarInviteNotice({api,ready}:{api:LibraryAPI;ready:boolean}) {
 useLanguage();
 const [invite,setInvite]=useState<StarInvite|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 useEffect(()=>{if(!ready)return;let active=true;api.startupStarInvite().then(value=>{if(active)setInvite(value)}).catch(()=>{/* A reminder must not interrupt normal startup. */});return()=>{active=false}},[api,ready]);
 if(!invite)return null;
 const dismiss=async()=>{if(lock.current)return;lock.current=true;setBusy(true);try{await api.dismissStarInvite(invite.count);setInvite(null)}catch{setError('操作未完成，请稍后重试')}finally{lock.current=false;setBusy(false)}};
 const confirm=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await api.openStarProject(invite.count);setInvite(null)}catch{setError('无法打开浏览器，请重试或复制项目地址手动打开。')}finally{lock.current=false;setBusy(false)}};
 return createPortal(<aside className="star-invite" data-star-invite data-milestone={invite.count} role="region" aria-label={t('喜欢这个项目吗？')}><div className="star-invite-heading"><span className="star-invite-icon" aria-hidden="true">☆</span><strong>{t('喜欢这个项目吗？')}</strong><button className="icon-button star-invite-close" type="button" disabled={busy} aria-label={t('关闭本次提示')} onClick={dismiss}>×</button></div><p className="star-invite-message" role="status">{t('你已经打开应用 {count} 次，喜欢的话可以给本项目点个 Star 吗？',{count:invite.count})}</p><div className="star-invite-address"><span>{t('项目地址')}</span><p>{invite.projectUrl}</p></div>{error&&<p className="star-invite-error" role="alert">{t(error)}</p>}<div className="star-invite-actions"><button type="button" className="button small" disabled={busy} onClick={dismiss}>{t('下次再说')}</button><button type="button" className="button small primary" disabled={busy} onClick={confirm}>{busy?t('正在打开…'):t('确认，打开 GitHub')}</button></div></aside>,document.body);
}
