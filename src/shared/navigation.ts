export type AppPage = 'library'|'booth'|'contributors'|'baidu'|'updates'|'hidden'|'inbox'|'plugins'|'ai'|'discovery'|'workbench';
export type NavigationId = Exclude<AppPage,'library'>|'materials'|'projects'|'favorites'|'review'|'manual';
export type NavigationGroup = 'organize'|'create'|'discover'|'app';
export interface NavigationItem {id:NavigationId;label:string;icon:'grid'|'heart'|'spark'|'tag'|'hidden'|'folder'|'box'|'search'|'cloud'|'download'|'history'|'users'|'warning';description:string;className?:string}
export const NAV_GROUPS:readonly {id:NavigationGroup;label:string;items:readonly NavigationItem[]}[] = [
 {id:'organize',label:'素材整理',items:[
  {id:'materials',label:'全部素材',icon:'grid',description:'先添加本地素材，再补齐商品资料；拖入文件夹也可以。'},
  {id:'favorites',label:'我的收藏',icon:'heart',description:'把常用素材收藏起来，之后从这里快速找到。'},
  {id:'review',label:'匹配确认',icon:'spark',description:'核对候选商品；不确定时可搜索、手动填写或跳过。'},
  {id:'manual',label:'手动归类',icon:'tag',description:'跳过匹配的素材集中在这里，可自己标注或重新匹配。'},
  {id:'hidden',label:'已隐藏素材',icon:'hidden',description:'这里只收纳隐藏的条目；恢复显示不会移动原文件。',className:'hidden-nav'}]},
 {id:'create',label:'改模与工程',items:[
  {id:'workbench',label:'改模工作台',icon:'folder',description:'选择目标工程 → 导入素材 → 装配与菜单 → 检查效果。',className:'workbench-nav'},
  {id:'projects',label:'工程与成品',icon:'folder',description:'查看工程已有素材与制作状态；开始安装请进入改模工作台。'},
  {id:'plugins',label:'公开插件',icon:'box',description:'查阅公开插件的用途与官方入口，再选择所需插件。',className:'plugins-nav'},
  {id:'ai',label:'Unity 报错',icon:'warning',description:'读取所选工程的报错；配置 AI 后可辅助解释原因与处理步骤。',className:'ai-nav'}]},
 {id:'discover',label:'查找与下载',items:[
  {id:'discovery',label:'AI 找素材',icon:'search',description:'描述想找的衣服或素材，核对搜索结果与商品来源。',className:'discovery-nav'},
  {id:'booth',label:'BOOTH 账号与下载',icon:'cloud',description:'登录 BOOTH，查看已购商品和下载记录。'},
  {id:'inbox',label:'待下载链接',icon:'download',description:'从已登录的平台发现近期链接；在这里接着下载。',className:'inbox-nav'},
  {id:'baidu',label:'百度网盘与云端素材',icon:'cloud',description:'登录网盘、查看云端条目，或粘贴分享链接下载。',className:'cloud-nav'}]},
 {id:'app',label:'应用',items:[
  {id:'updates',label:'更新记录',icon:'history',description:'查看每个版本新增、改进和修复了什么。',className:'updates-nav'},
  {id:'contributors',label:'贡献者与社区',icon:'users',description:'了解贡献者、项目源地址和反馈交流入口。',className:'contributors-button'}]}
];
export function navigationContext(page:AppPage,view:string,collection:string) {
 const id = page!=='library'?page:collection==='custom'?'custom':collection==='review'?'review':collection==='favorites'?'favorites':view==='projects'?'projects':view==='manual'?'manual':'materials';
 const group=NAV_GROUPS.find(g=>g.items.some(i=>i.id===id))??NAV_GROUPS[0];
 const item=group.items.find(i=>i.id===id);
 return {id,group:group.id,groupLabel:group.label,description:item?.description??'按你保存的集合或筛选条件浏览素材。'};
}
export function libraryActions(page:AppPage,view:string,_collection:string) {
 const filters=page==='library';
 return {materials:filters&&view!=='projects',projects:filters&&view==='projects',filters};
}
