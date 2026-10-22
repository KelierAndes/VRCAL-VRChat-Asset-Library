import React,{useEffect,useState} from 'react';
import type {LibraryAPI} from '../shared/contracts';
import {SPONSORS_REFRESH_MS,type Sponsor,type SponsorsState} from '../shared/sponsors';
import {localeName,t,useLanguage} from './i18n';

function SponsorAvatar({person}:{person:Sponsor}) {
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[person.avatarFile]);
 return <span className="contributor-avatar" aria-hidden="true">{person.avatarFile&&!failed?<img src={`library-cover://cache/${encodeURIComponent(person.avatarFile)}`} alt="" onError={()=>setFailed(true)}/>:person.anonymous?'♡':Array.from(person.name??'?')[0]}</span>;
}
export function SponsorsPanel({api}:{api:LibraryAPI}) {
 useLanguage();const [state,setState]=useState<SponsorsState>({status:'unloaded',sponsors:[]}),[pending,setPending]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  let alive=true;const read=()=>api.sponsorsState().then(value=>{if(alive)setState(value)}).catch(()=>{});
  const refresh=async(force=false)=>{if(alive)setPending(true);try{const value=await api.refreshSponsors(force);if(alive)setState(value)}catch{if(alive)setError('暂时无法更新赞助者，已保留上次内容。')}finally{if(alive)setPending(false)}};
  void read().then(()=>refresh());const timer=setInterval(()=>{void refresh(true)},SPONSORS_REFRESH_MS);
  const stop=api.onEvent(event=>{if(event.type==='sponsors')void read()});
  return()=>{alive=false;clearInterval(timer);stop()};
 },[api]);
 async function refresh(){if(pending)return;setPending(true);setError('');try{setState(await api.refreshSponsors(true))}catch{setError('暂时无法更新赞助者，已保留上次内容。')}finally{setPending(false)}}
 async function open(id:string,index:number){try{setError('');await api.openSponsorLink(id,index)}catch{setError('赞助者链接无效。')}}
 const time=(value?:string)=>value?new Date(value).toLocaleString(localeName()):t('尚未同步');
 return <section className="community-sponsors" aria-labelledby="sponsors-title" data-sponsors-status={state.status}>
  <div className="community-section-title sponsors-heading"><h3 id="sponsors-title">{t('赞助者')}<span>{state.sponsors.length}</span></h3><button className="community-link" disabled={pending} onClick={()=>void refresh()}>{pending?t('正在同步…'):t('刷新赞助者')}</button></div>
  <p className="sponsors-intro">{t('感谢支持项目持续维护的每一位朋友。')}</p>
  {state.sponsors.length?<div className="contributor-list">{state.sponsors.map(person=><article className="contributor-card sponsor-card" key={person.id}><div className="contributor-identity"><SponsorAvatar person={person}/><div><h4>{person.anonymous?t('匿名支持者'):person.name}</h4><span className="contributor-handle">{t('感谢你的支持')}</span></div></div>{person.note&&<p className="contributor-role">{person.note}</p>}{person.links.length>0&&<div className="contributor-socials">{person.links.map((account,index)=><button key={index} className="community-link" onClick={()=>void open(person.id,index)} title={t('在系统浏览器打开')}><span>{account.label}</span><span aria-hidden="true">↗</span></button>)}</div>}</article>)}</div>:<p className="sponsors-empty">{t(state.updatedAt?'暂时没有公开的赞助者。':'暂无缓存的赞助者名单。')}</p>}
  <div className="sponsors-status" role="status" aria-live="polite"><span>{t('上次同步：{time}',{time:time(state.checkedAt)})}</span>{state.updatedAt&&<span>{t('名单更新：{time}',{time:time(state.updatedAt)})}</span>}{(error||state.message)&&<span className={state.status==='error'||error?'community-error':''}>{t(error||state.message!)}</span>}</div>
  <p className="sponsors-hint">{t('名单由维护者更新；进入页面及每五分钟检查一次，断网时显示缓存。')}</p>
 </section>;
}
