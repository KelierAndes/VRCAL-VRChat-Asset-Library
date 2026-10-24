import {Readable} from 'node:stream';
import type {Net} from 'electron';

/** Electron fetch rejects manual redirects instead of returning their status.
 * Keep each file hop visible to PublicPluginDownloads so it can validate the CDN
 * before a second request is made. Never share browser cookies with this path.
 */
export function createPublicPluginFetch(net:Pick<Net,'request'|'fetch'>){return createManualPublicFetch(net,true)}
/** Only use after the metadata queue's public URL and DNS validation, including every redirect. */
export function createPublicPageFetch(net:Pick<Net,'request'|'fetch'>){return createManualPublicFetch(net,false)}
function createManualPublicFetch(net:Pick<Net,'request'|'fetch'>,plugin:boolean){
 return async(url:string,init:RequestInit={}):Promise<Response>=>{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||plugin&&!['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(parsed.hostname))throw new Error('插件请求地址不属于官方发布服务器。');
  init.signal?.throwIfAborted();
  if(plugin&&parsed.hostname==='api.github.com')return net.fetch(url,{...init,credentials:'omit',redirect:'error'});
  return new Promise<Response>((resolve,reject)=>{
   const requestHeaders:Record<string,string>={};new Headers(init.headers).forEach((value,key)=>requestHeaders[key]=value);
   const request=net.request({url,method:'GET',credentials:'omit',redirect:'manual',headers:requestHeaders});
   let settled=false,incoming:Readable|undefined;
   const cleanup=()=>init.signal?.removeEventListener('abort',abort);
   const fail=(error:Error)=>{cleanup();if(!settled){settled=true;reject(error)}else if(incoming&&!incoming.destroyed)incoming.destroy(error)};
   const abort=()=>{fail(init.signal?.reason instanceof Error?init.signal.reason:new Error('下载已取消。'));request.abort()};
   request.on('error',fail);
   // ClientRequest's writable side may emit close after end(), before any
   // response headers arrive. Only response completion/error or abort ends GET.
   request.on('redirect',(status,_method,target)=>{
    if(settled)return;
    try{const response=new Response(null,{status,headers:{location:target}});settled=true;cleanup();resolve(response)}catch(error){fail(error instanceof Error?error:new Error(String(error)))}
    // Do not call followRedirect: the caller validates this target first.
    request.abort();
   });
   request.on('response',response=>{
    if(settled){request.abort();return}
    try{
     const headers=new Headers();for(const [key,value] of Object.entries(response.headers)){if(key.toLowerCase()==='set-cookie')continue;headers.set(key,Array.isArray(value)?value.join(', '):value)}
     incoming=response as unknown as Readable;
     const body=Readable.toWeb(incoming,{strategy:{highWaterMark:64*1024,size:chunk=>chunk.byteLength}}) as ReadableStream<Uint8Array>;
     incoming.once('close',()=>{cleanup();request.abort()});
     const result=new Response(body,{status:response.statusCode,headers});settled=true;resolve(result);
    }catch(error){fail(error instanceof Error?error:new Error(String(error)));request.abort()}
   });
   init.signal?.addEventListener('abort',abort,{once:true});
   if(init.signal?.aborted){abort();return}request.end();
  });
 };
}
