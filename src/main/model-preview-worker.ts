import {indexModels,prepareModel,type ModelSource} from './model-preview-files';
interface Request {action:'index'|'load';source?:string;model?:ModelSource}
const port=(process as unknown as {parentPort?:{on:(event:string,callback:(event:{data:unknown})=>void)=>void;postMessage:(value:unknown)=>void}}).parentPort;
let started=false;
async function run(value:Request){if(started)return;started=true;const send=(v:unknown)=>{if(port)port.postMessage(v);else process.send?.(v);setTimeout(()=>process.exit(0),200)};try{let result;if(value.action==='index'&&typeof value.source==='string')result=await indexModels(value.source);else if(value.action==='load'&&value.model)result=await prepareModel(value.model);else throw new Error('模型读取请求无效。');send({ok:true,result})}catch(error){send({ok:false,error:error instanceof Error?error.message:'模型读取失败。'})}}
if(port)port.on('message',event=>void run(event.data as Request));else process.once('message',value=>void run(value as Request));
globalThis.fetch=async()=>{throw new Error('模型预览不使用网络。')};
