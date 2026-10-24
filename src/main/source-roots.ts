import path from 'node:path';
import fs from 'node:fs';
import {isWithin} from './safety';

/** Application-managed files and source scopes must never contain one another. */
export function assertSourceSeparation(dataDir:string,roots:string[],backupDir?:string):void {
  const aliases=(value:string)=>{const resolved=path.resolve(value);try{return [resolved,fs.realpathSync.native(resolved)]}catch{return [resolved]}};
  const managed=[...aliases(dataDir),...(backupDir?aliases(backupDir):[])];
  for(const root of roots)for(const source of aliases(root))if(managed.some(target=>isWithin(source,target)||isWithin(target,source)))throw new Error('素材目录受到保护，不能与资料库或备份位置互相包含。请将它们放在彼此独立的目录。');
}

export function sourcePathKey(value:string):string {const resolved=path.resolve(value);return process.platform==='win32'?resolved.toLowerCase():resolved}
/** Root scopes are metadata; validating them never enumerates source contents. */
export function normalizeSourceRoots(value:unknown,limit=1000):string[] {
  if(!Array.isArray(value)||value.length>limit||value.some(root=>typeof root!=='string'||!path.isAbsolute(root)||root.length>32767||/[\x00-\x1f]/.test(root)))throw new Error('素材根目录路径无效。');
  return [...new Map((value as string[]).map(root=>[sourcePathKey(root),path.resolve(root)])).values()];
}
/** A more specific re-added child may be active inside a detached parent.
 * A detached child restored under an active parent remains excluded. */
export function sourcePathActive(source:string,roots:string[],detachedRoots:string[]):boolean {
  const depth=(scopes:string[])=>Math.max(-1,...scopes.filter(root=>isWithin(source,root)).map(root=>sourcePathKey(root).length));
  const detached=depth(detachedRoots);return detached<0||depth(roots)>detached;
}

// Exact category labels only. Titled products such as "Hair Studio" stay bundles.
export function isSourceBucketName(name:string):boolean {
  return /^(?:衣服|服装|服裝|衣装|衣裝|服飾|衣類|衣装类|服装类|服裝類|发型|髮型|髪型|头发|頭髮|ヘア|身体|身體|素体|素體|ボディ|道具|小道具|配件|饰品|飾品|アクセサリー|clothes|clothing|outfits?|hair|hairstyles?|body|bodies|props?|accessories)$/i.test(name.normalize('NFKC').trim());
}
