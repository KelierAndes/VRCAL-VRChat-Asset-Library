import {DISCOVERY_SEARCH_PROMPT,DISCOVERY_WEB_PROVIDERS} from '../shared/discovery-prompt';
import {discoveryRequest,discoveryUrl} from './discovery-parser';
import {parseDiscovery} from './ai-schemas';
import type {DiscoveryPlan} from '../shared/discovery';

export function buildWebDiscoveryPrompt(provider:unknown,value:unknown):{url:string;prompt:string} {
 const selected=DISCOVERY_WEB_PROVIDERS.find(p=>p.id===provider);
 if(!selected)throw new Error('请选择千问、Kimi 或 DeepSeek 官方网页。');
 const request=discoveryRequest(value);
 return {url:selected.url,prompt:DISCOVERY_SEARCH_PROMPT+'\n\n需求 JSON：\n'+JSON.stringify({description:request.description,avatar:request.avatar||''})};
}

export function parseWebDiscoveryReply(raw:unknown):DiscoveryPlan {
 if(typeof raw!=='string'||!raw.trim()||raw.length>16000)throw new Error('请粘贴网页 AI 返回的 JSON，最多 16000 字。');
 let text=raw.trim();
 const fenced=text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
 if(fenced)text=fenced[1].trim();
 try{const plan=parseDiscovery(JSON.parse(text));for(const query of plan.boothQueries)discoveryUrl('booth',query);discoveryUrl('xianyu',plan.xianyuQuery);return plan}catch{throw new Error('回答格式不正确：请复制完整的检索词 JSON。不能包含商品列表、网址或额外文字。');}
}
