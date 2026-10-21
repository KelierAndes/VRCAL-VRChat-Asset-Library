import type {AppLanguage} from './contracts';
import {translate} from './i18n';

export type ReleaseChannel = 'stable' | 'local';
export interface ReleaseNote {
  version: string;
  date: string;
  channel: ReleaseChannel;
  title: string;
  sections: readonly {kind: 'added' | 'improved' | 'fixed' | 'notes'; items: readonly string[]}[];
}

// Maintain newest first by release date. Stable numbering restarted at 1.0.0;
// neither semver sorting nor this list determines the running/latest version.
// This is bundled documentation and never requires a GitHub request.
export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {version:'1.2.2',date:'2026-10-22',channel:'stable',title:'手动添加与拖拽入库',sections:[
    {kind:'added',items:['工具栏新增手动添加素材，可直接拖入文件夹或素材包，立即识别所选内容。']},
    {kind:'improved',items:['手动添加不触发全库扫描，仅对本次识别的素材继续在线补全；重复添加保留原确认、封面和人工标注。','手动来源随重启、备份恢复保留，设置中可移除；支持中日英与四套主题。']},
    {kind:'notes',items:['原文件保持只读，不复制或解压素材；资料库、备份、磁盘根目录与目录链接不能作为素材添加。']}
  ]},
  {
    version:'1.2.1',date:'2026-10-21',channel:'stable',title:'资料库恢复与可选闲鱼搜索',
    sections:[{kind:'fixed',items:['旧资料库无法读取时显示登记路径，可重试连接或重新定位已有资料库，不自动创建空库。']},
      {kind:'added',items:['设置新增默认关闭的闲鱼搜索，确认使用提醒后在匹配确认显示“进行闲鱼尝试补全”。',
        '提取关键词打开独立闲鱼搜索，核对后尝试采用商品来源；也可整理名称后继续 BOOTH 核对。']},
      {kind:'notes',items:['闲鱼仅作辅助搜索，不可用于购买；公开资料不足时保留已有信息，来源确认支持撤回。']}]
  },
  {
    version:'1.2.0',date:'2026-10-21',channel:'stable',title:'工程内商品、MA 装配与云端目录',
    sections:[{kind:'added',items:[
      '工程详情、文件浏览和右键菜单新增商品读取，展示封面、工程路径与识别依据。',
      '读取 BOOTH 编号、预制件名称、说明链接和已完成导入记录；支持单项或批量登记并匹配。',
      '导入后可使用 MA 将选定预制件装配到角色层级最底部；多个角色或预制件时先选择。',
      '可读取选定母目录及其子目录，显示进度，支持暂停、重启续读和失败重试。',
      '云端记录可关联本地素材，区分仅云端、仅本地和两处都有；关联记录跨重启保留。',
      '新增独立更新记录页，从侧栏或设置中的应用更新进入，断网也能查看。'
    ]},{kind:'improved',items:[
      'MA 窗口的标题、字段、按钮、装配说明与状态提示支持中文，保留角色名和文件路径。',
      '导入前后对比 Assets，显示新增与修改位置；旧记录可按导入时间查找候选。'
    ]},{kind:'fixed',items:[
      '修正 Unity 导入回调与重载后的路径记录，保留作者已有的有效 MA 配置。',
      '适配百度新版文件列表和根目录地址，使用完整文件名与显示类型识别目录。'
    ]},{kind:'notes',items:[
      '名称和参考链接保持为线索；读取范围为 Assets，文件存在不代表场景使用或购买记录，扫描保持只读。',
      'MA 装配需要目标工程已安装兼容的 Modular Avatar；场景不自动保存，可在 Unity 撤销。',
      '仅读取网页目录信息，不下载或解压；验证、分页或未知页面可能中断，未读到的文件不会标为缺失。'
    ]}]
  },
  {
    version:'1.2.0-local.7',date:'2026-10-21',channel:'local',title:'读取工程内商品',
    sections:[{kind:'added',items:['工程详情、文件浏览和右键菜单新增商品读取，展示封面、工程路径与识别依据。',
      '读取 BOOTH 编号、预制件名称、说明链接和已完成导入记录；支持单项或批量登记并匹配。']},
      {kind:'improved',items:['工程内商品可衔接内置 BOOTH 搜索、手动来源及来源撤回，登记后保留工程关联与人工信息。']},
      {kind:'notes',items:['名称和参考链接保持为线索；读取范围为 Assets，文件存在不代表场景使用或购买记录，扫描保持只读。']}]
  },
  {
    version:'1.2.0-local.6',date:'2026-10-21',channel:'local',title:'Unity MA 助手中文界面',
    sections:[{kind:'improved',items:['MA 窗口的标题、字段、按钮、装配说明与状态提示支持中文，保留角色名和文件路径。']},
      {kind:'added',items:['导入记录新增“更新 MA 中文界面”，已有工程无需重新导入素材。']},
      {kind:'notes',items:['仅升级已知版本的自带助手，保留自定义文件与 .meta；不更改装配、撤销及回执规则。']}]
  },
  {
    version:'1.2.0-local.5',date:'2026-10-21',channel:'local',title:'工程变化定位与 MA 重试',
    sections:[{kind:'added',items:['导入前后对比 Assets，显示新增与修改位置；旧记录可按导入时间查找候选。']},
      {kind:'fixed',items:['文件导入完成后，较早的 MA 导入失败记录可单独重试，无需重复导入素材。']},
      {kind:'notes',items:['候选位置保留复制、右键定位与重启记录；可能包含同期修改，不用于自动装配。']}]
  },
  {
    version:'1.2.0-local.4', date:'2026-10-21', channel:'local', title:'百度目录识别与子目录读取',
    sections:[{kind:'fixed',items:['适配百度新版文件列表和根目录地址，使用完整文件名与显示类型识别目录。']},
      {kind:'added',items:['可读取选定母目录及其子目录，显示进度，支持暂停、重启续读和失败重试。']},
      {kind:'notes',items:['仅读取网页目录信息，不下载或解压；验证、分页或未知页面可能中断，未读到的文件不会标为缺失。']}]
  },
  {
    version:'1.2.0-local.3', date:'2026-10-21', channel:'local', title:'应用内更新记录',
    sections:[{kind:'added', items:[
      '新增独立更新记录页，从侧栏或设置中的应用更新进入，断网也能查看。',
      '支持按版本、功能关键词和发布类型筛选，并标出当前运行版本。'
    ]},{kind:'improved',items:['更新记录适配中文、英语、日语和四套主题，支持界面缩放。']}]
  },
  {
    version:'1.2.0-local.2', date:'2026-10-21', channel:'local', title:'MA 装配与导入位置',
    sections:[{kind:'added',items:[
      '导入后可使用 MA 将选定预制件装配到角色层级最底部；多个角色或预制件时先选择。',
      '应用内显示实际导入的 Assets 路径、预制件和角色层级位置，支持复制与定位。'
    ]},{kind:'fixed',items:['修正 Unity 导入回调与重载后的路径记录，保留作者已有的有效 MA 配置。']},
    {kind:'notes',items:['MA 装配需要目标工程已安装兼容的 Modular Avatar；场景不自动保存，可在 Unity 撤销。']}]
  },
  {
    version:'1.2.0-local.1', date:'2026-10-21', channel:'local', title:'云端目录与 MA 试验功能',
    sections:[{kind:'added',items:[
      '新增百度网盘试验页，通过独立官方网页登录会话读取当前可见文件列表。',
      '云端记录可关联本地素材，区分仅云端、仅本地和两处都有；关联记录跨重启保留。',
      '工程导入加入可选的 MA 菜单配置助手，与文件导入状态分开展示。'
    ]},{kind:'notes',items:['百度网盘仍需真实登录验证：当前仅处理网页可见条目，不会递归读取整个云端母目录。']}]
  },
  {
    version:'1.1.1', date:'2026-10-21', channel:'stable', title:'社区交流群',
    sections:[{kind:'added',items:['贡献者与社区新增加群聊天、离线 QQ 群二维码和一键复制群号。']}]
  },
  {
    version:'1.1.0', date:'2026-10-21', channel:'stable', title:'工程素材浏览与导入',
    sections:[{kind:'added',items:[
      '浏览 Unity 工程的真实 Assets 文件、目录和 Packages 依赖，支持右键定位。',
      '本地素材可导入指定工程：Unity 素材包交给 Unity 确认，普通文件预览后复制。'
    ]},{kind:'improved',items:['导入前检查路径、引用与 GUID 冲突，保留导入记录并补充工程素材关联。']},
    {kind:'notes',items:['仅主动导入才写入指定工程；不覆盖已有文件，ZIP、RAR、7z 不自动解压。']}]
  },
  {
    version:'1.0.0', date:'2026-10-20', channel:'stable', title:'首次正式发布',
    sections:[{kind:'added',items:[
      'BOOTH 自动匹配与内置搜索浏览器，找到商品后可直接应用；来源确认支持撤回。',
      '支持封面图库、分类标签、适配对照、包装目录合并、收藏和工程素材关联。',
      '提供中日英界面、X 暗色与亮色等四套主题、路径管理、备份及内置更新。'
    ]},{kind:'notes',items:[
      '正式版本号从 1.0.0 起算，之前的 1.9.x、1.10.x 属于测试版。',
      '原素材和工程在扫描整理时保持只读，标注与封面单独保存。'
    ]}]
  }
];

export function filterReleaseNotes({search='',channel='all',language='zh-CN'}: {
  search?: string; channel?: ReleaseChannel | 'all'; language?: AppLanguage;
} = {}): readonly ReleaseNote[] {
  const query=search.normalize('NFKC').trim().toLocaleLowerCase();
  return RELEASE_NOTES.filter(entry=>{
    if (channel!=='all' && entry.channel!==channel) return false;
    if (!query) return true;
    const text=[entry.version,entry.date,entry.title,translate(entry.title,language),
      ...entry.sections.flatMap(section=>section.items.flatMap(item=>[item,translate(item,language)]))].join('\n');
    return text.normalize('NFKC').toLocaleLowerCase().includes(query);
  });
}
