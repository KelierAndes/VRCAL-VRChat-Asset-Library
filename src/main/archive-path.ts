import fsp from 'node:fs/promises';
import path from 'node:path';
import {isWithin} from './safety';

export async function validateArchiveSource(source:string,roots:string[]):Promise<string>{
 if(typeof source!=='string'||!path.isAbsolute(source)||!Array.isArray(roots)||!roots.length||roots.some(root=>typeof root!=='string'||!path.isAbsolute(root)))throw new Error('解析任务路径无效。');
 const stat=await fsp.lstat(source);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('只读取普通素材包，目录链接不会解析。');
 const actual=await fsp.realpath(source),allowed=await Promise.all(roots.map(root=>fsp.realpath(root).catch(()=>path.resolve(root))));
 if(!allowed.some(root=>isWithin(actual,root)))throw new Error('素材包不在已授权的扫描范围内。');
 return actual;
}
