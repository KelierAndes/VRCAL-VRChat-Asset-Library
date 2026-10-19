import path from 'node:path';
import {AssetRecord,AvatarEvidence,ManualInfo,LocalMember} from '../shared/contracts';
import {inferAvatars,isAvatarName,normalizeName} from './hints';
import {boothProductId,extractBoothIds,creatorClue,canonicalCreator,fileVersion,packageClue} from './matching';
import {validateWrapper,wrapperPathKey,wrapperCompatible,wrapperDisplayName} from './wrappers';

const unique=(values:string[])=>[...new Set(values)];
const compact=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const itemId=boothProductId;

/** Conservative product identity: versions and avatar variants of one download. */
export function productName(value:string):string {
  const packaged=packageClue(value);if(packaged)return normalizeName(packaged.name+' '+(packaged.author??''));
  if(isAvatarName(value))return inferAvatars(value)[0]?.toLowerCase()??normalizeName(value);
  let name=value.normalize('NFKC').replace(/\.(?:zip|rar|7z|unitypackage)$/i,'');
  for(;;){const stripped=name.replace(/\s*\(\d+\)\s*$/,'').replace(/(?:[_\s-]20\d{6})\s*$/,'').replace(/(?:(?<![A-Za-z0-9])(?:ver(?:sion)?\.?|v)\s*\d+(?:\.\d+)*[a-z]?|[_\s-]\d+(?:\.\d+)+)\s*$/i,'').trim();if(stripped===name)break;name=stripped}
  name=name.replace(/(?<![A-Za-z0-9])full\s*set(?![A-Za-z0-9])/gi,' ');
  // Variant-only suffixes are common in individual avatar downloads. Preserve
  // full names such as "Airi Dress" and identities made entirely of avatars.
  const parts=name.split(/[\s_\-[\]【】()（）]+/).filter(Boolean);
  while(parts.length>1&&isAvatarName(parts.at(-1)!))parts.pop();
  return normalizeName(parts.join(' '));
}
function localIdentity(record:AssetRecord):{ids:string[];author?:string} {
  const named=extractBoothIds(record.name);
  const matched=record.online.status==='matched'?itemId(record.online.url):undefined;
  // README links often credit a base avatar or shader. They are discovery
  // clues, never product identity capable of overriding explicit item IDs.
  const creator=creatorClue(record.name)??(record.online.status==='matched'?record.online.author:undefined);
  return {ids:unique([...named,...(matched?[matched]:[])]),author:creator?canonicalCreator(creator):undefined};
}
function canMerge(a:AssetRecord,b:AssetRecord,wrappers:Map<string,AssetRecord[]>):boolean {
  if(a.kind==='unity-project'||b.kind==='unity-project'||a.kind==='file'||b.kind==='file')return false;
  const ai=localIdentity(a),bi=localIdentity(b);
  if(ai.ids.length>1||bi.ids.length>1)return false;
  if(ai.ids.length&&bi.ids.length&&ai.ids[0]!==bi.ids[0])return false;
  if(!wrapperCompatible(a,b))return false;
  if(a.kind==='folder'&&b.kind==='folder'&&(wrappers.get(wrapperPathKey(a.path))??[]).some(wrapper=>validateWrapper(wrapper.wrapper,wrapper.path)!.chain.some(entry=>wrapperPathKey(entry)===wrapperPathKey(b.path))&&wrapperCompatible(wrapper,a)&&wrapperCompatible(wrapper,b)))return true;
  const aa=a.online.status==='matched'?itemId(a.online.url):undefined,ba=b.online.status==='matched'?itemId(b.online.url):undefined;
  if(aa&&ba)return aa===ba;
  if(path.dirname(a.path).toLowerCase()!==path.dirname(b.path).toLowerCase())return false;
  const an=productName(wrapperDisplayName(a)),bn=productName(wrapperDisplayName(b));
  if(!an||an!==bn)return false;
  // Generic names do not establish a product, especially across old imports.
  return !/^(?:新建文件夹|new folder|download|downloads|素材|衣装|服装|pack|assets|all|fullset)$/.test(an);
}

export function mergeEvidence(records:AssetRecord[]):AvatarEvidence[] {
  const rows=new Map<string,AvatarEvidence>();
  for(const record of records){
    const evidence=record.localEvidence??inferAvatars(record.name).map(avatar=>({avatar,files:[record.path],basis:'filename' as const}));
    const manual=(record.manual.avatars??[]).map(avatar=>({avatar,files:[],basis:'manual' as const}));
    for(const entry of [...evidence,...manual]){
      const key=`${entry.avatar}:${entry.basis}`,existing=rows.get(key);
      rows.set(key,{avatar:entry.avatar,basis:entry.basis,files:unique([...(existing?.files??[]),...entry.files]).slice(0,80)});
    }
  }
  return [...rows.values()];
}
const rank=(record:AssetRecord)=>(record.kind==='folder'?100:0)+(record.missing?-200:0)+(record.manual.title?4:0)+(record.manual.coverFile?2:0);
function aggregate(records:AssetRecord[]):AssetRecord {
  const sorted=[...records].sort((a,b)=>rank(b)-rank(a)||a.path.localeCompare(b.path,'zh-CN'));
  const wrapperOwners=records.filter(record=>validateWrapper(record.wrapper,record.path)),outer=wrapperOwners.sort((a,b)=>a.path.length-b.path.length)[0];
  const representative=outer??sorted[0],online=[...records].sort((a,b)=>(b.online.status==='matched'?20:0)-(a.online.status==='matched'?20:0)+(b.online.coverFile?4:0)-(a.online.coverFile?4:0)||b.updatedAt.localeCompare(a.updatedAt))[0].online;
  const manual:ManualInfo={};
  const annotationOrder=outer?[...sorted].sort((a,b)=>a.path.length-b.path.length):[...sorted].reverse();
  for(const record of annotationOrder)Object.assign(manual,record.manual);
  for(const key of ['tags','avatars','relatedIds'] as const)if(records.some(record=>record.manual[key]!==undefined))manual[key]=unique(records.flatMap(record=>record.manual[key]??[]));
  if(records.some(record=>record.manual.favorite!==undefined))manual.favorite=records.some(record=>record.manual.favorite);
  if(records.some(record=>record.manual.matchingMode==='manual'))manual.matchingMode='manual';
  const evidence=mergeEvidence(records),members:LocalMember[]=sorted.map(({id,path,name,kind,missing,manual,mtimeMs})=>({id,path,name,kind,missing,manual:{...manual},version:fileVersion(name),mtimeMs}));
  return {...representative,name:wrapperDisplayName(representative),manual,online:{...online},size:records.reduce((sum,record)=>sum+record.size,0),missing:records.every(record=>record.missing),members,localEvidence:evidence,localAvatars:unique(evidence.map(entry=>entry.avatar)),compatibilityComplete:records.every(record=>record.compatibilityComplete===true)&&evidence.length>0,aggregationKey:representative.id,hintUrls:unique(records.flatMap(record=>record.hintUrls)),localNameHints:unique(records.flatMap(record=>record.localNameHints??[])).slice(0,20),previewFile:representative.previewFile??records.find(record=>record.previewFile)?.previewFile,updatedAt:records.map(record=>record.updatedAt).sort().at(-1)!};
}

/** Display projection only. Original rows and their persistent IDs stay intact. */
export function projectionKeys(record:AssetRecord):string[] {
  const booth=record.online.status==='matched'?itemId(record.online.url):undefined;
  const wrapper=validateWrapper(record.wrapper,record.path);
  return [`name:${path.dirname(record.path).toLowerCase()}:${productName(wrapperDisplayName(record))}`,...(booth?[`booth:${booth}`]:[]),`wrapper-path:${wrapperPathKey(record.path)}`,...(wrapper?.chain.slice(1).map(entry=>`wrapper-path:${wrapperPathKey(entry)}`)??[])];
}

export function projectAssets(records:AssetRecord[]):AssetRecord[] {
  const groups:AssetRecord[][]=[],index=new Map<string,AssetRecord[][]>();
  const wrappers=new Map<string,AssetRecord[]>();
  for(const record of records)if(record.kind==='folder')for(const entry of validateWrapper(record.wrapper,record.path)?.chain??[]){const key=wrapperPathKey(entry),owners=wrappers.get(key)??[];owners.push(record);wrappers.set(key,owners)}
  for(const record of [...records].sort((a,b)=>a.path.localeCompare(b.path,'zh-CN'))){
    const keys=projectionKeys(record);
    const candidates=[...new Set(keys.flatMap(key=>index.get(key)??[]))];
    let group=candidates.find(members=>members.every(member=>canMerge(member,record,wrappers)));
    if(group)group.push(record);else {group=[record];groups.push(group)}
    for(const key of keys){const buckets=index.get(key)??[];if(!buckets.includes(group))buckets.push(group);index.set(key,buckets)}
  }
  return groups.map(aggregate);
}
