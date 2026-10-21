# VRChat本地素材管理器 · VRCAL

<img src="assets/library.png" alt="VRC 素材库" width="88" />

一个支持中文、英语和日语的 Windows 桌面应用，把散落的 VRChat 素材整理成可搜索的封面图库。接入 BOOTH 自动查找商品；匹配不明确时，在内置浏览器里搜索、核对并点击「应用此商品」。

**这是一个采用 GPL-3.0 的社区开源项目，欢迎所有人共同维护。** 不会写代码也可以参与：提供匹配样例、反馈问题、翻译、测试和改善文档都能帮助项目变好。

[![Windows CI](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/actions/workflows/ci.yml/badge.svg)](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/actions/workflows/ci.yml) · [贡献指南](CONTRIBUTING.md) · [社区讨论](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/discussions) · [路线图](docs/ROADMAP.md)

**浏览和扫描保持只读；仅在主动导入时向选定 Unity 工程写入。原素材保持原样。** 整理信息、封面缓存和备份保存在用户选择的位置。

## 下载与开始使用

**[下载 Windows x64 免安装版 v1.2.1](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/releases/download/v1.2.1/VRC-Asset-Library-1.2.1-x64.exe)** · [所有版本](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/releases) · [使用说明](docs/USER_GUIDE.md) · [English guide](docs/QUICK_START.en.md) · [日本語ガイド](docs/QUICK_START.ja.md)

1. 下载 `VRC-Asset-Library-1.2.1-x64.exe`，直接运行，无需安装 Node.js 或 Unity。
2. 选择 C 盘以外的资料库保存位置。备份位置可以独立选择。
3. 选择素材目录并扫描；默认目录为 `E:\VRChat`。
4. 开启在线补全。程序先自动匹配商品，有歧义的条目进入「匹配确认」。
5. 找不到时，使用已准备好的关键词打开内置 BOOTH 搜索，核对商品后点击「应用此商品」。

**1.0.0 是首次正式发布。** 此前发布的 1.9.x、1.10.x 均为测试版，旧程序附件已撤下，旧发布下载已移除，Git 提交历史保留。由于正式版重新从 1.0.0 编号，旧测试版的内置更新不会将它视为更高版本，需手动下载并运行一次正式版；之后可继续通过内置更新升级。

升级前先退出旧版，继续使用原资料库，无需重新确认商品。如果首次询问保存位置，选择原 `VRChatAssetLibrary` 文件夹的上级目录。点击「刷新素材」补齐包装目录关系；在线补全保留人工标注。

分支可以通过 **Code → Download ZIP** 下载源码；[下载 main 分支源码 ZIP](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/archive/refs/heads/main.zip)。该 ZIP 需要自行构建；直接使用请选择上面的 Windows 免安装程序。

当前发布包未进行代码签名。请从本仓库 Releases 下载，并用随包 SHA-256 清单核对文件。

## 本次更新与更新记录

**1.2.1** 改善资料库无法读取时的重新定位，新增默认关闭的闲鱼辅助搜索。包含 1.2.0 的工程内商品读取、可选 MA 装配、导入位置回传、百度网盘目录索引（试验）和离线更新记录。工程读取与云端目录读取保持只读；主动导入或确认 MA 装配时才写入所选工程。详细步骤见 [工程与云端功能说明](docs/LOCAL-CLOUD-MA.md)。

- [GitHub Releases](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/releases)：每个正式版的功能说明、免安装程序、完整源码和校验清单；内置更新从这里读取最新正式版。
- [CHANGELOG.md](CHANGELOG.md)：随源码保存的逐版本更新日志。
- 程序左侧「更新记录」：随程序保存，断网也能查看。
- [发布维护说明](docs/RELEASING.md)：维护者发布时同步这些位置。

## 可以做什么

- **自动匹配 BOOTH 商品**：优先核对商品编号；支持作者前缀、版本／副本后缀，以及本商品明确列出的英日名称。
- **内置 BOOTH 浏览器**：可编辑搜索词，打开商品直接应用；支持官方网页登录、喜欢、Gift、已购资料库与下载登记。
- **便于处理不确定结果**：候选封面按行比较，支持手动填写链接／编号、排除、跳过、撤回来源与稳定排序。
- **分类更有依据**：人工分类优先，其后采用本商品的 BOOTH 分类；鞋袜归服装，不因衣装包里有 PNG 或 Materials 就把整套衣装分到贴图。
- **本地适配与商品支持分开显示**：灰色表示尚未发现对应本地版本的证据，不代表已经验证文件缺失。
- **合并重复展示**：符合条件的单一素材包装目录折叠成一张卡片，各层路径和人工标注保留，可展开并右键定位。
- **图库与工程管理**：标签、收藏、备注、批量标注、集合、列表、搜索筛选、工程素材线索与人工关联。
- **真实工程文件与导入**：直接浏览工程 Assets 和 Packages 依赖；从素材卡片导入到选定工程。Unity 素材包交给原生窗口确认，普通文件保留 `.meta` 复制，拒绝 GUID 冲突和覆盖。
- **读取工程内商品**：扫描 Assets 中的编号、预制件、说明链接与导入记录，按依据区分商品和待核对线索，支持登记并匹配和内置 BOOTH 搜索。
- **可选 MA 装配**：导入后选择角色与预制件，装到角色层级最底部；支持一次撤销，回传 Assets 路径，场景由用户检查后保存。
- **百度网盘目录（试验）**：独立官方网页登录，读取选定母目录与子目录，支持暂停和续读，区分仅云端／仅本地／两处都有；不下载或解压云端包。
- **可选闲鱼搜索**：在设置开启并确认提醒后，匹配确认显示“进行闲鱼尝试补全”。仅用于关键词／图片线索搜索，不提供购买；公开页面信息不足时保留已有资料，来源可撤回。
- **三种界面语言**：简体中文、日本語、English，可随时切换，素材名称和人工标注保持原文。
- **路径管理**：选择母目录递归扫描分类子文件夹，移除路径只停用扫描与显示，重新添加时恢复原有标注。
- **内置更新**：在设置中检查、下载并校验 GitHub 新版，再确认重启安装。
- **四套主题与缩放**：X 暗色、X 亮色、NASA、瑞士主题；封面保留原色，Ctrl＋滚轮调整界面大小。
- **网络任务可见**：显示正在读取的商品、下载进度、速度历史；支持并发、暂停、恢复、缓存和重试。

## 数据与文件

应用引用原文件，不提供删除、移动、重命名原素材的操作。压缩包只读查看目录，不自动解压；Unity 工程仅在用户主动导入后写入所选内容，文件浏览与扫描不会改动工程。目录链接、Unity 缓存和软件安装目录不参与素材索引。

BOOTH 补全发送商品名称、编号等检索线索。人工资料优先，商品下架或联网失败时已有资料仍可浏览。BOOTH 请求共享至少三秒的启动间隔，网站限制与验证仍由网站决定。

BOOTH 与百度网盘登录通过各自官方网页完成，持久会话保存在所选资料库中；普通备份不包含登录凭证或下载的原素材。本公开仓库和发布包不含个人资料库、Cookie、购买记录或付费素材。

## 从源码运行

开发环境：Windows x64、Node.js 24、npm。

```powershell
npm ci
npx install-electron
npm run check
npm test
npm run dev
```

生成免安装程序：

```powershell
npm run package
```

输出目录为仓库相邻的 `build-stage`。运行用户无需下载开发依赖。更多行为说明和隔离验收入口见 [完整使用与开发说明](docs/USER_GUIDE.md)。

## 一起维护

应用左侧的“贡献者与社区”页面提供贡献者社交主页、源码与反馈入口。点击“加群聊天”查看 QQ 群二维码，或复制群号 **1002563035**，聊天、催更和反馈 Bug；二维码与署名离线也能查看。

- 使用问题、经验分享和方向讨论：[Discussions](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/discussions)。
- 程序错误、匹配／分类错误和功能建议：[选择反馈模板](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/issues/new/choose)。
- 文档、设计、翻译、测试与代码：[贡献指南](CONTRIBUTING.md)，通过 Fork 和 PR 参与。
- 待讨论的改进方向：[社区路线图](docs/ROADMAP.md)。

匹配问题请附素材文件名、预期 BOOTH 链接和脱敏截图；不要上传登录凭证、付费素材或整份个人资料库。安全问题请按 [安全报告说明](SECURITY.md) 私下提交。

初始维护者：[NecoAya／八云绫](https://github.com/NecoAya)。任何人都可以提出修改，维护者负责评审、合并和发布；持续参与的贡献者可申请承担维护职责。详见 [社区治理](GOVERNANCE.md) 与 [行为准则](CODE_OF_CONDUCT.md)。

## 许可

项目自有代码采用 **[GNU GPL v3.0 only](LICENSE)**（`GPL-3.0-only`）。分发修改版时，应依 GPL 提供对应源码并保留许可与版权声明；仅供自己使用的私下修改无需公开发布。具体义务以许可证原文为准。

贡献者保留各自版权。第三方依赖与字体遵循各自许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。BOOTH、VRChat 及商品名称属于各自权利人，商品封面与素材内容不属于本项目的开源授权范围；本项目与这些平台或商品作者没有官方隶属关系。
