import path from 'node:path';
import type {AssetRecord} from '../shared/contracts';

/** Location IPC accepts only a known record or one of its scanned wrapper paths. */
export function assetLocation(asset:AssetRecord,requested?:unknown):string {
 if(requested===undefined)return asset.path;
 if(typeof requested!=='string'||!path.isAbsolute(requested))throw new Error('文件位置无效。');
 const key=(value:string)=>path.resolve(value).toLowerCase();
 const allowed=[asset.path,...(asset.members?.map(member=>member.path)||[]),...(asset.wrapper?.chain||[])].find(value=>key(value)===key(requested));
 if(!allowed)throw new Error('只能定位此素材已登记的文件位置。');
 return allowed;
}
