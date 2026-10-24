import {t} from './i18n';
import React,{useEffect,useState} from 'react';
import type {LibraryAPI} from '../shared/contracts';
import type {DiscoveryState,DiscoveryPlatform,DiscoveryProduct} from '../shared/discovery';
import {AiSettingsPanel} from './ai-tools';
import {DISCOVERY_SEARCH_PROMPT,DISCOVERY_WEB_PROVIDERS,type DiscoveryWebProvider} from '../shared/discovery-prompt';
import './discovery-page.css';
function Product({item,open}:{item:DiscoveryProduct;open:()=>void}){
 const [failed,setFailed]=useState(false);
 return <article className="discovery-card"><div className="discovery-cover">{item.coverFile&&!failed?<img src={`library-cover://cache/${encodeURIComponent(item.coverFile)}`} alt={item.title} loading="lazy" onError={()=>setFailed(true)}/>:<span>{item.coverUrl?'封面加载中或暂不可用':'暂无商品封面'}</span>}<b>{item.platform==='booth'?'BOOTH':'闲鱼'}</b></div><div className="discovery-card-body"><h3 title={item.title}>{item.title}</h3>{item.author&&<small>{item.author}</small>}<p>{item.matchedTerms.length?'标题命中：'+item.matchedTerms.join('、'):'网站搜索返回，相关性请进一步核对。'}</p><p className="discovery-avatar">{item.avatarNote}</p><details><summary>{t("检索依据")}</summary><p>{item.title}</p><p>{t("使用关键词：")}{item.searchQuery}</p><p className="discovery-url">{item.url}</p>{item.categoryEvidence&&<p>{t("BOOTH 类目：")}{item.categoryEvidence.rawCategory}</p>}</details><button className="button" onClick={open}>{t("在内置浏览器查看商品")}</button></div></article>;
}
export function DiscoveryPage({api,online,xianyuEnabled}:{api:LibraryAPI;online:boolean;xianyuEnabled:boolean}){
 const [state,setState]=useState<DiscoveryState>(),[description,setDescription]=useState(''),[avatar,setAvatar]=useState(''),[booth,setBooth]=useState(true),[xianyu,setXianyu]=useState(false),[settings,setSettings]=useState(false),[error,setError]=useState(''),[starting,setStarting]=useState(false);
 const [webProvider,setWebProvider]=useState<DiscoveryWebProvider>('qwen'),[webReply,setWebReply]=useState(''),[webNotice,setWebNotice]=useState('');
 useEffect(()=>{let live=true;void api.discoveryState().then(s=>{if(!live)return;setState(s);if(s.request){setDescription(s.request.description);setAvatar(s.request.avatar||'');setBooth(s.request.platforms.includes('booth'));setXianyu(s.request.platforms.includes('xianyu'))}}).catch(e=>{if(live)setError(String(e))});const timer=setInterval(()=>void api.discoveryState().then(s=>{if(live)setState(s)}).catch(()=>{}),1000);return()=>{live=false;clearInterval(timer)}},[api]);
 const action=async(fn:()=>Promise<unknown>)=>{setError('');try{await fn()}catch(e){setError(String(e).replace(/^Error: /,''))}};
 const request=()=>({description,avatar,platforms:[...(booth?['booth' as const]:[]),...(xianyu&&xianyuEnabled?['xianyu' as const]:[])]});
 const search=async()=>{setStarting(true);await action(async()=>setState(await api.startDiscovery(request())));setStarting(false)};
 const prepareWeb=async()=>{setStarting(true);setWebNotice('');await action(async()=>{await api.prepareWebDiscovery(webProvider,request());setWebNotice('提示词和需求已复制。请在打开的官网粘贴并发送，复制完整回答后回到这里。')});setStarting(false)};
 const searchWeb=async()=>{setStarting(true);await action(async()=>setState(await api.startWebDiscovery(request(),webReply)));setStarting(false)};
 const unavailable=!online||starting||!!state?.running||!description.trim()||!booth&&!(xianyu&&xianyuEnabled);
 const source=(p:DiscoveryPlatform)=>p==='booth'?'BOOTH':'闲鱼';
 return <section className="discovery-page" aria-label="AI 找素材"><div className="discovery-intro"><div><h2>{t("描述你想要的，找到新的灵感")}</h2><p>{t("从 BOOTH 和已开启的闲鱼搜索真实商品。输入风格、品类，也可以指定适配角色。")}</p></div><button className="button" onClick={()=>setSettings(!settings)}>{settings?'收起 AI 设置':'AI 设置'}</button></div>{settings&&<AiSettingsPanel api={api}/>}
  <form className="discovery-form" onSubmit={e=>{e.preventDefault();void search()}}>
   <label htmlFor="discovery-query">{t("你想找什么？")}</label>
   <textarea id="discovery-query" value={description} onChange={e=>setDescription(e.target.value)} maxLength={600} placeholder="描述品类、风格、颜色或细节，例如黑白配色的哥特蕾丝礼裙"/>
   <div className="discovery-options"><label>{t("适配角色（可不填）")}<input value={avatar} onChange={e=>setAvatar(e.target.value)} maxLength={80} placeholder="例如 Shinano / しなの"/></label><label className="discovery-check"><input type="checkbox" checked={booth} onChange={e=>setBooth(e.target.checked)}/>BOOTH</label><label className="discovery-check"><input type="checkbox" checked={xianyu&&xianyuEnabled} disabled={!xianyuEnabled} onChange={e=>setXianyu(e.target.checked)}/>{t("闲鱼")}{xianyuEnabled?'':'（需在设置中开启）'}</label><button type="submit" className="button primary" disabled={unavailable}>{state?.running?'正在查找…':'帮我找素材'}</button>{state?.running&&<button className="button" type="button" onClick={()=>void action(async()=>setState(await api.cancelDiscovery()))}>{t("停止搜索")}</button>}</div>
   <small>不用 API 密钥也能按关键词搜索。启用 AI 设置中的“用描述找素材”后，会自动用 API 整理检索词；也可以使用下方的网页 AI。只处理输入的需求，不读取素材文件。</small>
   <details className="discovery-web-helper"><summary>使用网页 AI（免 API 密钥）</summary>
    <p>先填写上方需求。程序会复制内置提示词和脱敏需求，并在系统浏览器打开官方 AI 网页。按官网要求登录，在对话框粘贴并发送；把完整 JSON 回答复制回来即可继续搜索。网页服务的可用性和额度由官网决定。</p>
    <div className="discovery-web-actions"><label>网页 AI 服务商<select aria-label="网页 AI 服务商" value={webProvider} disabled={starting} onChange={e=>setWebProvider(e.target.value as DiscoveryWebProvider)}>{DISCOVERY_WEB_PROVIDERS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><button type="button" className="button" disabled={unavailable} onClick={()=>void prepareWeb()}>复制提示词并打开官网</button></div>
    {webNotice&&<p role="status">{webNotice}</p>}
    <label htmlFor="discovery-web-reply">粘贴网页 AI 的完整回答</label><textarea id="discovery-web-reply" value={webReply} onChange={e=>setWebReply(e.target.value)} maxLength={16000} spellCheck={false} placeholder={'{"summary":"…","boothQueries":["…"],"xianyuQuery":"VRChat …","terms":["…"]}'}/>
    <button type="button" className="button primary" disabled={unavailable||!webReply.trim()} onClick={()=>void searchWeb()}>使用回答搜索商品</button>
   </details>
   <details className="discovery-prompt"><summary>查看内置检索提示词</summary><pre>{DISCOVERY_SEARCH_PROMPT}</pre></details>
  </form>
  {!online&&<p role="status">{t("当前离线，已找到的商品仍可浏览。")}</p>}{error&&<p role="alert" className="discovery-notice">{error}</p>}{state&&<div className="discovery-notice" role="status"><b>{state.method==='web-ai'?'网页 AI 检索词（用户导入）':state.method==='ai'?'AI 辅助检索':state.method==='local'?'本地关键词检索':'准备搜索'}</b><p>{state.notice}</p>{state.plan&&<><div className="discovery-terms">{state.plan.boothQueries.map(q=><span key={q}>{q}</span>)}</div><p>{state.plan.summary}</p></>}{Object.entries(state.sources).map(([p,message])=><div className="discovery-source" key={p}><span>{source(p as DiscoveryPlatform)}：{message}</span><button className="text-button" disabled={!online||p==='xianyu'&&!xianyuEnabled} onClick={()=>void action(()=>api.openDiscoverySearch(p as DiscoveryPlatform))}>{t("打开站内搜索")}</button></div>)}</div>}
  <div className="discovery-result-heading"><h3>{state?.products.length?`找到 ${state.products.length} 件商品`:'商品会显示在这里'}</h3><span>{t("按标题命中词数排序 · 不是适配保证")}</span></div><div className="discovery-grid">{state?.products.map(item=><Product key={item.url} item={item} open={()=>void action(()=>api.openDiscoveryProduct(item.url))}/>)}</div>{!state?.running&&!state?.products.length&&<div className="discovery-empty">输入想找的素材后点击“帮我找素材”。需要 AI 整理复杂需求时，可配置 API 或展开“使用网页 AI”。</div>}
 </section>;
}
