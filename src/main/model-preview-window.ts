import {BrowserWindow,ipcMain,session} from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {isWithin} from './safety';
import {noLinks} from './project-access';
import {readModelIndex,readModelScene} from './model-preview-reader';
import type {ModelSource} from './model-preview-files';
import type {ModelChoice,ModelPreviewState,ModelReferenceSource,ModelReferenceState} from '../shared/model-preview';
import {THEME_BACKGROUNDS,displayTitle,displayCategory,type AssetRecord,type AppTheme} from '../shared/contracts';

interface Dependencies {parent:()=>BrowserWindow|null;theme:()=>AppTheme;available:()=>boolean;validate:(id:string)=>{asset:AssetRecord;roots:string[]};candidates?:()=>AssetRecord[]}
interface Scope {path:string;directory:boolean}
interface Slot {id:string;kind:AssetRecord['kind'];title:string;paths:string[];scopes:Scope[];choices:Map<string,ModelSource>;warnings:string[]}
const MAX_SOURCES=16,MAX_CHOICES=200,INDEX_TIMEOUT=45000;
const eligible=(asset:AssetRecord)=>!asset.missing&&!asset.manual.hidden&&!asset.recycledAt&&asset.storage?.kind!=='cloud';
const assetPaths=(asset:AssetRecord)=>[...new Set([asset.path,...(asset.members||[]).filter(m=>!m.missing).map(m=>m.path)])].slice(0,MAX_SOURCES);
const comparable=(value:string)=>process.platform==='win32'?path.resolve(value).toLowerCase():path.resolve(value);
const samePath=(a:string,b:string)=>comparable(a)===comparable(b);
const abortError=(signal:AbortSignal)=>signal.reason instanceof Error?signal.reason:new Error('预览已取消。');
function checked(signal:AbortSignal){if(signal.aborted)throw abortError(signal)}
function cancellable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{
 const abort=()=>{signal.removeEventListener('abort',abort);reject(abortError(signal))};
 signal.addEventListener('abort',abort,{once:true});promise.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(abortError(signal));else resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)});if(signal.aborted)abort();
})}
const publicChoices=(slot:Slot):ModelChoice[]=>[...slot.choices].map(([token,m])=>({token,label:m.label,name:m.name,format:m.format,size:m.size}));
async function authorize(asset:AssetRecord,roots:string[]):Promise<Scope[]>{
 if(!eligible(asset))throw new Error('请选择当前资料库中可读取的本地素材。');const result:Scope[]=[];
 for(const source of assetPaths(asset)){
  if(!roots.some(root=>isWithin(source,root)))throw new Error('素材不在当前已授权的读取范围内。');await noLinks(source);
  const input=asset.kind==='unity-project'?path.join(source,'Assets'):source;if(!roots.some(root=>isWithin(input,root)))throw new Error('素材不在当前已授权的读取范围内。');await noLinks(input);
  result.push({path:input,directory:(await fsp.lstat(input)).isDirectory()});
 }return result;
}
function makeSlot(id:string,asset:AssetRecord,scopes:Scope[]):Slot{return {id,kind:asset.kind,title:displayTitle(asset),paths:assetPaths(asset),scopes,choices:new Map(),warnings:[...new Set([asset.path,...(asset.members||[]).filter(m=>!m.missing).map(m=>m.path)])].length>MAX_SOURCES?['每个素材最多读取 16 个来源，请选择较小的素材组。']:[]}}
async function indexSlot(slot:Slot,controller:AbortController,still:()=>boolean):Promise<ModelReferenceState>{
 const timer=setTimeout(()=>controller.abort(new Error('模型索引超过 45 秒，请选择较小的素材目录。')),INDEX_TIMEOUT),seen=new Set<string>();let sourceCount=0;
 try{for(const scope of slot.scopes){if(sourceCount>=MAX_SOURCES){slot.warnings.push('每个素材最多读取 16 个来源，部分素材来源已跳过。');break}checked(controller.signal);if(!still())throw new Error('预览请求已失效。');const current=await cancellable(readModelIndex(scope.path,controller.signal,MAX_SOURCES-sourceCount),controller.signal);checked(controller.signal);if(!still())throw new Error('预览请求已失效。');slot.warnings.push(...current.warnings);sourceCount+=Math.max(1,Math.min(MAX_SOURCES,Number.isSafeInteger(current.sourceCount)?current.sourceCount!:1));
   for(const model of current.models){if(!slot.scopes.some(s=>samePath(model.source,s.path)||s.directory&&isWithin(model.source,s.path)))throw new Error('模型超出当前素材读取范围。');const key=model.source.toLowerCase()+'|'+model.key.toLowerCase();if(seen.has(key))continue;seen.add(key);slot.choices.set(randomUUID(),model);if(slot.choices.size>=MAX_CHOICES){slot.warnings.push('每个素材最多展示 200 个模型，请选择更小的素材目录。');break}}
   if(slot.choices.size>=MAX_CHOICES)break;
  }return {title:slot.title,choices:publicChoices(slot),warnings:[...new Set(slot.warnings)].slice(0,30)};
 }finally{clearTimeout(timer)}
}
export class ModelPreviewWindow {
 private window?:BrowserWindow;private generation=0;private reading?:AbortController;
 constructor(private deps:Dependencies){}
 close(){this.generation++;this.reading?.abort();if(this.window&&!this.window.isDestroyed())this.window.destroy();this.window=undefined}
 async open(id:string):Promise<void>{
  this.close();const generation=this.generation,{asset,roots}=this.deps.validate(id),scopes=await authorize(asset,roots);
  if(generation!==this.generation||!this.deps.available())return;
  const validateCurrent=(slot:Slot,model?:ModelSource)=>{
   const current=this.deps.validate(slot.id),paths=assetPaths(current.asset);if(!eligible(current.asset)||current.asset.kind!==slot.kind||slot.paths.length!==paths.length||!slot.paths.every(p=>paths.some(q=>samePath(p,q))))throw new Error('素材位置或可用状态已变化，请重新打开预览。');
   for(const source of paths){if(!current.roots.some(root=>isWithin(source,root)))throw new Error('素材不在当前已授权的读取范围内。');const input=current.asset.kind==='unity-project'?path.join(source,'Assets'):source;if(!current.roots.some(root=>isWithin(input,root)))throw new Error('素材不在当前已授权的读取范围内。')}
   if(model&&!slot.scopes.some(s=>samePath(model.source,s.path)||s.directory&&isWithin(model.source,s.path)))throw new Error('模型不在当前已授权的读取范围内。');return current;
  };
  const primary=makeSlot(id,asset,scopes);validateCurrent(primary);
  const channel='vrc-model:'+randomUUID(),partition=session.fromPartition(channel),rendererRoot=path.resolve(__dirname,'../../renderer'),page=path.join(rendererRoot,'model-preview.html'),pageUrl=pathToFileURL(page).href;
  partition.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));partition.setPermissionCheckHandler(()=>false);
  partition.webRequest.onBeforeRequest((request,callback)=>{let allowed=false;try{allowed=request.url.startsWith('file:')&&isWithin(fileURLToPath(request.url),rendererRoot)||request.url.startsWith('blob:')||request.url.startsWith('data:')}catch{}callback({cancel:!allowed})});
  partition.on('will-download',event=>event.preventDefault());
  const win=new BrowserWindow({parent:this.deps.parent()||undefined,width:1120,height:800,minWidth:560,minHeight:480,title:`3D 预览 · ${displayTitle(asset)}`,backgroundColor:THEME_BACKGROUNDS[this.deps.theme()],show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'model-preview-preload.js'),additionalArguments:['--vrc-model-channel='+channel],session:partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
  this.window=win;const contents=win.webContents,controller=new AbortController();this.reading=controller;
  let loading:AbortController|undefined,referenceIndex:AbortController|undefined,referencePending=false,referenceRevision=0,reference:Slot|undefined,referenceState:Promise<ModelReferenceState>|undefined;
  const active=()=>!controller.signal.aborted&&this.window===win&&!win.isDestroyed()&&this.deps.available();
  const cancelLoad=()=>{loading?.abort();loading=undefined};
  const cancelReference=()=>{referenceIndex?.abort();referenceIndex=undefined;referencePending=false;referenceRevision++;reference=undefined;referenceState=undefined};
  const abort=()=>{cancelLoad();cancelReference()};controller.signal.addEventListener('abort',abort,{once:true});
  const primaryIndex=new AbortController(),abortPrimary=()=>primaryIndex.abort();controller.signal.addEventListener('abort',abortPrimary,{once:true});
  const state:Promise<ModelPreviewState>=indexSlot(primary,primaryIndex,()=>{validateCurrent(primary);return active()}).then(value=>({...value,title:primary.title,theme:this.deps.theme()}));void state.catch(()=>{});
  const candidates=(query:unknown):ModelReferenceSource[]=>{
   if(query!==undefined&&typeof query!=='string')throw new Error('搜索内容无效。');const text=(query||'').toString().slice(0,300).normalize('NFKC').toLocaleLowerCase();
   return (this.deps.candidates?.()||[]).filter(eligible).filter(a=>!text||[displayTitle(a),a.name].some(v=>v.normalize('NFKC').toLocaleLowerCase().includes(text))).filter(a=>{try{validateCurrent(makeSlot(a.id,a,[]));return true}catch{return false}}).sort((a,b)=>Number(displayCategory(b)==='模型')-Number(displayCategory(a)==='模型')||displayTitle(a).localeCompare(displayTitle(b),'zh-CN')).slice(0,100).map(a=>({id:a.id,title:displayTitle(a)}));
  };
  const selectReference=(value:unknown):Promise<ModelReferenceState>=>{
   cancelLoad();cancelReference();if(value===null)return Promise.resolve({choices:[],warnings:[]});
   if(typeof value!=='string'||!(this.deps.candidates?.()||[]).some(a=>a.id===value&&eligible(a)))return Promise.reject(new Error('请选择当前资料库中的本地角色素材。'));
   const revision=referenceRevision,task=new AbortController();referenceIndex=task;referencePending=true;
   const still=()=>active()&&!task.signal.aborted&&revision===referenceRevision;
   const promise=(async()=>{const current=this.deps.validate(value),authorized=await authorize(current.asset,current.roots);checked(task.signal);if(!still())throw new Error('角色选择已取消。');const slot=makeSlot(value,current.asset,authorized);validateCurrent(slot);reference=slot;return indexSlot(slot,task,()=>{validateCurrent(slot);return still()})})().finally(()=>{if(referenceIndex===task)referencePending=false});referenceState=promise;void promise.catch(()=>{});return promise;
  };
  const validateSlot=async(slot:Slot,model:ModelSource)=>{
   const current=validateCurrent(slot,model);
   const authorized=await authorize(current.asset,current.roots);if(!authorized.some(s=>samePath(model.source,s.path)||s.directory&&isWithin(model.source,s.path)))throw new Error('模型不在当前已授权的读取范围内。');await noLinks(model.source);
  };
  const load=async(primaryToken:unknown,referenceToken:unknown,single:boolean)=>{
   cancelLoad();const task=new AbortController();loading=task;const revision=referenceRevision,refState=referenceState,cancel=()=>task.abort();controller.signal.addEventListener('abort',cancel,{once:true});
   const check=()=>{checked(task.signal);if(!active()||loading!==task||revision!==referenceRevision)throw new Error('预览已取消。')};
   try{await cancellable(state,task.signal);check();if(typeof primaryToken!=='string'||!primary.choices.has(primaryToken))throw new Error('请选择当前列表中的模型。');
    if(referenceToken!==undefined){if(typeof referenceToken!=='string'||!refState)throw new Error('请选择当前角色列表中的模型。');await cancellable(refState,task.signal);check()}
    const model=primary.choices.get(primaryToken)!,refModel=referenceToken===undefined?undefined:reference?.choices.get(referenceToken as string),refSlot=reference;
    if(referenceToken!==undefined&&!refModel)throw new Error('请选择当前角色列表中的模型。');await validateSlot(primary,model);check();if(refModel&&refSlot){await validateSlot(refSlot,refModel);check()}
    validateCurrent(primary,model);if(refModel&&refSlot)validateCurrent(refSlot,refModel);check();
    const result=await cancellable(readModelScene(model,refModel,task.signal),task.signal);check();await validateSlot(primary,model);check();if(refModel&&refSlot){await validateSlot(refSlot,refModel);check()}validateCurrent(primary,model);if(refModel&&refSlot)validateCurrent(refSlot,refModel);check();return single?result.primary:result;
   }finally{controller.signal.removeEventListener('abort',cancel);if(loading===task)loading=undefined}
  };
  ipcMain.handle(channel,async(event,action:unknown,value:unknown,referenceToken:unknown)=>{
   if(!active()||event.sender!==contents||event.senderFrame!==contents.mainFrame||event.senderFrame.url!==pageUrl)throw new Error('预览请求已失效。');
   if(action==='state'){const result=await state;if(!active())throw new Error('预览请求已失效。');return result}
   if(action==='sources')return candidates(value);
   if(action==='selectReference')return selectReference(value);
   if(action==='cancel'){cancelLoad();if(referencePending)cancelReference();return}
   if(action==='load'||action==='loadScene')return load(value,action==='load'?undefined:referenceToken,action==='load');
   throw new Error('预览操作无效。');
  });
  contents.setWindowOpenHandler(()=>({action:'deny'}));contents.on('will-navigate',event=>event.preventDefault());contents.on('will-attach-webview',event=>event.preventDefault());
  contents.on('before-input-event',(event,input)=>{if(active()&&input.type==='keyDown'&&input.control&&['+','=','-','0'].includes(input.key)){event.preventDefault();const factor=contents.getZoomFactor();contents.setZoomFactor(input.key==='0'?1:Math.max(.5,Math.min(2,factor+(input.key==='-'?-.1:.1))))}});
  win.on('closed',()=>{controller.abort();primaryIndex.abort();ipcMain.removeHandler(channel);partition.webRequest.onBeforeRequest(null);if(this.window===win)this.window=undefined});
  try{await win.loadFile(page);if(active()){if(process.env.VRC_LIBRARY_TEST_HIDDEN)win.showInactive();else win.show()}}catch(error){if(!win.isDestroyed())win.destroy();throw error}
 }
}
