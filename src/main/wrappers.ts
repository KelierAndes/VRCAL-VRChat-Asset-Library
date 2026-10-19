import fsp from 'node:fs/promises';
import path from 'node:path';
import {AssetRecord} from '../shared/contracts';
import {isAvatarName} from './hints';
import {isOrganizationalFolderName} from './organization';
import {canonicalCreator,creatorClue,extractBoothIds,boothProductId} from './matching';

export interface WrapperMetadata {contentRoot:string;chain:string[]}
export const wrapperPathKey=(value:string):string=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
const samePath=(a:string,b:string)=>wrapperPathKey(a)===wrapperPathKey(b);
const compact=(value:string)=>value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function isGenericWrapperName(value:string):boolean {
  return /^(?:\d+|downloads?|package|pack|assets|materials?|素材(?:包|包装)?|包装(?:文件夹)?|下载(?:文件夹)?|ダウンロード|新建文件夹|newfolder)$/i.test(compact(value));
}

/** Serialized evidence only: validation never probes the user's filesystem. */
export function validateWrapper(value:unknown,originalPath?:string):WrapperMetadata|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return;
  const candidate=value as Partial<WrapperMetadata>;
  const validPath=(entry:unknown):entry is string=>typeof entry==='string'&&entry.length>0&&entry.length<=32767&&!/[\x00-\x1f]/.test(entry)&&path.isAbsolute(entry)&&path.resolve(entry)===entry;
  if(!validPath(candidate.contentRoot)||!Array.isArray(candidate.chain)||candidate.chain.length<2||candidate.chain.length>32||!candidate.chain.every(validPath))return;
  const chain=candidate.chain;
  if(originalPath&&!samePath(chain[0],originalPath)||!samePath(chain.at(-1)!,candidate.contentRoot))return;
  for(let index=1;index<chain.length;index++)if(samePath(chain[index],chain[index-1])||!samePath(path.dirname(chain[index]),chain[index-1]))return;
  return {contentRoot:candidate.contentRoot,chain:[...chain]};
}

/** Explicit ID and author contradictions always win over structural evidence. */
function compatibleNames(names:string[]):boolean {
  const ids=new Set(names.flatMap(extractBoothIds)),authors=new Set(names.map(creatorClue).filter((v):v is string=>Boolean(v)).map(canonicalCreator));
  return ids.size<=1&&authors.size<=1;
}
export function wrapperCompatible(a:AssetRecord,b:AssetRecord):boolean {
  const names=[a.name,b.name,...(validateWrapper(a.wrapper,a.path)?.chain??[]).map(entry=>path.basename(entry)),...(validateWrapper(b.wrapper,b.path)?.chain??[]).map(entry=>path.basename(entry))];
  const ids=new Set(names.flatMap(extractBoothIds));
  for(const record of [a,b]){
    const manualId=boothProductId(record.manual.sourceUrl);if(manualId)ids.add(manualId);
    if(record.online.status==='matched'||record.online.confirmedSource){const id=boothProductId(record.online.url);if(id)ids.add(id)}
  }
  const verified=[a,b].filter(record=>record.online.status==='matched'||record.online.confirmedSource).map(record=>new Set([record.online.author,...(record.online.authorAliases??[])].filter((value):value is string=>Boolean(value)).map(canonicalCreator).filter(Boolean))).filter(group=>group.size>0);
  const named=names.map(creatorClue).filter((value):value is string=>Boolean(value)).map(canonicalCreator);
  // A verified display name and its aliases identify one creator. Expand a
  // filename author only through sets that explicitly contain that author;
  // unrelated filename or online creators must still have no intersection.
  const authors=[...verified,...named.map(author=>new Set([author,...verified.filter(group=>group.has(author)).flatMap(group=>[...group])]))];
  return ids.size<=1&&(!authors.length||[...authors[0]].some(author=>authors.every(group=>group.has(author))));
}
export function wrapperDisplayName(record:AssetRecord):string {
  const wrapper=validateWrapper(record.wrapper,record.path);
  return wrapper?[...wrapper.chain].reverse().map(entry=>path.basename(entry)).find(name=>!isGenericWrapperName(name))??record.name:record.name;
}
const PREVIEW=/^(?:preview(?:image)?|cover|thumbnail|サムネイル|封面|预览)(?:[-_ .()\d]|$)/i;
const DOC=/^(?:read[ _-]?me|説明(?:書)?|说明(?:书)?|credits?|licen[cs]e|利用規約|使用说明)(?:[-_ .()\d]|$)/i;
const ancillary=(name:string)=>DOC.test(name)&&(!path.extname(name)||/\.(?:txt|md|pdf|rtf|html?|url)$/i.test(name))||PREVIEW.test(name)&&/\.(?:png|jpe?g|webp|gif|bmp)$/i.test(name);
const boundaryName=(name:string)=>isAvatarName(name)||isOrganizationalFolderName(name)||/^(?:模型|通用$|优化$|轉模$|转模$|转膜$)/.test(name)||/^(?:assets|packages|projectsettings|library|temp|obj|logs|usersettings|\.git|node_modules)$/i.test(name);
async function project(directory:string):Promise<boolean>{return (await Promise.all(['Assets','Packages','ProjectSettings'].map(async name=>{try{const stat=await fsp.lstat(path.join(directory,name));return stat.isDirectory()&&!stat.isSymbolicLink()}catch{return false}}))).every(Boolean)}
async function safeContent(directory:string,cancelled:()=>boolean,depth=0,budget={remaining:5000}):Promise<boolean>{
  if(cancelled()||depth>24||budget.remaining--<=0||await project(directory))return false;
  try{for(const entry of await fsp.readdir(directory,{withFileTypes:true})){
    if(cancelled()||budget.remaining--<=0||entry.isSymbolicLink())return false;
    if(entry.isDirectory()&&!/^(?:library|temp|obj|logs|usersettings|\.git|\.svn|node_modules|\.vs|\.vscode|builds?)$/i.test(entry.name)&&!await safeContent(path.join(directory,entry.name),cancelled,depth+1,budget))return false;
  }return true}catch{return false}
}

/** Called during scans only. A wrapper has one unambiguous material branch. */
export async function discoverWrapper(source:string,cancelled:()=>boolean=()=>false):Promise<WrapperMetadata|undefined> {
  if(boundaryName(path.basename(source)))return;
  const chain=[path.resolve(source)],names=[path.basename(source)];
  for(let depth=0;depth<32;depth++){
    if(cancelled())return;
    const directory=chain.at(-1)!;
    try{
      const stat=await fsp.lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink()||await project(directory))return;
      const entries=await fsp.readdir(directory,{withFileTypes:true});if(entries.length>5000||entries.some(entry=>entry.isSymbolicLink()))return;
      const substantive=entries.filter(entry=>!entry.isFile()||!ancillary(entry.name));
      if(!substantive.length)return;
      if(!compatibleNames([...names,...substantive.map(entry=>entry.name)]))return;
      const folders=substantive.filter(entry=>entry.isDirectory());
      if(await Promise.all(folders.map(entry=>project(path.join(directory,entry.name)))).then(flags=>flags.some(Boolean)))return;
      if(substantive.length!==1||!substantive[0].isDirectory()){
        // Several arbitrary folders are ambiguous goods; avatar/Unity asset
        // variants are allowed as the terminal content of one material.
        if(folders.length>1&&folders.some(entry=>!isAvatarName(entry.name)&&!/^(?:assets|textures?|materials?|fbx|prefabs?)$/i.test(entry.name)))return;
        break;
      }
      const child=substantive[0],parentName=path.basename(directory);
      if(boundaryName(child.name))break;
      if(compact(parentName)!==compact(child.name)&&!isGenericWrapperName(parentName)&&!isGenericWrapperName(child.name))break;
      if(chain.length>=32)return;
      names.push(child.name);chain.push(path.join(directory,child.name));
    }catch{return}
  }
  return chain.length>1&&await safeContent(chain.at(-1)!,cancelled)?validateWrapper({contentRoot:chain.at(-1),chain},source):undefined;
}
