import type {AssetRecord,LocalMember} from '../shared/contracts';
/** Include wrapper directories even when they never had a separate database row. */
export function localFiles(asset:AssetRecord):LocalMember[]{
 const files:LocalMember[]=[...(asset.members?.length?asset.members:[asset])];
 const seen=new Set(files.map(file=>file.path.toLowerCase()));
 for(const folder of asset.wrapper?.chain||[]){
  if(seen.has(folder.toLowerCase()))continue;seen.add(folder.toLowerCase());
  files.push({id:asset.id,path:folder,name:folder.split(/[\\/]/).filter(Boolean).at(-1)||folder,kind:'folder',missing:asset.missing});
 }return files;
}
