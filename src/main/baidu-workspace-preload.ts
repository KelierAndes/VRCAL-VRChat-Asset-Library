import {contextBridge,ipcRenderer} from 'electron';
// This bridge is installed only in the owned local toolbar, never in the remote Baidu WebContentsView.
const requestedTheme=process.argv.find(value=>value.startsWith('--vrc-theme='))?.slice('--vrc-theme='.length);
const requestedLanguage=process.argv.find(value=>value.startsWith('--vrc-language='))?.slice('--vrc-language='.length);
const channel=process.argv.find(value=>value.startsWith('--vrc-baidu-channel='))?.slice('--vrc-baidu-channel='.length);
if(channel&&/^vrc-baidu:[a-f0-9-]{36}$/.test(channel)){
 const invoke=(command:string)=>ipcRenderer.invoke(channel,command);
 contextBridge.exposeInMainWorld('baiduWorkspace',{initialTheme:['nasa','swiss','x','x-light'].includes(requestedTheme??'')?requestedTheme:'nasa',initialLanguage:['zh-CN','ja','en'].includes(requestedLanguage??'')?requestedLanguage:'zh-CN',state:()=>invoke('state'),layout:()=>ipcRenderer.send(channel+':layout'),back:()=>invoke('back'),reload:()=>invoke('reload'),capture:()=>invoke('capture'),scan:()=>invoke('scan'),pause:()=>invoke('pause'),resume:()=>invoke('resume'),stop:()=>invoke('stop'),retry:()=>invoke('retry'),close:()=>invoke('close'),onState:(listener:(state:unknown)=>void)=>{const handler=(_event:Electron.IpcRendererEvent,state:unknown)=>listener(state);ipcRenderer.on(channel+':state',handler);return()=>ipcRenderer.removeListener(channel+':state',handler)}});
}
