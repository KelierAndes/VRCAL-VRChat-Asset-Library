import React,{useState} from 'react';
import {CONTRIBUTORS} from '../shared/community';
import {t} from './i18n';
import './contributors.css';

export function ContributorsPage({openLink}:{openLink:(id:string)=>Promise<void>}) {
 const [pending,setPending]=useState(''),[error,setError]=useState('');
 async function open(id:string){if(pending)return;setPending(id);setError('');try{await openLink(id)}catch(error){setError(error instanceof Error?error.message:t('操作未完成，请稍后重试'))}finally{setPending('')}}
 const link=(id:string,label:string,primary=false)=><button className={`community-link${primary?' primary':''}`} disabled={!!pending} onClick={()=>void open(id)} title={t('在系统浏览器打开')}><span>{t(label)}</span><span aria-hidden="true">↗</span></button>;
 return <section className="contributors-page" aria-label={t('贡献者与社区')}><div className="community-content">
  <header className="community-intro"><span className="community-license">GPL-3.0 · {t('开源社区')}</span><h2>{t('VRChat 本地素材管理器')}</h2><p>{t('感谢让这个项目不断变好的每一个人。')}</p><div className="community-actions">{link('source','源码仓库',true)}{link('contribute','参与贡献')}</div></header>
  {error&&<p className="community-error" role="alert">{t(error)}</p>}
  <div className="community-grid"><section className="community-people" aria-labelledby="community-people-title"><div className="community-section-title"><h3 id="community-people-title">{t('此版本的贡献者')}<span>{CONTRIBUTORS.length}</span></h3></div>
   <div className="contributor-list">{CONTRIBUTORS.map(person=><article className="contributor-card" key={person.handle}><div className="contributor-identity"><span className="contributor-avatar" aria-hidden="true">{person.initials}</span><div><h4>{person.name}</h4><span className="contributor-handle">@{person.handle}</span></div></div><p className="contributor-role">{t(person.role)}</p><div className="contributor-socials">{person.links.map(account=><React.Fragment key={account.id}>{link(account.id,account.label)}</React.Fragment>)}</div></article>)}</div>
   <div className="community-all">{link('contributors','查看全部贡献者')}</div>
  </section><section className="community-join" aria-labelledby="community-join-title"><h3 id="community-join-title">{t('从一个小改动开始')}</h3><p>{t('代码、翻译、文档、测试与反馈，都欢迎。')}</p><div className="community-resources"><div><strong>{t('一起完善这个项目')}</strong><p>{t('了解如何参与，或分享你遇到的问题。')}</p>{link('contribute','贡献指南')}{link('feedback','反馈问题')}</div><div><strong>{t('自由使用，共同维护')}</strong><p>{t('项目采用 GPL-3.0 开源许可证。')}</p>{link('source','查看项目源码')}</div></div></section></div>
 </div></section>;
}
