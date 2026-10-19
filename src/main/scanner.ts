import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {AssetKind,FileListing,ScanProgress,AvatarEvidence} from '../shared/contracts';
import {Store,assetId} from './store';
import {inferLocalCategory,inferAvatars,isAvatarName,extractUrls} from './hints';
import {copyCover,isWithin} from './safety';
import {readArchive} from './archive-reader';
import {isOrganizationalFolderName,isOrganizationalAsset} from './organization';
import {discoverWrapper,wrapperPathKey,isGenericWrapperName} from './wrappers';

const ARCHIVES=new Set(['.zip','.rar','.7z']);
const FILES=new Set(['.unitypackage','.fbx','.blend','.vrm','.obj','.psd','.spp','.png','.jpg','.jpeg','.webp','.gif','.bmp','.wav','.mp3','.anim']);
const CACHES=new Set(['library','temp','obj','logs','usersettings','.git','.svn','node_modules','.vs','.vscode','build','builds']);
const SOFTWARE=/^(?:unity(?:hub)?|vrchat[ _-]*creator[ _-]*companion|vrc[ _-]*companion)$/i;
const PREVIEW=/^(?:preview(?:image)?|cover|thumbnail|サムネイル|封面|预览)(?:[-_ .()\d]|$)/i;
const DOC=/(?:read[ _-]?me|説明|说明|booth|网址|url|credit|license|利用規約)/i;
const LIMIT=2000;
const pause=()=>new Promise<void>(resolve=>setImmediate(resolve));
type Metadata={size:number;urls:string[];preview?:string;localEvidence:AvatarEvidence[];compatibilityComplete:boolean;localNameHints:string[]};
const EVIDENCE_FILE=/\.(?:zip|rar|7z|unitypackage|fbx|blend|vrm|obj|prefab|mat|anim|controller|png|jpe?g|webp|psd|spp)$/i;

export class Scanner {
  private state:ScanProgress={running:false,found:0,current:'',errors:[]};
  private cancelled=false;
  private scanAbort=new AbortController();
  private active:Promise<void>|null=null;
  private archiveCache=new Map<string,{size:number;mtimeMs:number;listing:FileListing}>();
  constructor(private store:Store,private onProgress?:(progress:ScanProgress)=>void){}
  progress():ScanProgress{return {...this.state,errors:[...this.state.errors]}}
  cancel():void {this.cancelled=true;this.scanAbort.abort()}
  async waitIdle():Promise<void>{if(this.active)await this.active}
  private emit():void {this.onProgress?.(this.progress())}
  scan():Promise<void>{
    if(this.active)return this.active;
    this.cancelled=false;this.scanAbort=new AbortController();this.state={running:true,found:0,current:'',errors:[]};this.emit();
    this.active=this.run().finally(()=>{this.state.running=false;this.state.current=this.cancelled?'扫描已取消':'';this.state.finishedAt=new Date().toISOString();this.active=null;this.emit()});
    return this.active;
  }
  private error(location:string,error:unknown):void {if(this.state.errors.length<100)this.state.errors.push(`${location}：${error instanceof Error?error.message:String(error)}`);this.emit()}
  private async project(directory:string):Promise<boolean>{
    const flags=await Promise.all(['Assets','Packages','ProjectSettings'].map(async name=>{try{const stat=await fsp.lstat(path.join(directory,name));return stat.isDirectory()&&!stat.isSymbolicLink()}catch{return false}}));return flags.every(Boolean);
  }
  private async archiveEvidence(source:string,stat:fs.Stats):Promise<FileListing>{
    const cached=this.archiveCache.get(source);if(cached?.size===stat.size&&cached.mtimeMs===stat.mtimeMs)return cached.listing;
    const extension=path.extname(source).toLowerCase();
    const listing=await readArchive(source,this.store.settings().roots,{limit:1000,maxBytes:32*1024*1024,maxTime:2000,signal:this.scanAbort.signal});
    if(this.archiveCache.size>=300)this.archiveCache.delete(this.archiveCache.keys().next().value!);
    this.archiveCache.set(source,{size:stat.size,mtimeMs:stat.mtimeMs,listing});return listing;
  }
  private async metadata(directory:string,hintRoot=directory):Promise<Metadata>{
    let size=0,count=0,docs=0,archives=0,complete=true;const urls=new Set<string>(),nameHints=new Set<string>();let preview:string|undefined;
    const evidence=new Map<string,AvatarEvidence>();
    const addEvidence=(name:string,file:string,basis:AvatarEvidence['basis'])=>{
      for(const avatar of inferAvatars(name)){const key=`${avatar}:${basis}`,entry=evidence.get(key)??{avatar,files:[],basis};if(entry.files.length<80&&!entry.files.includes(file))entry.files.push(file);evidence.set(key,entry)}
    };
    addEvidence(path.basename(directory),directory,'filename');
    const visit=async(location:string,depth:number,hintScope=true)=>{
      if(this.cancelled||count>=5000||depth>10){complete=false;return}
      let entries;try{entries=await fsp.readdir(location,{withFileTypes:true})}catch{complete=false;return}
      const hintDepth=isWithin(location,hintRoot)?path.relative(hintRoot,location).split(path.sep).filter(Boolean).length:-1;
      for(const entry of entries){if(this.cancelled||count++>=5000){complete=false;break}if(entry.isSymbolicLink()){complete=false;continue}const source=path.join(location,entry.name);
        if(entry.isDirectory()){
          if(CACHES.has(entry.name.toLowerCase())||SOFTWARE.test(entry.name))continue;
          if(await this.project(source)){complete=false;continue}
          const childHintScope=hintScope&&!['assets','packages','projectsettings'].includes(entry.name.toLowerCase());
          if(childHintScope&&hintDepth>=0&&hintDepth<2&&nameHints.size<20)nameHints.add(entry.name);
          addEvidence(entry.name,source,'filename');await visit(source,depth+1,childHintScope);continue;
        }
        if(!entry.isFile())continue;
        try{const stat=await fsp.stat(source);size+=stat.size;
          if(hintScope&&hintDepth>=0&&hintDepth<2&&nameHints.size<20&&(ARCHIVES.has(path.extname(entry.name).toLowerCase())||path.extname(entry.name).toLowerCase()==='.unitypackage'))nameHints.add(entry.name);
          if(EVIDENCE_FILE.test(entry.name)&&!PREVIEW.test(entry.name))addEvidence(entry.name,source,'filename');
          if(!preview&&PREVIEW.test(entry.name)&&/\.(png|jpe?g|webp|gif|bmp)$/i.test(entry.name)&&stat.size<25*1024*1024)preview=source;
          if(docs<12&&DOC.test(entry.name)&&/\.(txt|md|url|html?)$/i.test(entry.name)&&stat.size<128*1024){docs++;for(const url of extractUrls(await fsp.readFile(source,'utf8')))urls.add(url)}
          if((ARCHIVES.has(path.extname(entry.name).toLowerCase())||path.extname(entry.name).toLowerCase()==='.unitypackage')&&!inferAvatars(entry.name).length){
            if(archives++>=16){complete=false;continue}
            try{const listing=await this.archiveEvidence(source,stat);if(listing.truncated||!listing.entries.length)complete=false;for(const file of listing.entries)if(file.directory||(EVIDENCE_FILE.test(file.name)&&!PREVIEW.test(path.posix.basename(file.name.replace(/\\/g,'/')))))addEvidence(file.name,`${source}!/${file.name}`,'archive-entry')}catch{complete=false}
          }
        }catch{complete=false}
        if(count%100===0)await pause();
      }
    };
    await visit(directory,0);return {size,urls:[...urls].slice(0,20),preview,localEvidence:[...evidence.values()],compatibilityComplete:complete&&evidence.size>0,localNameHints:[...nameHints]};
  }
  private async add(source:string,group:string,seen:Set<string>,excluded:string[],project=false):Promise<void>{
    if(this.cancelled)return;
    this.state.current=source;
    try{
      const stat=await fsp.lstat(source);if(stat.isSymbolicLink()){excluded.push(source);return}
      if(stat.isDirectory()&&!project&&isOrganizationalFolderName(path.basename(source))){await this.container(source,group,seen,excluded);return}
      const identityStat=await fsp.lstat(source,{bigint:true}),fileIdentity=identityStat.ino>0n&&identityStat.birthtimeNs>0n?{device:identityStat.dev.toString(),inode:identityStat.ino.toString(),birthtime:identityStat.birthtimeNs.toString()}:undefined;
      const extension=path.extname(source).toLowerCase();
      const kind:AssetKind=project?'unity-project':stat.isDirectory()?'folder':extension==='.unitypackage'?'unitypackage':ARCHIVES.has(extension)?'archive':'file';
      if(isOrganizationalAsset({path:source,name:path.basename(source),kind}))return;
      const wrapper=stat.isDirectory()&&!project?await discoverWrapper(source,()=>this.cancelled):undefined;
      const name=path.basename(source),details:Metadata=stat.isDirectory()&&!project?await this.metadata(source,wrapper?.contentRoot):{size:stat.isFile()?stat.size:0,urls:[],localEvidence:inferAvatars(name).map(avatar=>({avatar,files:[source],basis:'filename'})),compatibilityComplete:inferAvatars(name).length>0,localNameHints:[]};
      if(wrapper)details.localNameHints=[...new Set([...wrapper.chain.slice(1).map(entry=>path.basename(entry)).filter(name=>!isGenericWrapperName(name)),...details.localNameHints])].slice(0,20);
      if(!stat.isDirectory()&&(ARCHIVES.has(extension)||extension==='.unitypackage')&&!details.localEvidence.length){
        try{const listing=await this.archiveEvidence(source,stat);for(const file of listing.entries)if(file.directory||(EVIDENCE_FILE.test(file.name)&&!PREVIEW.test(path.posix.basename(file.name.replace(/\\/g,'/')))))for(const avatar of inferAvatars(file.name)){const entry=details.localEvidence.find(e=>e.avatar===avatar)??{avatar,files:[],basis:'archive-entry' as const};if(entry.files.length<80)entry.files.push(`${source}!/${file.name}`);if(!details.localEvidence.includes(entry))details.localEvidence.push(entry)}details.compatibilityComplete=!listing.truncated&&listing.entries.length>0&&details.localEvidence.length>0}catch{details.compatibilityComplete=false}
      }
      if(this.cancelled)return;
      let previewFile:string|undefined;
      if(stat.isFile()&&/\.(png|jpe?g|webp|gif|bmp)$/i.test(name)&&stat.size<=25*1024*1024)details.preview=source;
      if(details.preview)try{previewFile=await copyCover(details.preview,this.store.dataDir,this.store.settings().roots)}catch{/* previews never make a source unreadable */}
      if(this.cancelled)return;
      const record=this.store.upsertScan({path:source,name,group,kind,size:stat.isDirectory()?0:details.size,mtimeMs:stat.mtimeMs,localCategory:project?'工程':inferLocalCategory(name,details.localNameHints),localAvatars:[...new Set(details.localEvidence.map(entry=>entry.avatar))],localEvidence:details.localEvidence,compatibilityComplete:details.compatibilityComplete,hintUrls:details.urls,localNameHints:details.localNameHints,fileIdentity,previewFile,wrapper});
      seen.add(record.id);this.state.found++;this.emit();await pause();
    }catch(error){excluded.push(source);this.error(source,error)}
  }
  private async container(directory:string,group:string,seen:Set<string>,excluded:string[],depth=0,budget={remaining:5000}):Promise<void>{
    if(this.cancelled)return;if(depth>32||budget.remaining--<=0){excluded.push(directory);return}
    try{for(const entry of await fsp.readdir(directory,{withFileTypes:true})){
      if(this.cancelled)return;if(budget.remaining--<=0){excluded.push(directory);break}const source=path.join(directory,entry.name),extension=path.extname(entry.name).toLowerCase();
      if(entry.isSymbolicLink()||CACHES.has(entry.name.toLowerCase())||SOFTWARE.test(entry.name)){excluded.push(source);continue}
      if(entry.isDirectory()){
        if(await this.project(source)){await this.add(source,group,seen,excluded,true);continue}
        if(['assets','packages','projectsettings'].includes(entry.name.toLowerCase())){excluded.push(source);continue}
        if(isOrganizationalFolderName(entry.name)||/^(?:textures?|貼圖|贴图|纹理)$/i.test(entry.name)){await this.container(source,group,seen,excluded,depth+1,budget);continue}
        if(/^(?:模型|通用$|优化$|轉模$|转模$|转膜$)/.test(entry.name)||isAvatarName(entry.name)){await this.container(source,entry.name,seen,excluded,depth+1,budget);continue}
        const nested=await this.discoverProjects(source,excluded);
        if(nested.projects.length){for(const project of nested.projects)await this.add(project,group,seen,excluded,true);for(const archive of nested.archives)await this.add(archive,group,seen,excluded)}
        else await this.add(source,group,seen,excluded);
      }else if(entry.isFile()&&(ARCHIVES.has(extension)||FILES.has(extension)&&!['.psd','.png','.jpg','.jpeg','.webp','.gif','.bmp'].includes(extension)))await this.add(source,group,seen,excluded);
    }}catch(error){excluded.push(directory);this.error(directory,error)}
  }
  private async projectTree(directory:string,group:string,seen:Set<string>,excluded:string[],depth=0):Promise<void>{
    if(this.cancelled)return;if(depth>32){excluded.push(directory);return}
    if(await this.project(directory)){await this.add(directory,group,seen,excluded,true);return}
    try{
      for(const entry of await fsp.readdir(directory,{withFileTypes:true})){
        if(this.cancelled)return;const source=path.join(directory,entry.name);
        if(entry.isSymbolicLink()||CACHES.has(entry.name.toLowerCase())||SOFTWARE.test(entry.name)){excluded.push(source);continue}
        if(entry.isDirectory())await this.projectTree(source,group,seen,excluded,depth+1);
        else if(entry.isFile()&&(ARCHIVES.has(path.extname(entry.name).toLowerCase())||path.extname(entry.name).toLowerCase()==='.unitypackage'))await this.add(source,group,seen,excluded);
      }
    }catch(error){excluded.push(directory);this.error(directory,error)}
  }
  private async group(directory:string,group:string,seen:Set<string>,excluded:string[]):Promise<void>{
    try{for(const entry of await fsp.readdir(directory,{withFileTypes:true})){
      if(this.cancelled)return;const source=path.join(directory,entry.name),extension=path.extname(entry.name).toLowerCase();
      if(entry.isSymbolicLink()||CACHES.has(entry.name.toLowerCase())||SOFTWARE.test(entry.name)){excluded.push(source);continue}
      if(entry.isDirectory())await this.add(source,group,seen,excluded,await this.project(source));
      else if(entry.isFile()&&(ARCHIVES.has(extension)||FILES.has(extension)))await this.add(source,group,seen,excluded);
    }}catch(error){excluded.push(directory);this.error(directory,error)}
  }
  private async discoverProjects(directory:string,excluded:string[],depth=0,budget={remaining:5000}):Promise<{projects:string[];archives:string[]}>{
    const result={projects:[] as string[],archives:[] as string[]};
    if(this.cancelled)return result;
    if(depth>24||budget.remaining--<=0){excluded.push(directory);return result}
    if(await this.project(directory)){result.projects.push(directory);return result}
    try{
      const entries=await fsp.readdir(directory,{withFileTypes:true});
      for(const entry of entries){
        if(this.cancelled)return result;const source=path.join(directory,entry.name);
        // A downloaded package's internal Assets hierarchy stays aggregated.
        // A full Unity project was already detected before these exclusions.
        if(entry.isSymbolicLink()||CACHES.has(entry.name.toLowerCase())||SOFTWARE.test(entry.name)||['assets','packages','projectsettings'].includes(entry.name.toLowerCase())){excluded.push(source);continue}
        if(entry.isDirectory()){const child=await this.discoverProjects(source,excluded,depth+1,budget);result.projects.push(...child.projects);result.archives.push(...child.archives)}
      }
      if(result.projects.length)for(const entry of entries)if(entry.isFile()&&(ARCHIVES.has(path.extname(entry.name).toLowerCase())||path.extname(entry.name).toLowerCase()==='.unitypackage'))result.archives.push(path.join(directory,entry.name));
    }catch(error){excluded.push(directory);this.error(directory,error)}
    return result;
  }
  private async run():Promise<void>{
    // Nested roots share one read pass. A child root must not mark its own outer
    // aggregation card missing simply because it enumerates only its children.
    const roots=[...new Map(this.store.settings().roots.map(root=>[process.platform==='win32'?path.resolve(root).toLowerCase():path.resolve(root),root])).values()];
    const outerRoots=roots.filter(root=>!roots.some(other=>other!==root&&isWithin(root,other)));
    for(const root of outerRoots){
      if(this.cancelled)break;const seen=new Set<string>(),excluded:string[]=[];
      try{
        const stat=await fsp.lstat(root);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('素材根目录不是普通文件夹，目录链接不会扫描。');
        if(await this.project(root))await this.add(root,path.basename(root),seen,excluded,true);
        else if(isOrganizationalFolderName(path.basename(root)))await this.container(root,path.basename(root),seen,excluded);
        else for(const entry of await fsp.readdir(root,{withFileTypes:true})){
          if(this.cancelled)break;const source=path.join(root,entry.name),extension=path.extname(entry.name).toLowerCase();
          if(entry.isSymbolicLink()||CACHES.has(entry.name.toLowerCase())||SOFTWARE.test(entry.name)){excluded.push(source);continue}
          if(entry.isDirectory()){
            if(await this.project(source))await this.add(source,path.basename(root),seen,excluded,true);
            else if(entry.name==='改模')await this.projectTree(source,entry.name,seen,excluded);
            else if(/^(?:模型|通用$|优化$|轉模$|转模$|转膜$)/.test(entry.name)||isAvatarName(entry.name))await this.group(source,entry.name,seen,excluded);
            else {
              const discovered=await this.discoverProjects(source,excluded);
              if(discovered.projects.length){for(const project of discovered.projects)await this.add(project,entry.name,seen,excluded,true);for(const archive of discovered.archives)await this.add(archive,entry.name,seen,excluded)}
              else await this.add(source,path.basename(root),seen,excluded);
            }
          }else if(entry.isFile()&&(ARCHIVES.has(extension)||FILES.has(extension)))await this.add(source,path.basename(root),seen,excluded);
        }
        if(!this.cancelled){await this.preserveContainedRows(root,seen,excluded);this.store.markScanMissing(root,seen,excluded)}
      }catch(error){this.error(root,error)}
    }
  }
  private async preserveContainedRows(root:string,seen:Set<string>,excluded:string[]):Promise<void>{
    const records=this.store.all(),parents=records.filter(record=>seen.has(record.id)&&record.kind==='folder');
    for(const record of records){
      if(this.cancelled)return;
      if(seen.has(record.id)||!isWithin(record.path,root))continue;
      const parent=parents.find(parent=>parent.path!==record.path&&isWithin(record.path,parent.path));if(!parent)continue;
      // Old nested-root scans can leave raw rows below an aggregate folder.
      // Probe only those already-known paths; never invent relationships from
      // a recursive read or mark a live, unproven child as missing.
      const relative=path.relative(parent.path,record.path).split(path.sep);if(relative.length>64){excluded.push(record.path);continue}
      let current=parent.path,live=true,unknown=false;
      try{for(const part of relative){current=path.join(current,part);const stat=await fsp.lstat(current);if(stat.isSymbolicLink()){live=false;unknown=true;break}}}catch(error:any){live=false;unknown=!['ENOENT','ENOTDIR'].includes(error.code)}
      if(live){seen.add(record.id);this.store.updateAvailability(record.id,false)}
      else if(unknown)excluded.push(record.path);
    }
  }
  async files(id:string,extraReadRoots:string[]=[]):Promise<FileListing>{
    const asset=this.store.get(id);if(!asset)throw new Error('素材不存在。');
    const readRoots=[...this.store.settings().roots,...extraReadRoots];
    const allMembers=asset.members??[{id:asset.id,path:asset.path,name:asset.name,kind:asset.kind,missing:asset.missing}],members=allMembers.filter((member,index)=>!allMembers.some((parent,parentIndex)=>!parent.missing&&(wrapperPathKey(member.path)===wrapperPathKey(parent.path)?parentIndex<index:parent.kind==='folder'&&isWithin(member.path,parent.path)))),entries:FileListing['entries']=[];let truncated=false;
    const messages:string[]=[];
    for(const member of members){
      if(member.missing){messages.push(`${member.name}：本地文件缺失。`);continue}
      if(!readRoots.some(root=>isWithin(member.path,root)))throw new Error('素材路径不在已登记的根目录内。');
      try{
        const stat=await fsp.lstat(member.path);if(stat.isSymbolicLink())throw new Error('目录链接不会展开。');
        const extension=path.extname(member.path).toLowerCase();
        const listing=stat.isDirectory()?await directoryFiles(member.path):['.zip','.unitypackage','.rar','.7z'].includes(extension)?await readArchive(member.path,readRoots,{limit:LIMIT,maxBytes:128*1024*1024,maxTime:30000}):{entries:[{name:member.name,size:stat.size,directory:false}],truncated:false};
        const prefix=members.length>1?member.name+'/':'';
        for(const entry of listing.entries){if(entries.length>=LIMIT){truncated=true;break}entries.push({...entry,name:prefix+entry.name})}
        truncated||=listing.truncated;if(listing.message)messages.push(listing.message);
      }catch(error){messages.push(`${member.name}：${error instanceof Error?error.message:'内容无法读取。'}`)}
      if(entries.length>=LIMIT){truncated=true;break}
    }
    return {entries,truncated,message:[...new Set(messages)].join(' ')};
  }
}

async function directoryFiles(root:string):Promise<FileListing>{
  const entries:FileListing['entries']=[];let truncated=false,unreadable=0;
  const visit=async(directory:string,depth:number)=>{
    if(entries.length>=LIMIT||depth>12){truncated=true;return}
    let children;try{children=await fsp.readdir(directory,{withFileTypes:true})}catch{unreadable++;return}
    for(const child of children){if(entries.length>=LIMIT){truncated=true;break}if(child.isSymbolicLink()||CACHES.has(child.name.toLowerCase()))continue;
      const source=path.join(directory,child.name);if(child.isDirectory()){entries.push({name:path.relative(root,source),size:0,directory:true});await visit(source,depth+1)}
      else if(child.isFile())try{entries.push({name:path.relative(root,source),size:(await fsp.stat(source)).size,directory:false})}catch{unreadable++}
    }
  };
  await visit(root,0);return {entries,truncated,message:unreadable?'部分文件无法读取；Unity 缓存与目录链接已跳过。':'Unity 缓存与目录链接已跳过。'};
}
