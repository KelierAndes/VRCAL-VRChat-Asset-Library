import fsp from 'node:fs/promises';
import path from 'node:path';
import type {AssetRecord} from '../shared/contracts';
import type {Store} from './store';
import {validateProject} from './project-access';
import {isWithin} from './safety';
import {assertSourceSeparation,sourcePathKey} from './source-roots';

/** Register only a project explicitly selected by the user; readiness never widens source access. */
export async function registerProject(store:Store,input:unknown,beforeCommit:()=>void):Promise<AssetRecord|null>{
 if(typeof input!=='string'||!path.isAbsolute(input)||input.length>32767||/[\x00-\x1f]/.test(input))throw new Error('请选择本机 Unity 工程文件夹。');
 const selected=path.resolve(input);
 await validateProject({kind:'unity-project',path:selected} as AssetRecord,[selected]);
 assertSourceSeparation(store.dataDir,[selected],store.settings().backupDir);
 const stat=await fsp.lstat(selected);
 beforeCommit();
 const roots=store.settings().roots;
 // Active means "not detached", which also includes paths outside every source root.
 if(!roots.some(root=>isWithin(selected,root))||!store.isPathActive(selected))store.saveSettings({roots:[...roots.filter(root=>!isWithin(root,selected)),selected]});
 const existing=store.all().find(asset=>sourcePathKey(asset.path)===sourcePathKey(selected));
 if(existing?.kind==='unity-project'){
  store.updateAvailability(existing.id,false,existing);
  return store.get(existing.id);
 }
 return store.upsertScan({path:selected,name:path.basename(selected),kind:'unity-project',group:path.basename(path.dirname(selected)),size:0,mtimeMs:stat.mtimeMs,localCategory:'工程',localAvatars:[],hintUrls:[]});
}
