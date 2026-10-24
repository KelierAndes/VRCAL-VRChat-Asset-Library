import type {AppLanguage} from './contracts';
import {translate} from './i18n';

export type ReleaseChannel = 'stable' | 'preview' | 'local';
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
  {version:'1.4.0-preview.6',date:'2026-10-24',channel:'preview',title:'贡献者署名核对与清理',sections:[
    {kind:'fixed',items:['移除仅创建 Fork、没有已核实实际贡献的社区参与条目，页面恢复为“此版本的贡献者”。','首页与贡献指南统一按实际代码、文档、翻译、测试或有效反馈记录署名；创建仓库副本本身不计作贡献。']},
    {kind:'notes',items:['保留项目维护者头像、社交主页和社区入口；本版沿用 preview.5 的功能与试验范围，需手动下载公开预览版。']}
  ]},
  {version:'1.4.0-preview.5',date:'2026-10-24',channel:'preview',title:'改模工作台、AI 辅助与轻量预览',sections:[
    {kind:'added',items:['改模工作台集中目标工程、依赖线索、工程商品、导入历史和错误处理；同内容素材包重复导入前提醒，保留已有 MA 菜单或创建显隐开关，装配与菜单支持一笔撤销。','无需 Unity 的轻量 3D 预览，支持 FBX、GLB、glTF、OBJ 及部分 ZIP／Unitypackage；可旋转、平移、缩放，调整渲染比例和线框。','公开插件目录扩充到 30 项，提供作者来源与安装方式，其中 6 项支持下载素材包并交给指定工程导入。','可选千问、Kimi、DeepSeek：衣服类型与风格建议、Unity 报错解释、自然语言找素材；AI 搜索词交给 BOOTH 或已开启的闲鱼读取真实商品。','待下载链接页按近期范围去重、显示待核对记录并衔接百度下载；仅检查应用内已加载的官方账号页面，不扫描其他浏览器。']},
    {kind:'improved',items:['侧栏分为素材整理、改模与工程、查找与下载；更新记录和社区放入应用区，隐藏素材仍有独立页面。','素材分类放到搜索筛选栏，工具页不再展示无关的分类；集合保留在整理区。','顶部显示当前页面用途，主题和语言收进外观；工程页突出添加工程和进入改模工作台。','空闲下载摘要更紧凑，完整速度与历史仍可查看；小窗口通过导航抽屉访问全部入口。']},
    {kind:'notes',items:['这是 GitHub 公开预览版，汇总此前本地预览的功能；手动下载试用，不作为稳定版内置更新推送。新增文字暂为中文。','AI 默认关闭，需自行配置密钥并同意发送范围；真实付费 AI 效果尚未验收。','BOOTH 资料库无购买时间的记录进入待核对；闲鱼真实新交付及关闭平台窗口后的独立后台发现尚未验收。','轻量预览不还原 Unity 着色器、场景与物理，不提供自动试穿、体型适配或穿模修复。MA 测试使用 API 替身，仍需实际角色、插件和 SDK 验证。','扫描与整理保持只读；主动导入、确认装配和移入回收站会按操作写入。更新前建议备份资料库。']}
  ]},
  {version:'1.4.0-preview.4',date:'2026-10-24',channel:'local',title:'改模工作台与装配菜单（本地测试）',sections:[
    {kind:'added',items:['新增改模工作台，集中工程选择、公开依赖线索、导入历史、工程商品、插件与报错入口，记住目标工程。','导入前检查区分未知适配、依赖声明和包文件；同工程同内容 Unitypackage 提醒重复，明确确认后才能再次导入。','装配可同时接入游戏内菜单：保留作者已有 MA 菜单，没有时创建显隐开关；一笔装配和菜单共用 Unity Undo。','文件导入、角色装配、菜单和用户效果检查分步显示；外观、动作、菜单检查记录重启保留。']},
    {kind:'fixed',items:['旧预览在执行时再次核对重复；更新已知版本的助手时保留自定义文件与 Unity 元数据。','从工作台进入报错页保持目标工程，避免异步加载改成另一个工程。']},
    {kind:'notes',items:['提供改模痛点报告与实机图文说明；新增文字暂为中文，未发布 GitHub。','测试使用合成工程；包文件存在不代表 Unity 编译通过，人工勾选不代表 SDK 构建或游戏同步通过。','本版不自动修改旧衣服或身体形态；角色衣柜、跨重启卸载、跨角色适配及穿模修复仍为后续项目。']}
  ]},
  {version:'1.4.0-preview.3',date:'2026-10-24',channel:'local',title:'用一句话找素材（本地测试）',sections:[
    {kind:'added',items:['新增 AI 找素材页面，可用自然语言描述品类、风格和适配角色，从 BOOTH 与已开启的闲鱼搜索真实商品，展示封面、来源及标题命中依据。','千问、Kimi、DeepSeek 可整理日英检索词；找素材单独开启并同意，复用加密密钥、调用额度和缓存。没有配置 AI 时使用明确标注的本地关键词规则。']},
    {kind:'improved',items:['闲鱼使用已有登录会话后台读取正常搜索页，登录或验证失败时可打开站内搜索，其他平台结果仍保留。','手动搜索不受自动补全暂停影响，仍共享 BOOTH 请求间隔、限流与封面缓存；结果可在内置浏览器打开。']},
    {kind:'notes',items:['最多展示每个平台 12 件商品；标题命中不代表适配或作者授权保证，不自动购买、下载或安装。','新增文字暂用中文；真实两站搜索已验证，真实付费 AI 效果尚未验证；此版本未提交 GitHub。']}
  ]},
  {version:'1.4.0-preview.2',date:'2026-10-24',channel:'local',title:'公开插件扩充至 30 项（本地测试）',sections:[
    {kind:'added',items:['公开插件从 9 项扩充至 30 项，新增表情与动作、工程与迁移分类，涵盖 FaceEmo、TexTransTool、VRCQuestTools、Pumkin’s Avatar Tools、GoGo Loco 等工具。','安装方式筛选可查看可下载并导入、VCC／ALCOM 与作者官网安装的条目。','新增 FACS Utilities、Animation Viewer、Blendshape Viewer 的官方稳定素材包下载与指定工程导入，共 6 项支持直接导入。']},
    {kind:'fixed',items:['修复官方插件附件跳转时下载中断的问题，逐跳核对官方文件服务器，保留取消、大小与摘要校验。']},
    {kind:'notes',items:['只使用公开作者文档、发布页和包清单核对来源，不读取本机非公开插件。目录可离线浏览，安装依赖与兼容性以作者说明为准。','GoGo Loco 提供作者官网入口；Pumkin 的最新发布含 beta 标记，不自动直装该测试包。','本地预览，尚未发布 GitHub；此前未完成的真实账号后台识别、角色试穿及适配工作继续保留在开发计划中。']}
  ]},
  {version:'1.4.0-preview.1',date:'2026-10-24',channel:'local',title:'轻量预览、公开插件与 AI 辅助（本地测试）',sections:[
    {kind:'added',items:['素材详情新增轻量 3D 预览，支持常见 FBX、GLB、glTF、OBJ 及部分 ZIP／Unitypackage 内容，无需启动 Unity；支持渲染比例、旋转、平移、素模及线框。','公开插件目录收录 9 项作者官方来源，部分 Unity 素材包可下载并交给指定工程的 Unity 导入确认。','新增千问、Kimi、DeepSeek 可选接入；衣服类型和风格独立保存为建议，可接受为标签。','AI 与工程报错页读取已核对归属的 Unity 输出，合并重复错误并提供本地提示和可选 AI 排查建议。','待下载链接页支持近期范围、去重、待核对和百度下载衔接；BOOTH 已登录资料库的条目读取已进行局部实测。']},
    {kind:'notes',items:['本地测试版，尚未发布 GitHub。新增文字暂用中文，原有日英翻译保留。','BOOTH 资料库缺少购买时间，不据此发送近期蓝点；闲鱼消息行及完整后台新交付发现尚未验收完成。','AI 需要用户配置服务商密钥并同意发送范围；调用可能收费，测试使用模拟响应，没有真实付费 API 验收。','3D 预览不还原 Unity 着色器、MA、场景及物理效果；角色试穿、自动体型适配和穿模修复属于后续阶段。']}
  ]},
  {version:'1.3.0',date:'2026-10-24',channel:'stable',title:'百度网盘应用内下载',sections:[
    {kind:'added',items:['登录后，在应用页面粘贴百度分享链接、读取文件夹并下载单个文件，无需弹出下载网页。','下载进度、速度、暂停、继续、取消和完成记录集中展示，支持定位已下载文件。']},
    {kind:'notes',items:['仅登录和安全验证使用官方窗口；下载遵循百度网页权限，要求客户端的文件暂不支持。','下载保存位置由用户选择，独立子文件夹避免覆盖；重启后中断任务需重新读取分享。']}
  ]},
  {version:'1.2.9',date:'2026-10-23',channel:'stable',title:'匹配确认本地图片对照',sections:[
    {kind:'added',items:['设置新增默认关闭的“匹配确认中显示本地图片”，开启后在 BOOTH 候选前显示标记为“本地”的图片，仅供对照。']},
    {kind:'improved',items:['本地图片优先使用手动设置的封面，其次使用扫描到的本地预览图；不使用联网商品封面充当本地图片。']},
    {kind:'notes',items:['点击本地图片仅打开本地大图预览，不会确认、应用或修改商品来源。']}
  ]},
  {version:'1.2.8',date:'2026-10-23',channel:'stable',title:'Star 邀请与社区精简',sections:[
    {kind:'added',items:['第 5、10、20、50 次启动时在左下角显示 Star 邀请；点击“确认，打开 GitHub”后才打开项目页面。']},
    {kind:'improved',items:['移除赞助者名单、联网同步、刷新与缓存展示，保留贡献者、源码、反馈和社区入口。']},
    {kind:'notes',items:['提示框显示可选中复制的完整项目网址；“下次再说”或关闭均不打开浏览器，每个里程碑只提醒一次。','打开项目页失败时保留重试；50 次后的启动不再增加提醒。']}
  ]},
  {version:'1.2.7',date:'2026-10-23',channel:'stable',title:'匹配确认顶部锁定',sections:[
    {kind:'added',items:['匹配确认右上角新增小锁，默认解锁；标题、搜索、筛选和下载状态随确认内容滚动。']},
    {kind:'improved',items:['锁定后顶部固定，内容过多时可独立滚动，最多占匹配工作区高度的 45%，为候选保留空间。','小锁在滚动后仍可操作；切换保留当前素材位置与确认顺序。','“跳过自动匹配”改为醒目的整行按钮，跳过后移至“手动归类”，可稍后继续整理。','时间、本地文件和匹配依据默认折叠，手动填写商品来源也可展开输入；BOOTH 搜索保持可见。','匹配确认不再显示适配标签，原有适配资料和人工标注继续保留。']},
    {kind:'notes',items:['锁定偏好自动保存，重启、迁移及备份恢复后继续沿用；旧资料库默认解锁。']}
  ]},
  {version:'1.2.6',date:'2026-10-23',channel:'stable',title:'独立隐藏素材页',sections:[
    {kind:'added',items:['左侧“手动归类”下新增“已隐藏素材”入口与数量，集中查看隐藏条目。','独立页面支持按名称或路径搜索、定位原文件夹，以及单项或批量恢复显示、移入回收站。']},
    {kind:'improved',items:['设置中的隐藏长列表改为简短跳转入口，统一在独立页面管理。']},
    {kind:'notes',items:['恢复显示保留原有封面与人工标注；取消删除不会移动文件或改变隐藏状态。']}
  ]},
  {version:'1.2.5',date:'2026-10-23',channel:'stable',title:'右键菜单与批量整理',sections:[
    {kind:'added',items:['设置可勾选右键菜单项目、调整顺序和恢复默认；图库和匹配确认保留固定设置入口。','图库和匹配确认新增明确的批量隐藏、批量删除；隐藏名单支持单项与批量删除。','删除将原素材移入 Windows 回收站，确认前列出实际路径；合并成员去重，逐项显示成功、失败和未处理结果。']},
    {kind:'improved',items:['保护资料库、扫描根目录、Unity 工程及目录链接；不永久删除，原有标注保留，文件还原到原路径后刷新可重新显示。']},
    {kind:'notes',items:['隐藏只影响应用显示；删除会移动原素材，请核对确认窗口中的全部路径。']}
  ]},
  {version:'1.2.4',date:'2026-10-22',channel:'stable',title:'隐藏名单与重新匹配',sections:[
    {kind:'added',items:['素材右键及详情新增“从资料库隐藏”，设置可查看名单、搜索路径并单项或批量恢复。']},
    {kind:'improved',items:['强制重新匹配可把已确认、未找到或手动归类素材送回确认页；重新检索保留旧资料，确认后才替换。','闲鱼详情页新增明确的“应用此商品”；优先读取当前网页公开资料，无法读取时可填写核对后的商品名，来源支持撤回。']},
    {kind:'notes',items:['隐藏与重新匹配不删除或修改原素材；闲鱼功能仍默认关闭，仅作辅助搜索，不可用于购买。']}
  ]},
  {version:'1.2.3',date:'2026-10-22',channel:'stable',title:'联网赞助者名单',sections:[
    {kind:'added',items:['贡献者下方新增赞助者名单，从项目公开 JSON 同步昵称、头像和社交链接，无需重新发布程序。']},
    {kind:'improved',items:['名单进入页面时及每五分钟检查，支持立即刷新、本地缓存和匿名展示；联网关闭或读取失败时保留上次内容。']},
    {kind:'notes',items:['赞助者名单由维护者手动维护，不读取支付记录，不自动确认赞助到账。','赞助者名单功能已在 1.2.8 移除；此条仅保留历史发布记录。']}
  ]},
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
