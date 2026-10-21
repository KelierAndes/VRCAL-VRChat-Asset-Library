const test=require('node:test'),assert=require('node:assert/strict');
const {parseBaiduVisiblePage}=require('../dist/main/main/baidu-page');
const accountKey='baidu:'+'a'.repeat(64),base='https://pan.baidu.com/disk/main#/index?category=all';
// Sanitized structure observed in a logged-in official desktop list on 2026-10-21.
// Names/IDs are synthetic; no account identity, signed URLs or credentials are stored.
function modern(name='Long Hair',type='文件夹',extra=''){
 return `<div class="wp-s-pan-table"><div class="wp-s-pan-table__header"><table><tr><th></th><th>文件名</th><th>大小</th><th>类型</th><th>修改时间</th></tr></table></div><div class="wp-s-pan-table__body mouse-choose-list"><table class="wp-s-pan-table__body-table"><tbody><tr class="wp-s-pan-table__body-row" data-id="123456789" ${extra}><td class="is-select"></td><td class="wp-s-pan-table__td"><div class="wp-s-pan-list__file-name"><div class="wp-s-file-list-drag-copy">${name}</div><div class="wp-s-pan-list__file-name-content" data-title="${name}">${name.replaceAll(' ','&nbsp;')}</div></div></td><td class="normal-column wp-format-size">12.34 MB</td><td class="normal-column"><section>${type}</section></td><td class="normal-column"><section>2026-10-21 01:00</section></td></tr></tbody></table></div></div>`;
}
test('modern logged-in rows use data-title, data-id and displayed type without invented exact file sizes',()=>{
 const result=parseBaiduVisiblePage({url:base+'&path='+encodeURIComponent('/素材'),html:modern('Hair 日本語 😀.zip','压缩包'),accountKey});
 assert.deepEqual(result.items,[{id:'123456789',name:'Hair 日本語 😀.zip',path:'/素材/Hair 日本語 😀.zip',directory:false}]);
 assert.equal(result.complete,false);
});
test('official all-files root without a path parameter and modern folders are readable',()=>{
 const result=parseBaiduVisiblePage({url:base,html:modern(),accountKey});
 assert.equal(result.directoryPath,'/');assert.equal(result.items[0].directory,true);assert.equal(result.items[0].name,'Long Hair');
});
test('modern parser refuses unknown column order and contradictory folder metadata',()=>{
 assert.throws(()=>parseBaiduVisiblePage({url:base,html:modern().replace('<th>类型</th>','<th>来源</th>'),accountKey}));
 assert.throws(()=>parseBaiduVisiblePage({url:base,html:modern('Dress','文件夹','data-isdir="0"'),accountKey}));
 assert.throws(()=>parseBaiduVisiblePage({url:base+'&search=secret',html:modern(),accountKey}));
});
test('Baidu filenames with leading and trailing spaces keep their exact names and cloud paths',()=>{
 const name=' BoundBonePro 日本語.unitypackage ';
 const result=parseBaiduVisiblePage({url:base,html:modern(name,'Unity素材包'),accountKey});
 assert.equal(result.items[0].name,name);assert.equal(result.items[0].path,'/'+name);
});
module.exports={modern};
test('deep directory breadcrumbs may collapse ancestors, while visible suffix and official route still must agree',()=>{
 const {baiduBreadcrumbMatches}=require('../dist/main/main/baidu-page');
 assert.equal(baiduBreadcrumbMatches('/素材/工具/MochiFitter/数据',['返回上一级','全部文件','...','工具','MochiFitter','数据']),true);
 assert.equal(baiduBreadcrumbMatches('/素材/工具',['全部文件','素材','工具']),true);
 assert.equal(baiduBreadcrumbMatches('/素材/工具',['全部文件','其他','工具']),false);
 assert.equal(baiduBreadcrumbMatches('/素材/工具',['全部文件','...','其他']),false);
});
