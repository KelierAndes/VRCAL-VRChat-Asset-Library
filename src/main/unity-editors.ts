import fsp from 'node:fs/promises';
import path from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {noLinks,smallFile} from './project-access';
const run=promisify(execFile);
export interface UnityEditor {path:string;version:string}
export async function editorVersion(file:string):Promise<string>{
 await noLinks(file);if(path.basename(file).toLowerCase()!=='unity.exe'||!(await fsp.lstat(file)).isFile())throw new Error('请选择 Unity Editor 的 Unity.exe。');
 const script='[Console]::OutputEncoding=[Text.Encoding]::UTF8;[Diagnostics.FileVersionInfo]::GetVersionInfo($env:VRCAL_UNITY_EDITOR_FILE).ProductVersion';
 const {stdout}=await run(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:16384,env:{...process.env,VRCAL_UNITY_EDITOR_FILE:file}});
 const version=stdout.match(/\b\d+\.\d+\.\d+[abfp]\d+/)?.[0];if(!version)throw new Error('无法核对 Unity 版本，请选择与工程相同版本的编辑器。');return version;
}
export async function findUnityEditor(version:string,selected?:string):Promise<UnityEditor|undefined>{
 const candidates:UnityEditor[]=[];
 if(selected)try{const actual=await editorVersion(selected);if(actual===version)candidates.push({path:selected,version:actual})}catch{/* A stale manual location never silently chooses another Unity version. */}
 if(process.env.APPDATA)try{const data=JSON.parse(await smallFile(path.join(process.env.APPDATA,'UnityHub/editors-v2.json')));for(const item of Array.isArray(data.data)?data.data:[])if(item.version===version&&Array.isArray(item.location))for(const file of item.location)if(typeof file==='string'&&path.isAbsolute(file))candidates.push({path:file,version:item.version})}catch{/* An absent Hub record is an ordinary manual-selection case. */}
 if(version)candidates.push({path:path.join(process.env.ProgramFiles||'C:\\Program Files','Unity','Hub','Editor',version,'Editor','Unity.exe'),version});
 for(const candidate of candidates)try{await noLinks(candidate.path);if((await fsp.lstat(candidate.path)).isFile()&&await editorVersion(candidate.path)===version)return candidate}catch{/* Missing, linked or mismatched editors are not launched. */}
 return undefined;
}
export async function launchUnityEditor(executable:string,args:string[]):Promise<void>{
 const child=spawn(executable,args,{shell:false,detached:true,stdio:'ignore',windowsHide:false});
 await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>resolve())});child.unref();
}
