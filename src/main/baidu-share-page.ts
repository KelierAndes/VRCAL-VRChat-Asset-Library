// Normal rendered controls observed on the official desktop share page.
// No private API, page JavaScript stores, cookies or signed URLs are serialized.
export const BAIDU_SHARE_SNAPSHOT=`(()=>{
 const visible=e=>!!e&&e.getClientRects().length>0;
 const rows=[...document.querySelectorAll('dd.g-clearfix')].filter(e=>visible(e)&&e.querySelector('.filename'));
 return {title:document.title.split('_')[0].slice(0,500),path:location.pathname+location.hash,
 files:rows.slice(0,1000).map((row,index)=>({index,name:(row.querySelector('.filename').getAttribute('title')||row.querySelector('.filename').textContent).trim(),directory:!!row.querySelector('.dir-small'),sizeText:(row.querySelector('.file-size')?.textContent||'').trim()})),
 text:document.body.innerText.slice(0,8000),back:[...document.querySelectorAll('ul.FuIxtL a[data-deep="-1"]')].some(visible)};
})()`;
export function baiduShareAction(index:number,name:string,action:'open'|'download'):string {
 return `(()=>{const rows=[...document.querySelectorAll('dd.g-clearfix')].filter(e=>e.getClientRects().length&&e.querySelector('.filename'));const row=rows[${JSON.stringify(index)}],name=${JSON.stringify(name)};if(!row||(row.querySelector('.filename').getAttribute('title')||row.querySelector('.filename').textContent).trim()!==name)throw Error('文件列表已变化，请重新读取。');
 ${action==='open'?`if(!row.querySelector('.dir-small'))throw Error('请选择文件夹。');row.querySelector('.filename').click();`:`if(row.querySelector('.dir-small'))throw Error('请打开文件夹，选择其中的文件下载。');for(const item of rows){const selected=item.classList.contains('JS-item-active');if(selected!==(item===row)){const box=item.querySelector(':scope > span.EOGexf');if(!box)throw Error('网页布局已变化，无法安全选择文件。');box.click();}}if(rows.filter(e=>e.classList.contains('JS-item-active')).length!==1||!row.classList.contains('JS-item-active'))throw Error('无法确认文件选择，请重新读取。');const buttons=[...document.querySelectorAll('a.bottom_download_btn[title="下载"]')].filter(e=>e.getClientRects().length);if(buttons.length!==1)throw Error('网页布局已变化，无法开始下载。');buttons[0].click();`}
 return true;})()`;
}
export const BAIDU_SHARE_BACK=`(()=>{const links=[...document.querySelectorAll('ul.FuIxtL a[data-deep="-1"]')].filter(e=>e.getClientRects().length);if(links.length!==1)throw Error('无法返回上一级，请重新读取分享链接。');links[0].click();return true})()`;

// Only the observed ordinary-download choice. Never activate speed-up, payment,
// save-to-drive, client download, or an arbitrary button based on similar text.
export function baiduNormalDownload(name:string):string {return `(()=>{
 const visible=e=>!!e&&e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden';
 if(visible(document.querySelector('#passport-login-pop')))return 'login';
 const modal=document.querySelector('#moduleDownloadDialog');if(!visible(modal))return 'waiting';
 if(!modal.innerText.includes(${JSON.stringify(name)}))return 'mismatch';
 const buttons=[...modal.querySelectorAll('[node-type="download-normal"]')].filter(e=>visible(e)&&e.textContent.trim()==='普通下载');
 if(buttons.length!==1)return 'unsupported';buttons[0].click();return 'clicked';
})()`}
