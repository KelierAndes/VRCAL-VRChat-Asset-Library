export interface BaiduShareFile {id:string;name:string;directory:boolean;sizeText:string}
export interface BaiduDownloadTask {id:string;name:string;state:'downloading'|'paused'|'completed'|'interrupted'|'cancelled';receivedBytes:number;totalBytes:number;downloadBps:number;startedAt:string;finishedAt?:string;error?:string}
export interface BaiduDownloadState {phase:'idle'|'loading'|'ready'|'error';title:string;message:string;files:BaiduShareFile[];downloadDir?:string;tasks:BaiduDownloadTask[];canGoBack:boolean;busy:boolean;loggedIn:boolean}
export function parseBaiduShare(text:unknown,code:unknown=''):{url:string;code:string} {
 if(typeof text!=='string'||text.length>8192||typeof code!=='string'||code.length>20)throw new Error('请输入有效的百度网盘分享链接。');
 const matches=text.match(/https?:\/\/[^\s<>「」"']+/g)??[];
 if(matches.length!==1)throw new Error('请一次输入一个百度网盘分享链接。');
 let url:URL;try{url=new URL(matches[0].replace(/[，。；）)]+$/,''))}catch{throw new Error('请输入有效的百度网盘分享链接。')}
 if(url.protocol!=='https:'||url.hostname!=='pan.baidu.com'||url.port||url.username||url.password||!/^\/s\/[A-Za-z0-9_-]{5,100}$/.test(url.pathname)||url.hash||[...url.searchParams.keys()].some(key=>key!=='pwd')||url.searchParams.getAll('pwd').length>1)throw new Error('请输入有效的百度网盘分享链接。');
 const codes=[code.trim(),url.searchParams.get('pwd')??'',...Array.from(text.matchAll(/(?:提取码|提取碼|密码)\s*[:：]?\s*([a-zA-Z0-9]{4})(?![a-zA-Z0-9])/g),match=>match[1])].filter(Boolean);
 if(codes.some(value=>! /^[A-Za-z0-9]{4}$/.test(value))||new Set(codes).size>1)throw new Error('提取码应为四位字母或数字，并与链接中的提取码一致。');
 return {url:url.origin+url.pathname,code:codes[0]??''};
}
