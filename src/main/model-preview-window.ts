import {BrowserWindow,ipcMain,session} from 'electron';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {isWithin} from './safety';
import {noLinks} from './project-access';
import {readModelIndex,readModelBundle} from './model-preview-reader';
import type {ModelSource} from './model-preview-files';
import type {ModelPreviewState} from '../shared/model-preview';
import {THEME_BACKGROUNDS,displayTitle,type AssetRecord,type AppTheme} from '../shared/contracts';

interface Dependencies {parent:()=>BrowserWindow|null;theme:()=>AppTheme;available:()=>boolean;validate:(id:string)=>{asset:AssetRecord;roots:string[]}}
export class ModelPreviewWindow {
 private window?:BrowserWindow;private generation=0;private reading?:AbortController;
 constructor(private deps:Dependencies){}
 close(){this.generation++;this.reading?.abort();this.window?.destroy();this.window=undefined}
 async open(id:string):Promise<void>{
  this.close();const generation=this.generation,{asset,roots}=this.deps.validate(id);if(asset.missing)throw new Error('本地素材不存在，请先找回文件。');
  const sources=[...new Set([asset.path,...(asset.members||[]).filter(m=>!m.missing).map(m=>m.path)])];
  for(const source of sources){if(!roots.some(root=>isWithin(source,root)))throw new Error('素材不在当前已授权的读取范围内。');await noLinks(source)}
  if(generation!==this.generation||!this.deps.available())return;
  const channel='vrc-model:'+randomUUID(),partition=session.fromPartition(channel),rendererRoot=path.resolve(__dirname,'../../renderer'),page=path.join(rendererRoot,'model-preview.html'),pageUrl=pathToFileURL(page).href;
  partition.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));partition.setPermissionCheckHandler(()=>false);
  partition.webRequest.onBeforeRequest((request,callback)=>{let allowed=false;try{allowed=request.url.startsWith('file:')&&isWithin(fileURLToPath(request.url),rendererRoot)||request.url.startsWith('blob:')||request.url.startsWith('data:')}catch{}callback({cancel:!allowed})});
  partition.on('will-download',event=>event.preventDefault());
  const win=new BrowserWindow({parent:this.deps.parent()||undefined,width:1120,height:800,minWidth:560,minHeight:480,title:`3D 预览 · ${displayTitle(asset)}`,backgroundColor:THEME_BACKGROUNDS[this.deps.theme()],show:false,autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'model-preview-preload.js'),additionalArguments:['--vrc-model-channel='+channel],session:partition,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
  this.window=win;const controller=new AbortController();this.reading=controller;let loading:AbortController|undefined;const choices=new Map<string,ModelSource>();
  const state:Promise<ModelPreviewState>=(async()=>{const warnings:string[]=[];const seen=new Set<string>();for(const source of sources){if(controller.signal.aborted)throw new Error('预览已关闭。');const current=await readModelIndex(asset.kind==='unity-project'?path.join(source,'Assets'):source,controller.signal);warnings.push(...current.warnings);for(const model of current.models){const key=model.source.toLowerCase()+'|'+model.key.toLowerCase();if(seen.has(key))continue;seen.add(key);choices.set(randomUUID(),model);if(choices.size>=200)break}if(choices.size>=200)break}return {title:displayTitle(asset),theme:this.deps.theme(),choices:[...choices].map(([token,m])=>({token,label:m.label,name:m.name,format:m.format,size:m.size})),warnings:[...new Set(warnings)]}})();void state.catch(()=>{});
  const active=()=>!win.isDestroyed()&&!controller.signal.aborted&&this.window===win&&this.deps.available();
  ipcMain.handle(channel,async(event,action:unknown,token:unknown)=>{
   if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==pageUrl||!active())throw new Error('预览请求已失效。');
   if(action==='state')return state;
   if(action==='cancel'){loading?.abort();return}
   if(action==='load'){
    await state;if(!active()||typeof token!=='string'||!choices.has(token))throw new Error('请选择当前列表中的模型。');loading?.abort();loading=new AbortController();const task=loading;const cancel=()=>task.abort();controller.signal.addEventListener('abort',cancel,{once:true});
    try{const bundle=await readModelBundle(choices.get(token)!,task.signal);if(!active()||task.signal.aborted)throw new Error('预览已取消。');return bundle}finally{controller.signal.removeEventListener('abort',cancel)}
   }throw new Error('预览操作无效。');
  });
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&input.control&&['+','=','-','0'].includes(input.key)){event.preventDefault();const factor=win.webContents.getZoomFactor();win.webContents.setZoomFactor(input.key==='0'?1:Math.max(.5,Math.min(2,factor+(input.key==='-'?-.1:.1))))}});
  win.on('closed',()=>{controller.abort();loading?.abort();ipcMain.removeHandler(channel);partition.webRequest.onBeforeRequest(null);if(this.window===win)this.window=undefined});
  try{await win.loadFile(page);if(!win.isDestroyed()){if(process.env.VRC_LIBRARY_TEST_HIDDEN)win.showInactive();else win.show()}}catch(error){win.destroy();throw error}
 }
}
