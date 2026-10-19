# VRCAL:VRChat-Asset-Library VRC 素材库

<img src="assets/library.png" alt="VRC 素材库" width="88" />

一个中文 Windows 桌面应用，把散落的 VRChat 素材整理成可搜索的封面图库。接入 BOOTH 自动查找商品；匹配不明确时，在内置浏览器里搜索、核对并点击「应用此商品」。

**这是一个采用 GPL-3.0 的社区开源项目，欢迎所有人共同维护。** 不会写代码也可以参与：提供匹配样例、反馈问题、翻译、测试和改善文档都能帮助项目变好。

[![Windows CI](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/actions/workflows/ci.yml/badge.svg)](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/actions/workflows/ci.yml) · [贡献指南](CONTRIBUTING.md) · [社区讨论](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/discussions) · [路线图](docs/ROADMAP.md)

**原素材和 Unity 工程保持原样。** 整理信息、封面缓存和备份保存在用户选择的位置。

## 下载与开始使用

**[下载 Windows x64 免安装版 v1.9.1](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/releases/download/v1.9.1/VRC-Asset-Library-1.9.1-x64.exe)** · [所有版本](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/releases) · [使用说明](docs/USER_GUIDE.md)

1. 下载 `VRC-Asset-Library-1.9.1-x64.exe`，直接运行，无需安装 Node.js 或 Unity。
2. 选择 C 盘以外的资料库保存位置。备份位置可以独立选择。
3. 选择素材目录并扫描；默认目录为 `E:\VRChat`。
4. 开启在线补全。程序先自动匹配商品，有歧义的条目进入「匹配确认」。
5. 找不到时，使用已准备好的关键词打开内置 BOOTH 搜索，核对商品后点击「应用此商品」。

升级前先退出旧版。继续使用已有资料库后，点击「刷新素材」补齐包装目录关系；在线补全会逐步复评旧自动结果，保留人工标注。

当前发布包未进行代码签名。请从本仓库 Releases 下载，并用随包 SHA-256 清单核对文件。

## 可以做什么

- **自动匹配 BOOTH 商品**：优先核对商品编号；支持作者前缀、版本／副本后缀，以及本商品明确列出的英日名称。
- **内置 BOOTH 浏览器**：可编辑搜索词，打开商品直接应用；支持官方网页登录、喜欢、Gift、已购资料库与下载登记。
- **便于处理不确定结果**：候选封面按行比较，支持手动填写链接／编号、排除、跳过、撤回来源与稳定排序。
- **分类更有依据**：人工分类优先，其后采用本商品的 BOOTH 分类；鞋袜归服装，不因衣装包里有 PNG 或 Materials 就把整套衣装分到贴图。
- **本地适配与商品支持分开显示**：灰色表示尚未发现对应本地版本的证据，不代表已经验证文件缺失。
- **合并重复展示**：符合条件的单一素材包装目录折叠成一张卡片，各层路径和人工标注保留，可展开并右键定位。
- **图库与工程管理**：标签、收藏、备注、批量标注、集合、列表、搜索筛选、工程素材线索与人工关联。
- **三套主题与缩放**：X 暗色、NASA、瑞士主题；封面保留原色，Ctrl＋滚轮调整界面大小。
- **网络任务可见**：显示正在读取的商品、下载进度、速度历史；支持并发、暂停、恢复、缓存和重试。

## 数据与文件

应用引用原文件，不提供删除、移动、重命名原素材的操作。压缩包只读查看目录，不自动解压；Unity 工程不自动导入或修改。目录链接、Unity 缓存和软件安装目录不参与素材索引。

BOOTH 补全发送商品名称、编号等检索线索。人工资料优先，商品下架或联网失败时已有资料仍可浏览。BOOTH 请求共享至少三秒的启动间隔，网站限制与验证仍由网站决定。

BOOTH／闲鱼登录通过官方网页完成，持久会话保存在所选资料库中；普通备份不包含登录凭证或下载的原素材。本公开仓库和发布包不含个人资料库、Cookie、购买记录或付费素材。

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

- 使用问题、经验分享和方向讨论：[Discussions](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/discussions)。
- 程序错误、匹配／分类错误和功能建议：[选择反馈模板](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/issues/new/choose)。
- 文档、设计、翻译、测试与代码：[贡献指南](CONTRIBUTING.md)，通过 Fork 和 PR 参与。
- 待讨论的改进方向：[社区路线图](docs/ROADMAP.md)。

匹配问题请附素材文件名、预期 BOOTH 链接和脱敏截图；不要上传登录凭证、付费素材或整份个人资料库。安全问题请按 [安全报告说明](SECURITY.md) 私下提交。

初始维护者：[NecoAya／八云绫](https://github.com/NecoAya)。任何人都可以提出修改，维护者负责评审、合并和发布；持续参与的贡献者可申请承担维护职责。详见 [社区治理](GOVERNANCE.md) 与 [行为准则](CODE_OF_CONDUCT.md)。

## 许可

项目自有代码采用 **[GNU GPL v3.0 only](LICENSE)**（`GPL-3.0-only`）。分发修改版时，应依 GPL 提供对应源码并保留许可与版权声明；仅供自己使用的私下修改无需公开发布。具体义务以许可证原文为准。

贡献者保留各自版权。第三方依赖与字体遵循各自许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。BOOTH、VRChat、闲鱼及商品名称属于各自权利人，商品封面与素材内容不属于本项目的开源授权范围；本项目与这些平台或商品作者没有官方隶属关系。
