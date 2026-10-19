import {contextBridge,ipcRenderer} from 'electron';
// Only allowlisted chrome themes cross the sandbox bridge; no local-module require is available here.
const requestedTheme=process.argv.find(value=>value.startsWith('--vrc-theme='))?.slice('--vrc-theme='.length);
const initialTheme=['nasa','swiss','x','x-light'].includes(requestedTheme??'')?requestedTheme:'nasa';
const requestedLanguage=process.argv.find(value=>value.startsWith('--vrc-language='))?.slice('--vrc-language='.length);
const initialLanguage=['zh-CN','ja','en'].includes(requestedLanguage??'')?requestedLanguage:'zh-CN';
const channel=process.argv.find(value=>value.startsWith('--vrc-preview-channel='))?.slice('--vrc-preview-channel='.length);
if(channel&&/^vrc-preview:[a-f0-9-]{36}$/.test(channel)){
  const invoke=(command:string)=>ipcRenderer.invoke(channel,command);
  contextBridge.exposeInMainWorld('productPreview',{
    initialTheme,initialLanguage,
    state:()=>invoke('state'),back:()=>invoke('back'),forward:()=>invoke('forward'),reload:()=>invoke('reload'),confirm:()=>invoke('confirm'),close:()=>invoke('close'),
    onState:(listener:(state:unknown)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,state:unknown)=>listener(state);ipcRenderer.on(channel+':state',handler);return()=>ipcRenderer.removeListener(channel+':state',handler);}
  });
}
