import type {AssetRecord,OnlineInfo} from '../shared/contracts';
import {canonicalSourceKey} from './matching';
import {isOrganizationalAsset} from './organization';

interface CatalogStore {
 all():AssetRecord[];get(id:string):AssetRecord|null;getRaw(id:string):AssetRecord|null;
 updateOnline(id:string,patch:Partial<OnlineInfo>):void;
}
/** Queue identity follows the display projection; persistent member rows stay intact. */
export function matchingCatalog(store:CatalogStore){
 const members=(asset:AssetRecord)=>[...new Set(asset.members?.map(member=>member.id)||[asset.id])];
 const get=(id:string):AssetRecord|null=>{
  const asset=store.get(id);if(!asset||isOrganizationalAsset(asset))return null;
  const rows=members(asset).map(member=>store.getRaw(member)).filter((row):row is AssetRecord=>!!row);
  const rejectedUrls=[...new Set(rows.flatMap(row=>row.online.rejectedUrls||[]))];
  const manual=rows.some(row=>row.manual.matchingMode==='manual')?{...asset.manual,matchingMode:'manual' as const}:asset.manual;
  return {...asset,manual,online:{...asset.online,rejectedUrls}};
 };
 return {get,all:()=>{
  const seen=new Set<string>(),result:AssetRecord[]=[];
  for(const row of store.all()){const asset=get(row.id);if(asset&&!seen.has(asset.id)){seen.add(asset.id);result.push(asset)}}return result;
 },updateOnline:(id:string,patch:Partial<OnlineInfo>)=>{
  const asset=get(id);if(!asset)return;
  const ids=members(asset);
  // A result begun before a manual source change must never cross that binding.
  if(patch.url&&ids.some(member=>{const chosen=store.getRaw(member)?.manual.sourceUrl;return !!chosen&&canonicalSourceKey(chosen)!==canonicalSourceKey(patch.url!)}))return;
  for(const member of ids)store.updateOnline(member,patch);
 }};
}
