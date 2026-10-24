# 参与 VRCAL

欢迎一起维护 VRCAL。你不需要先成为开发者：复现问题、提供匹配样例、改善中文文案、翻译、测试界面和整理文档都很有价值。

## 从哪里开始

| 你想做的事 | 入口 |
| --- | --- |
| 提问、分享用法、讨论方向 | [Discussions](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/discussions) |
| 报告程序错误 | [Bug 模板](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/issues/new?template=bug_report.yml) |
| 提交匹配／分类错误样例 | [匹配问题模板](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/issues/new?template=matching.yml) |
| 提功能建议 | [功能建议模板](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/issues/new?template=feature_request.yml) |
| 找适合初次贡献的任务 | [good first issue](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/labels/good%20first%20issue)、[路线图](docs/ROADMAP.md) |
| 报告安全问题 | [安全报告说明](SECURITY.md) |

这些入口向所有人开放。`good first issue` 列表会随着问题整理逐步补充，不代表当前已有认领任务。

## 提交问题

先搜索已有 Issues。请说明版本、Windows 版本、复现步骤、预期行为和实际行为；截图请遮住用户名、购买记录、登录信息及个人路径。

匹配问题通常只需要本地文件名、正确的公开 BOOTH 商品链接、错误结果以及匹配依据。不要上传付费素材、整个 Unity 工程、Cookie、签名下载链接、个人数据库或包含凭证的浏览器日志。

## 修改代码

交互改动遵循[产品原则：尽量自动，尽量少操作](docs/PRODUCT_PRINCIPLES.md)：首次必要授权后复用选择，正常后台处理不弹窗、不抢焦点，只把确实需要用户决定的步骤留给用户。

正式仓库和首页内容由项目维护者控制。社区贡献者通过 Fork/PR 提交完整源码的改进，由维护者审阅合并；维护者可以直接提交自己的修改。新许可下的对外版本统一由本项目发布，不授权贡献分支独立发行。GitHub 平台允许的查看和 Fork 不受影响。

1. Fork 本仓库并从最新 `main` 创建自己的分支。
2. 大功能、数据库格式或匹配策略调整先发 Issue／Discussion；小修复可直接提交 PR。
3. 尽量让每个 PR 只解决一个清晰问题，写明改动前后行为。
4. 为匹配、分类、目录、数据迁移、网络或权限行为的修改补充有意义的回归测试。文案和排版等小改动不要求形式化测试。
5. 运行下面的检查，向本仓库 `main` 提交 PR，并回应评审意见。

开发需要 Windows x64、Node.js 24 和 npm：

```powershell
npm ci
npm run check
npm test
npm run build
```

运行桌面界面还需要 Electron 运行时。使用 `npx install-electron` 安装，再执行 `npm run dev`。一般使用者下载 Releases 中的程序即可。

首次做界面测试，请使用隔离资料库和你自己创建的空白素材目录。以下示例在系统临时目录里新建本次测试目录，禁用联网与自动扫描：

```powershell
$demoBase = Join-Path ([IO.Path]::GetTempPath()) ('vrcal-dev-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $demoBase 'Materials') -Force | Out-Null
$env:VRC_LIBRARY_DATA_DIR = Join-Path $demoBase 'Library'
$env:VRC_LIBRARY_ROOT = Join-Path $demoBase 'Materials'
$env:VRC_LIBRARY_NO_NETWORK = '1'
$env:VRC_LIBRARY_NO_AUTOSCAN = '1'
npm run dev
```

这些变量只影响当前终端。完成测试后关闭该终端；测试目录由你确认后清理。不要使用真实购买资料库作为测试样例。

## 代码位置与项目约束

- `src/main/`：扫描、数据库、搜索、匹配、联网及窗口隔离。
- `src/renderer/`：React 界面与三套主题。
- `src/shared/contracts.ts`：主进程与界面共享的数据结构。
- `tests/`：离线自动测试与精简样例。
- `scripts/`：独立界面验收、启动检查及打包工具。

原素材和 Unity 工程的只读约束是项目的基本原则。人工来源／分类优先；不确定结果应保留待确认。联网访问遵守站点规则和现有请求间隔，远程网页不获得桌面接口。测试使用合成文件和最小化网页样例，公共 CI 不访问用户账号、不批量请求 BOOTH。

## PR 与自动检查

每个 PR 会执行 Windows 类型检查、离线测试和生产构建。外部贡献者的 Actions 首次运行可能需要维护者批准。PR 工作流只有只读权限，不使用发布密钥或个人资料库。

外部贡献通过 PR，由维护者评审合并。仓库所有者可以直接修改并提交到 `main`，不要求为自己的日常修改创建 PR；直接提交同样触发自动检查。直接写入和发布版本的权限由维护者管理，开放社区参与不会自动授予写入权限。

## 署名与许可

当前采用 [VRCAL 社区协作许可 1.0](LICENSE)，这是源码可见许可，不是标准开源许可。请先阅读 LICENSE，特别是第 5 条的贡献授权，并在 PR 中勾选许可确认。提交时提供完整、可修改的源代码及必要构建信息，不提交仅供合并的不透明二进制替代物。

你保留贡献的版权和署名；不要求转让版权。你需有权按此许可提供改动，并允许 NecoAya 及其授权的本项目维护者将其集成到官方项目，以本许可发布对应源码和程序。此授权不允许维护者将你的贡献另改为闭源发布；今后变更许可仍须取得相应权利人的必要授权。

第三方代码、字体或资源必须注明来源并保留其原许可。不能把仅按 GPL 获得的他人代码改贴本许可；无法兼容时先讨论，不直接合并。商品封面与付费素材不会因被应用展示而获得项目代码授权。

本次变更不撤销此前 GPL 授权；旧提交和仍带 GPL 声明的兼容助手按原许可处理，见 [许可变更说明](docs/LICENSING.md)。

参与时请遵守 [社区行为准则](CODE_OF_CONDUCT.md)。维护职责与参与方式见 [社区治理](GOVERNANCE.md)。

## 应用内贡献者署名

署名以可核实的实际贡献为依据，包括代码、文档、翻译、测试和有效反馈；仅创建 Fork 或复制仓库不作为贡献条目。记录贡献内容及对应提交、PR、Issue 或其他可核实依据，保留已有实际贡献的版权与署名。

代码、翻译、文档、测试和反馈都欢迎参与。希望在应用中署名时，请附上希望显示的名字及本人同意公开的社交链接。此版本的名单集中维护在 `src/shared/community.ts`；可以单独提交署名修改。应用离线展示该名单，“查看全部贡献者”链接到 GitHub 的实时贡献记录。

头像可放入 `assets/contributors/`，在署名记录的 `avatar` 字段填写文件名；应用会将图片作为本地资源打包，无需联网加载。
