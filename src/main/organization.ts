import path from 'node:path';

const normalize=(name:string)=>name.normalize('NFKC').trim();
const copySuffix='(?:\\s*\\(\\d+\\)|\\s*[-_]\\s*(?:副本|コピー|copy))*';
const auxiliary=new RegExp('^(?:vt[\\s_.-]*)?(?:materials?|psd)(?:[\\s_+&＆,/-]+(?:materials?|psd))*'+copySuffix+'$','i');
const defaultFolder=new RegExp('^(?:新建文件夹|新建資料夾|新建资料夹|新資料夾|新资料夹|new[ _-]+folder)'+copySuffix+'$','i');

/** Exact organizational names only; titled products are never substring matches. */
export function isAuxiliaryFolderName(name:string):boolean{return auxiliary.test(normalize(name))}
export function isOrganizationalFolderName(name:string):boolean{return isAuxiliaryFolderName(name)||defaultFolder.test(normalize(name))}

/** Support packages are hidden only inside an explicitly auxiliary wrapper. */
export function isOrganizationalAsset(record:{kind:string;name:string;path?:string}):boolean {
  if(record.kind==='unity-project')return false;
  if(record.kind==='folder')return isOrganizationalFolderName(record.name);
  if(!record.path||!['archive','unitypackage','file'].includes(record.kind))return false;
  let directory=path.dirname(record.path),auxiliaryAncestor=false;
  for(let depth=0;depth<64;depth++){if(isAuxiliaryFolderName(path.basename(directory))){auxiliaryAncestor=true;break}const parent=path.dirname(directory);if(parent===directory)break;directory=parent}
  if(!auxiliaryAncestor)return false;
  const extension=path.extname(record.name),stem=record.name.slice(0,record.name.length-extension.length);
  return isAuxiliaryFolderName(stem)||(record.kind==='file'&&/\.(?:psd|png|jpe?g|webp|gif|bmp|tga|tif|tiff)$/i.test(record.name));
}
