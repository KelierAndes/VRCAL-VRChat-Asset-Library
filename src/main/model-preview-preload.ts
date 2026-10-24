import {contextBridge,ipcRenderer} from 'electron';
import type {ModelPreviewAPI} from '../shared/model-preview';
const channel=process.argv.find(v=>v.startsWith('--vrc-model-channel='))?.slice('--vrc-model-channel='.length);
if(!channel||!/^vrc-model:[a-f0-9-]{36}$/.test(channel))throw new Error('预览窗口未正确初始化。');
const api:ModelPreviewAPI={state:()=>ipcRenderer.invoke(channel,'state'),load:token=>ipcRenderer.invoke(channel,'load',token),cancel:()=>ipcRenderer.invoke(channel,'cancel')};
contextBridge.exposeInMainWorld('modelPreview',api);
