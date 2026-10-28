import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {AssetRecord} from '../shared/contracts';
import type {UnityDiagnosticIssue,UnityDiagnosticSnapshot,UnityDiagnosticStatus} from '../shared/unity-diagnostics';
import {noLinks,validateProject} from './project-access';

const MAX_READ=1024*1024,MAX_LINE=16*1024,MAX_ISSUES=100,MAX_DETAIL=4096,MAX_AGE=24*60*60*1000;
const INITIAL_SCAN_LIMIT=32*1024*1024,SCAN_CHUNK=256*1024,SCAN_BUDGET_MS=2000;
const digest=(text:string|Buffer)=>createHash('sha256').update(text).digest('hex').slice(0,24);
const canonical=(value:string)=>{const p=path.resolve(value.replace(/[\\/]/g,path.sep));return process.platform==='win32'?p.toLowerCase():p};
const cleanPath=(value:string)=>value.trim().replace(/^(["'])(.*)\1$/,'$2');
function defaultLogPath():string {
 if(process.platform==='win32')return path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Unity','Editor','Editor.log');
 return process.platform==='darwin'?path.join(os.homedir(),'Library','Logs','Unity','Editor.log'):path.join(os.homedir(),'.config','unity3d','Editor.log');
}
/** Applied before any log text leaves the main process, including local display. Not a guarantee for arbitrary plugin output. */
export function redactUnityDiagnosticText(input:string,projectRoot?:string):string {
 let text=input.slice(0,MAX_LINE).replace(/\x1b\[[0-9;]*m/g,'');
 if(projectRoot){const forms=[projectRoot,projectRoot.replaceAll('\\','/'),projectRoot.replaceAll('/','\\')];for(const root of forms){const escaped=root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');text=text.replace(new RegExp(escaped+'[\\\\/]','gi'),'');}}
 text=text.replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi,'[凭据已隐藏]')
  .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|client[_-]?secret|session[_-]?id|username|user[_-]?id|account)\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,'[凭据已隐藏]')
  .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [已隐藏]')
  .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,'[凭据已隐藏]')
  .replace(/https?:\/\/[^\s<>"']+/gi,'[链接已隐藏]')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[邮箱已隐藏]')
  .replace(/\b[A-Z]:[\\/][^\r\n"<>|]*/gi,'[本地路径已隐藏]')
  .replace(/\\\\[^\s\r\n]+/g,'[本地路径已隐藏]')
  .replace(/\/(?:Users|home|tmp|var|Volumes|mnt|media)\/[^\r\n"<>]*/g,'[本地路径已隐藏]');
 return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,MAX_DETAIL);
}
function suggestions(kind:UnityDiagnosticIssue['kind'],code?:string,detail=''):string[]{
 if(kind==='exception'&&/^MissingReferenceException:.*\bModularAvatarMenuInstaller\b.*\bdestroyed\b/i.test(detail)
  &&/\bMenuPreviewGUI[+.](?:VisitorContext\.)?PushMenuInstaller\s*\(/.test(detail)
  &&/\bModularAvatarMenuInstallTarget\.Visit\s*\(/.test(detail))return [
   '这条调用链发生在 MA 的 Inspector 菜单预览：Menu Install Target 访问了已销毁的 Menu Installer。仅凭此日志不能判定角色构建或上传失败，也不能确定引用失效的来源。',
   '先记录触发操作与完整堆栈，解除 Inspector 锁定、切换到无关对象后重新选择菜单对象，核对是否仍有新报错；这一步用于排查预览状态，不代表引用已修复。',
   '若仍可重现，先备份场景／Prefab，再检查相关 Menu Install Target 的 Installer 是否显示 Missing／None；确认归属后通过 MA 的 Select Menu 重新指定有效菜单，或只移除确认已废弃的失效目标。不要批量删除 MA 组件。',
   '保留未保存改动后，可重开工程复测以区分暂存预览状态与持久引用问题。记录 Unity、MA、NDMF、VRChat SDK 版本及触发阶段（选中对象／撤销／删除／构建／上传）；核对兼容性和发行说明，不保证升级即可修复。',
  ];
 if(code==='CS0246'||code==='CS0234')return ['先查看最早出现的编译错误，核对缺失类型对应的包或命名空间。','在 VCC／Unity Package Manager 中核对当前工程的 SDK 与插件版本及依赖；不要直接删除 Library 或修改脚本。','完成必要调整后重新编译，确认同一文件和错误码是否再次出现。'];
 if(kind==='compile')return ['优先处理列表中最早出现的编译错误，后续错误可能由它引起。','核对报错文件、行号和最近一次有记录的改动；修改前保留可恢复副本。','重新编译后核对 Unity Console，本列表保留的历史记录不等于仍在报错。'];
 if(kind==='exception')return ['查看异常堆栈最先出现的 Assets／Packages 文件位置，核对对象引用及相关插件版本。','记录触发问题的操作；再次执行相同步骤以核实是否重现。'];
 if(kind==='import')return ['核对素材导入记录中的失败阶段与 Unity Console 原始提示。','检查目标资源及依赖是否齐全；仅凭报错时间相近不能认定本次素材是原因。'];
 return ['先核对报错前的操作和相关组件版本。','保留报错内容，再按相同步骤复现；一段时间没有新日志不能证明已经修复。'];
}
interface Cursor {
 projectRoot:string;fileId:string;offset:number;anchor:Buffer;head:Buffer;mtime:number;epoch:number;
 pending:Buffer;dropLine:boolean;truncated:boolean;sessionId?:string;owner?:string;argumentLines:number;wantProject:boolean;engineInitialized:boolean;
 issues:Map<string,UnityDiagnosticIssue>;lastIssue?:string;
}
export interface UnityDiagnosticsOptions {logPath?:string;now?:()=>number}
/** One bounded, read-only stream. A selected project is validated on every read. No Unity process or project writes. */
export class UnityDiagnosticsMonitor {
 private readonly logPath:string;private readonly now:()=>number;private cursor?:Cursor;private epoch=0;
 private queue:Promise<unknown>=Promise.resolve();
 constructor(options:UnityDiagnosticsOptions={}){this.logPath=options.logPath||defaultLogPath();this.now=options.now||Date.now;}
 clear(projectId?:string):void {void projectId;this.cursor=undefined;}
 read(project:AssetRecord,roots:string[]):Promise<UnityDiagnosticSnapshot>{
  const run=this.queue.then(()=>this.readOnce(project,roots));this.queue=run.catch(()=>{});return run;
 }
 private async readOnce(project:AssetRecord,roots:string[]):Promise<UnityDiagnosticSnapshot>{
  const access=await validateProject(project,roots),now=this.now(),root=canonical(access.root);
  const snapshot=(status:UnityDiagnosticStatus,message:string):UnityDiagnosticSnapshot=>{
   const c=this.cursor,issues=status==='ready'&&c?Array.from(c.issues.values()).filter(row=>now-row.lastObservedAt<=MAX_AGE).map(row=>({...row,suggestions:[...row.suggestions]})):[];
   return {projectId:project.id,status,message,checkedAt:now,projectVersion:/^\d{4}\.\d+\.\d+[a-z]\d+(?:c\d+)?$/.test(access.version)?access.version:'',sessionId:status==='ready'?c?.sessionId:undefined,issues,truncated:c?.truncated??false,revision:digest(JSON.stringify([project.id,status,c?.sessionId,issues]))};
  };
  try{
   await noLinks(this.logPath);const file=await fsp.open(this.logPath,'r');
   try{
    const stat=await file.stat();if(!stat.isFile())throw new Error('not a file');
    if(now-stat.mtimeMs>MAX_AGE){this.cursor=undefined;return snapshot('stale','日志超过 24 小时没有更新，暂不作为当前工程的新问题。请在 Unity 中打开工程后再检查。');}
    const fileId=`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
    let c=this.cursor,reset=!c||c.projectRoot!==root||c.fileId!==fileId||stat.size<c.offset||stat.size-c.offset>MAX_READ||(stat.size===c.offset&&stat.mtimeMs!==c.mtime);
    if(c&&!reset){
     const anchor=Buffer.alloc(c.anchor.length);await file.read(anchor,0,anchor.length,c.offset-anchor.length);
     const head=Buffer.alloc(c.head.length);await file.read(head,0,head.length,0);
     reset=!anchor.equals(c.anchor)||!head.equals(c.head);
    }
    const cold=reset||!c;
    if(cold||!c){
     c={projectRoot:root,fileId,offset:0,anchor:Buffer.alloc(0),head:Buffer.alloc(0),mtime:stat.mtimeMs,epoch:++this.epoch,pending:Buffer.alloc(0),dropLine:false,truncated:stat.size>MAX_READ,argumentLines:0,wantProject:false,engineInitialized:false,issues:new Map()};this.cursor=c;
    }
    // A head/tail shortcut cannot prove ownership if a second session began in the omitted middle.
    // Scan all ownership boundaries, while retaining diagnostic text only from the bounded tail.
    if(cold&&stat.size>INITIAL_SCAN_LIMIT){c.truncated=true;return snapshot('unverified','日志超过首次核对的 32 MiB 上限，未展示无法确认归属的内容。Unity 创建新的会话日志后会自动重试。');}
    const started=performance.now(),collectAfter=cold?Math.max(0,stat.size-MAX_READ):0;
    const buffer=Buffer.alloc(Math.min(SCAN_CHUNK,stat.size-c.offset));let end=c.offset;
    while(end<stat.size){
     if(performance.now()-started>SCAN_BUDGET_MS){this.cursor=undefined;const result=snapshot('unverified','首次核对日志达到 2 秒处理上限，未展示尚未完整核实的内容；稍后会重试。');result.truncated=true;return result;}
     const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,stat.size-end),end);
     if(!bytesRead)break;
     this.consume(c,buffer.subarray(0,bytesRead),end,now,collectAfter);end+=bytesRead;
    }
    const after=await file.stat(),current=await fsp.lstat(this.logPath);
    const changedDuringColdScan=cold&&[after,current].some(value=>value.size!==stat.size||value.mtimeMs!==stat.mtimeMs||value.ctimeMs!==stat.ctimeMs);
    if(end!==stat.size||after.size<end||after.ino!==current.ino||after.dev!==current.dev||after.birthtimeMs!==current.birthtimeMs||current.isSymbolicLink()||changedDuringColdScan||(!cold&&after.mtimeMs!==stat.mtimeMs&&after.size<=stat.size)){
     this.cursor=undefined;return snapshot('unverified','核对期间日志发生变化或轮换，等待下次检查重新核对所属工程。');
    }
    if(performance.now()-started>SCAN_BUDGET_MS){this.cursor=undefined;const result=snapshot('unverified','日志核对达到 2 秒处理上限，未展示尚未完整核实的内容；稍后会重试。');result.truncated=true;return result;}
    c.offset=end;c.mtime=stat.mtimeMs;
    c.anchor=Buffer.alloc(Math.min(end,128));await file.read(c.anchor,0,c.anchor.length,end-c.anchor.length);
    c.head=Buffer.alloc(Math.min(end,512));await file.read(c.head,0,c.head.length,0);
    if(!c.owner)return snapshot('unverified','未找到可核对的工程启动记录，未展示内容。请在 Unity 打开目标工程；使用自定义日志位置的会话暂不自动读取。');
    if(c.owner!==root)return snapshot('other-project','当前 Editor.log 的启动记录属于其他工程，已隔离其内容。请打开所选工程后再检查。');
    for(const [key,row] of c.issues)if(now-row.lastObservedAt>MAX_AGE)c.issues.delete(key);
    return snapshot('ready','已核对日志中的工程启动记录。显示本次会话已观察到的问题；历史日志不代表 Unity 当前运行状态或问题已修复。');
   }finally{await file.close();}
  }catch(error:any){
   this.cursor=undefined;
   if(['ENOENT','ENOTDIR'].includes(error?.code))return snapshot('missing','尚未找到 Unity Editor.log。打开目标工程后会自动检查。');
   return snapshot('unavailable','暂时无法安全读取 Unity 日志，稍后会重试。');
  }
 }
 private consume(c:Cursor,chunk:Buffer,offset:number,now:number,collectAfter=0):void {
  let start=0;
  for(let i=chunk.indexOf(10);i!==-1;i=chunk.indexOf(10,start)){
   const part=chunk.subarray(start,i);start=i+1;
   if(!c.dropLine&&c.pending.length+part.length<=MAX_LINE){const line=Buffer.concat([c.pending,part]).toString('utf8').replace(/\r$/,'');this.line(c,line,offset+i,now,offset+i>=collectAfter);}
   else c.truncated=true;
   c.pending=Buffer.alloc(0);c.dropLine=false;
  }
  const rest=chunk.subarray(start);
  if(c.pending.length+rest.length>MAX_LINE){c.pending=Buffer.alloc(0);c.dropLine=true;c.truncated=true;}
  else if(!c.dropLine)c.pending=Buffer.concat([c.pending,rest]);
 }
 private line(c:Cursor,line:string,position:number,now:number,collect=true):void {
  if(/^Built from '/.test(line)){c.owner=undefined;c.sessionId=undefined;c.argumentLines=0;c.wantProject=false;c.engineInitialized=false;c.issues.clear();c.lastIssue=undefined;return;}
  if(/^COMMAND LINE ARGUMENTS:\s*$/.test(line)){
   c.owner=undefined;c.sessionId=digest(`${c.fileId}:${c.epoch}:${position}`);c.argumentLines=64;c.wantProject=false;c.engineInitialized=false;c.issues.clear();c.lastIssue=undefined;return;
  }
  if(/^Initialize engine version:/.test(line)){
   if(c.engineInitialized){c.owner=undefined;c.sessionId=undefined;c.argumentLines=0;c.wantProject=false;c.issues.clear();c.lastIssue=undefined;}
   c.engineInitialized=true;
  }
  if(c.argumentLines>0){
   c.argumentLines--;
   if(c.wantProject){c.wantProject=false;const project=cleanPath(line);if(path.isAbsolute(project))c.owner=canonical(project);return;}
   if(/^-projectPath\s*$/i.test(line)){c.wantProject=true;return;}
   const inline=line.match(/^-projectPath\s+(.+)$/i);if(inline){const project=cleanPath(inline[1]);if(path.isAbsolute(project))c.owner=canonical(project);return;}
   if(/^Initialize engine version:|^Successfully changed project path to:/.test(line))c.argumentLines=0;
  }
  if(c.owner!==c.projectRoot||!collect)return;
  if(/All compiler errors have to be fixed|Scripts have compiler errors/i.test(line)&&Array.from(c.issues.values()).some(row=>row.kind==='compile'))return;
  const compiler=line.match(/^(.+?)\((\d+)(?:,\d+)?\):\s*(error|warning)\s+(CS\d+):\s*(.*)$/i);
  let kind:UnityDiagnosticIssue['kind']='general',severity:UnityDiagnosticIssue['severity']='error',code:string|undefined,relativePath:string|undefined,lineNumber:number|undefined;
  if(compiler){
   kind='compile';severity=compiler[3].toLowerCase() as 'error'|'warning';code=compiler[4].toUpperCase();lineNumber=Number(compiler[2]);
   let source=compiler[1].replaceAll('\\','/');
   if(path.isAbsolute(source)){const relative=path.relative(c.projectRoot,source).replaceAll('\\','/');if(!relative.startsWith('../'))source=relative;}
   if(/^(?:Assets|Packages)\//.test(source)&&!source.split('/').includes('..'))relativePath=redactUnityDiagnosticText(source).slice(0,500);
  }else if(/^(?:error|warning)\s+CS\d+:/i.test(line)){
   kind='compile';severity=/^warning/i.test(line)?'warning':'error';code=line.match(/\bCS\d+\b/i)?.[0].toUpperCase();
  }else if(/^(?:[\w.]+)?Exception\s*:/.test(line))kind='exception';
  else if(/^(?:error|warning|fatal error|assertion failed)\b\s*[:\[]/i.test(line)||/^\[.*?\]\s*(?:error|warning)\b/i.test(line)){severity=/^(?:\[.*?\]\s*)?warning\b/i.test(line)?'warning':'error';if(/import|package/i.test(line))kind='import';}
  else {
   const issue=c.lastIssue?c.issues.get(c.lastIssue):undefined;
   // Unity puts this explanatory line between a destroyed-object exception and its stack.
   // Keep only the recognized continuation; ordinary output still terminates the stack.
   const destroyedObjectHint=issue?.kind==='exception'&&/^MissingReferenceException:/.test(issue.message)
    &&/^Your script should either check if it is null or you should not destroy the object\.$/.test(line.trim());
   if(issue&&(destroyedObjectHint||/^\s+(?:at\s|\w[\w.<>`]+[.:])|^\w[\w.<>`]+[.:][^\r\n]+\(/.test(line))){
    const detail=redactUnityDiagnosticText(line,c.projectRoot);
    if(!issue.detail.split('\n').includes(detail)){
     issue.detail=(issue.detail+'\n'+detail).slice(0,MAX_DETAIL);
     issue.suggestions=suggestions(issue.kind,issue.code,issue.detail);
    }
   }
   else if(line.trim())c.lastIssue=undefined;
   return;
  }
  const message=redactUnityDiagnosticText(line,c.projectRoot),id=digest(`${kind}:${severity}:${message}`),previous=c.issues.get(id);
  if(previous){previous.count=Math.min(99999,previous.count+1);previous.lastObservedAt=now;}
  else {
   if(c.issues.size>=MAX_ISSUES){c.truncated=true;const oldest=c.issues.keys().next().value;if(oldest)c.issues.delete(oldest);}
   c.issues.set(id,{id,kind,severity,code,relativePath,line:lineNumber,message,detail:message,count:1,firstObservedAt:now,lastObservedAt:now,suggestions:suggestions(kind,code)});
  }
  c.lastIssue=id;
 }
}
