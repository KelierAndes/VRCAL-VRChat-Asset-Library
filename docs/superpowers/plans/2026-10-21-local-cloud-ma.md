# 本地云端目录与 MA 菜单实现计划

> 按独立模块实现，主协调者集成并验证；使用 executing-plans 执行，独立实现模块依 dispatching-parallel-agents 并行处理。用户已授权本地开发，禁止任何远程提交或发布。

**Goal:** 完成可配置、可验证的网页登录目录识别与云端标记，导入后可在 Unity 中配置 MA 开关。
**Architecture:** 云端目录与本地素材记录隔离；新增窄 IPC。原导入桥保持原样，新 MA 桥独立监听请求和导入回执。主进程校验所有路径与身份，远程网页没有桌面 API。
**Tech Stack:** 现有 Electron/React/TypeScript/SQLite；Unity 2022.3 Editor；反射访问已安装 MA，避免强制程序集依赖。
**Spec:** ../specs/2026-10-21-local-cloud-ma.md

## Constraints
- 仅本地，不 push／PR／release；只读原素材、用户实际 Unity 工程和 sources。
- 网页读取只含明确可见目录元数据；未知／部分不当作完整同步，不自动下载/上传/删除。
- 明确选择角色和 Prefab；MA 状态与文件导入状态分开，Unity Undo 撤回，不自动保存。

## Review focus
- 网站虚拟列表／分页误当全目录；未加载内容不产生缺失结论。
- 账号切换混合数据；会话身份变化隔离索引。
- 缺插件、编译失败、空场景；保持已导入文件且解释待处理步骤。
- 导入后域重载／重启；请求身份校验且不重复挂载。
- 旧桥安装与本地备份恢复；未知自定义文件不覆写，凭证不进备份。

## Task A: MA Editor 独立模块
Files: assets/unity/VRCALMASetup.cs, VRCALMASetup.Editor.asmdef; scripts/native-ma-setup-test.cjs.
- [x] 先用隔离测试确认无实现失败，再实现请求读取、状态回执、角色/Prefab 选择、保留预设或生成 MA 开关、Undo 与失败回滚。
- [x] 输入协议 schema1,id(uuid),sha256,projectPath,sourceName,mode(copy/unitypackage),prefabPaths(Assets/下),sourcePackageName；目录 MARequests / MAResults；结果 state waiting-import/waiting-selection/applied/skipped/error。
- [x] 编译与合成工程验收；准确注明真实组件或桩组件覆盖范围。

## Task B: 百度网页登录独立模块
Files: src/main/baidu-workspace.ts, baidu-page.ts; assets/baidu-workspace.html; optional preload only for local toolbar.
- [x] 请求约束与 DOM 提取测试先红后绿；页面不识别拒绝，不猜未知字段。
- [x] 主动捕获当前可见目录，含路径与部分范围信息；身份来自本独立登录会话，切换身份隔离；不暴露 Cookie。
- [x] 导出 BaiduWorkspace 类：open(),state(),capture(),shutdown(),networkChanged(),clearSession()；依赖 parent/dataDir/roots/canNetwork/getTheme/getLanguage/onChanged；由 parent 接收 capture，不写本地素材。

## Task C: 主进程、资料库和界面
Files: shared cloud-contracts/project-contracts/contracts; main cloud-catalog/store/main/preload/project-import/project-access/storage; renderer cloud-page/project-tools/main; messages.
- [x] 云端匹配与备份校验回归先红后绿；独立目录保存在现有 SQLite settings 键，凭证另存会话。
- [x] 本地列表只附加位置状态；云端独立页面显示全部读取条目，提供人工关联与忽略；云端条目永不冒充本地路径。
- [x] 预览令牌绑定 maSetup；独立安装新助手，写有身份回执的 MA 请求；复制完成或包成功后再配置。历史区分文件导入和 MA 状态。
- [x] 接入中日英、四主题、可读错误与缺依赖指引。

## Task D: 集成与交付
- [x] 类型检查、相关回归和完整套件；隔离 Electron UI、Unity 原生合成验收、源文件哈希。
- [x] 最终独立安全/行为审查，修正阻断；本地免安装试验包、源码、说明与验收范围。保持远程 main 为原 503978b。

## 验收边界
- 真实百度登录后的 DOM 兼容性仍待用户现场验证，尚未取得成功读取证据。
- 网盘母目录递归、翻页和滚动抓取不在当前试验实现中；本地递归扫描沿用既有功能。
- MA 已完成真实运行时事务测试，但未执行完整 SDK Editor 构建或上传验收。
