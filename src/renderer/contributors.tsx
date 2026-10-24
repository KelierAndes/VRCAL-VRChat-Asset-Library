import React,{useState} from 'react';
import {CONTRIBUTORS,QQ_GROUP_NUMBER,type Contributor} from '../shared/community';
import qqGroupQr from '../../assets/community/qq-group.png';
import {t} from './i18n';
import './contributors.css';

const portraits=import.meta.glob('../../assets/contributors/*.{jpg,jpeg,png,webp}',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
function ContributorAvatar({person}:{person:Contributor}) {
 const [failed,setFailed]=useState(false),source=person.avatar?portraits['../../assets/contributors/'+person.avatar]:undefined;
 return <span className="contributor-avatar" aria-hidden="true">{source&&!failed?<img src={source} alt="" onError={()=>setFailed(true)}/>:person.initials}</span>;
}

export function ContributorsPage({openLink,copyGroup}:{openLink:(id:string)=>Promise<void>;copyGroup:()=>Promise<void>}) {
 const [pending,setPending]=useState(''),[error,setError]=useState('');
 const [showGroup,setShowGroup]=useState(false),[copied,setCopied]=useState(false);
 async function copyNumber(){if(pending)return;setPending('qq-group');setError('');setCopied(false);try{await copyGroup();setCopied(true)}catch(error){setError(error instanceof Error?error.message:t('操作未完成，请稍后重试'))}finally{setPending('')}}
 async function open(id:string){if(pending)return;setPending(id);setError('');try{await openLink(id)}catch(error){setError(error instanceof Error?error.message:t('操作未完成，请稍后重试'))}finally{setPending('')}}
 const link=(id:string,label:string,primary=false)=><button className={`community-link${primary?' primary':''}`} disabled={!!pending} onClick={()=>void open(id)} title={t('在系统浏览器打开')}><span>{t(label)}</span><span aria-hidden="true">↗</span></button>;
 return <section className="contributors-page" aria-label={t('贡献者与社区')}><div className="community-content">
  <header className="community-intro"><span className="community-license">VRCAL Community 1.0 · {t('源码可见')}</span><h2>{t('VRChat 本地素材管理器')}</h2><p>{t('感谢让这个项目不断变好的每一个人。')}</p><div className="community-actions">{link('source','源码仓库',true)}{link('contribute','参与贡献')}<button className="community-link community-qq-entry" aria-expanded={showGroup} aria-controls="community-qq-panel" onClick={()=>setShowGroup(value=>!value)}><span>{t('加群聊天')}</span><span>QQ</span></button></div></header>
  {error&&<p className="community-error" role="alert">{t(error)}</p>}
  {showGroup&&<section className="community-qq-panel" id="community-qq-panel" aria-labelledby="community-qq-title"><div className="community-qq-copy"><h3 id="community-qq-title">{t('QQ群 · 加群聊天')}</h3><p>{t('催更 / 反馈 Bug，也欢迎聊聊改模和素材整理。')}</p><p className="community-qq-number">{t('群号：')}<strong>{QQ_GROUP_NUMBER}</strong></p><button className="community-link" disabled={!!pending} onClick={()=>void copyNumber()}>{t('复制群号')}</button><span className="community-qq-status" role="status">{copied?t('群号已复制'):''}</span><p className="community-qq-hint">{t('使用 QQ 扫描右侧二维码，或搜索群号加入。')}</p></div><img src={qqGroupQr} className="community-qq-qr" alt={t('QQ群二维码，群号 {number}',{number:QQ_GROUP_NUMBER})} width={463} height={564}/></section>}
  <div className="community-grid"><section className="community-people" aria-labelledby="community-people-title"><div className="community-section-title"><h3 id="community-people-title">{t('此版本的贡献者')}<span>{CONTRIBUTORS.length}</span></h3></div>
   <div className="contributor-list">{CONTRIBUTORS.map(person=><article className="contributor-card" key={person.handle}><div className="contributor-identity"><ContributorAvatar person={person}/><div><h4>{person.name}</h4><span className="contributor-handle">@{person.handle}</span></div></div><p className="contributor-role">{t(person.role)}</p><div className="contributor-socials">{person.links.map(account=><React.Fragment key={account.id}>{link(account.id,account.label)}</React.Fragment>)}</div></article>)}</div>
   <div className="community-all">{link('contributors','查看全部贡献者')}</div>
  </section><section className="community-join" aria-labelledby="community-join-title"><h3 id="community-join-title">{t('从一个小改动开始')}</h3><p>{t('代码、翻译、文档、测试与反馈，都欢迎。')}</p><div className="community-resources"><div><strong>{t('一起完善这个项目')}</strong><p>{t('了解如何参与，或分享你遇到的问题。')}</p>{link('contribute','贡献指南')}{link('feedback','反馈问题')}</div><div><strong>{t('共同维护，统一发布')}</strong><p>{t('项目采用自定义社区协作许可，使用与贡献请阅读仓库 LICENSE。')}</p>{link('source','查看项目源码')}</div></div></section></div>
 </div></section>;
}
