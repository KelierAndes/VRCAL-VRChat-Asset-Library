# 第三方组件、资源与参考来源

本项目当前自有代码采用 [VRCAL 社区协作许可 1.0](LICENSE)，此前 GPL 授权不受影响，详见 [许可变更说明](docs/LICENSING.md)。以下第三方组件、字体及其原始许可声明继续适用各自许可证；新许可的限制不适用于这些独立组件，也不覆盖商品作者的封面、模型或其他素材内容。

`assets/unity/` 中仍标注 GPL-3.0-only 的 Editor 助手及其兼容副本继续按原 GPL 许可提供，用于工程导入与已有助手识别；本次不修改这些文件。GPL 完整文本保存在 [licenses/GPL-3.0-only.txt](licenses/GPL-3.0-only.txt)。

本项目使用以下第三方组件；组件版权与许可证归原作者所有。这里分别说明运行依赖、资源、开发工具和接口／设计参考，不把它们全部记为自研，也不把仅有的参考链接写成代码依赖。

核对日期：2026-10-26；依赖版本基于 `1.4.0-preview.15` 的 `package-lock.json`。完整的 29 个非 dev 包条目见 [运行依赖许可索引](licenses/README.md)，对应原始版权与许可正文均有本地副本；[机器可读清单](licenses/runtime-packages.json) 记录版本、上游地址、许可文件 SHA-256 和锁文件中的包完整性值。这个清单不展开 Electron 内含组件，也不代表全部历史版本已经完成许可核验。

## 主要运行组件

| 组件与上游 | 版本 | 用途 | 完整许可正文 |
| --- | --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 44.9.3 | 桌面窗口、浏览器与主进程运行时 | [MIT](licenses/Electron-MIT.txt) |
| [React](https://github.com/facebook/react) | 19.3.0 | 界面组件 | [MIT](licenses/runtime/react-19.3.0.txt) |
| [React DOM](https://github.com/facebook/react) | 19.3.0 | 界面渲染 | [MIT](licenses/runtime/react-dom-19.3.0.txt) |
| [Cheerio](https://github.com/cheeriojs/cheerio) | 1.1.2 | HTML 解析与商品元数据读取 | [MIT](licenses/runtime/cheerio-1.1.2.txt) |
| [Three.js](https://github.com/mrdoob/three.js) | 0.186.1 | 轻量 3D 预览、模型加载器与 OrbitControls | [MIT](licenses/three-MIT.txt) |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.2 | Three FBX Loader 内置的解压副本 | [MIT](licenses/fflate-MIT.txt) |
| [yauzl](https://github.com/thejoshwolfe/yauzl) | 3.4.0 | ZIP 读取 | [MIT](licenses/runtime/yauzl-3.4.0.txt) |
| [boolbase](https://github.com/fb55/boolbase) | 1.0.0 | CSS 选择器链中的间接依赖 | [ISC](licenses/boolbase-ISC.txt) |

间接依赖还包括 scheduler、Undici、pend、HTML/CSS 解析与字符编码组件；具体版本和版权人见上述完整索引与原始正文。Three 附带的 fflate 文件头还注明了与 [UZIP.js](https://github.com/photopea/UZIP.js) 的部分代码相似关系；保留该上游说明，不将这些实现记作 VRCAL 原创。

发布的 Electron 运行时应同时保留其 `LICENSE.electron.txt` 和 `LICENSES.chromium.html` 等随附声明，后者包含 Chromium、Node.js 及其他内含组件的许可资料；本页的 Electron MIT 文本不替代它们。

## 字体与图标

- **Inter 字体**：Copyright (c) 2016 The Inter Project Authors；[上游项目](https://github.com/rsms/inter)，[SIL Open Font License 1.1 全文](assets/fonts/Inter-OFL.txt)。
- **Feather 图标的相关几何片段**：Copyright (c) 2013-2023 Cole Bemis；[上游项目](https://github.com/feathericons/feather)，[MIT 全文](licenses/Feather-MIT.txt)。核对发现 `src/renderer/main.tsx` 的 `users` 图标包含与 Feather 一致的曲线和圆形，部分主路径坐标有改动；该文件及 `src/renderer/gallery.tsx` 的心形路径也与 Feather 心形存在数值调整后的相似。对照固定提交为 `3dc050d97405062eba78aa57115c0a15c63abdaa`（[users](https://github.com/feathericons/feather/blob/3dc050d97405062eba78aa57115c0a15c63abdaa/icons/users.svg)、[heart](https://github.com/feathericons/feather/blob/3dc050d97405062eba78aa57115c0a15c63abdaa/icons/heart.svg)）。本次为相关部分补充署名和许可；最初输入来源记录尚未完整确认，不据此声称整套图标均出自 Feather，也不将重合部分声明为完全原创。

## 接口与功能实现参考

- **Modular Avatar**：使用用户工程中已安装的 MA 完成相应装配能力，本应用提供导入、选择、调用和结果记录流程，不随应用打包 MA 插件本体。[项目与作者](https://github.com/bdunderscore/modular-avatar) · [官方文档](https://modular-avatar.nadena.dev/docs/intro)。桥接层使用的公开方法 `SetupOutfitUI(GameObject)` 见 [MA 上游实现](https://github.com/bdunderscore/modular-avatar/blob/main/Editor/SetupOutfit.cs)；方法查找使用 [.NET Type.GetMethod](https://learn.microsoft.com/en-us/dotnet/api/system.type.getmethod) 所规定的反射接口。调用接口不表示本项目拥有插件本体的版权。
- **Unity 与 VRChat**：工程导入和角色工作流使用用户已安装的 Unity／SDK；相关能力和限制参考 [Unity 文档](https://docs.unity3d.com/Manual/index.html)、[VRChat Creator 文档](https://creators.vrchat.com/)。更具体的工作流参考列在 [改模工作流报告](docs/AVATAR_WORKFLOW_REPORT.zh-CN.md)。
- **公开插件目录**：各插件的作者官方发布页、下载入口和使用方式见 [公开插件说明](docs/PUBLIC_PLUGINS.zh-CN.md) 与 [来源核对清单](docs/PUBLIC_PLUGIN_SOURCES_20261024.json)。目录条目是介绍和安装入口，不代表 VRCAL 是插件作者；用户另行获取的插件继续遵守原许可。

## 设计与规划参考

- **X 主题**：以 X 的深浅配色与界面风格作为视觉参考。这是设计参考说明，不表示品牌授权或官方关联。
- **AstroLens**：维护者提出参考其自然语言检索体验；[官方介绍](https://www.astrolens.dev/about/)及借鉴范围见 [路线图](docs/ROADMAP.md)。这里记录的是检索与交互思路，未接入其合作数据库或服务接口，也不将其搜索能力作为已完成的 VRCAL 功能。

## 开发与测试工具

以下为当前锁定版本的直接开发工具，不将它们列为随应用运行的 npm 依赖。工具本身及其间接依赖仍遵守各自原许可；Electron 虽列在 devDependencies，实际运行时已在上文单独列出。

| 工具与上游 | 锁定版本 | 许可标识 |
| --- | --- | --- |
| [TypeScript](https://github.com/microsoft/TypeScript) | 5.9.3 | Apache-2.0 |
| [Vite](https://github.com/vitejs/vite) | 7.3.7 | MIT |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | 5.2.0 | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 26.15.3 | MIT |
| [@electron/asar](https://github.com/electron/asar) | 3.4.1 | MIT |
| [Playwright](https://github.com/microsoft/playwright) | 1.64.0 | Apache-2.0 |
| [DefinitelyTyped 类型声明](https://github.com/DefinitelyTyped/DefinitelyTyped) | @types/node 24.19.2、react 19.3.0、react-dom 19.3.0、three 0.186.0、yauzl 2.10.3 | MIT |

## 商品、平台与发布范围

商品封面、模型、纹理、商品名称及平台标识仍属于各自权利人；本项目的代码许可不授予这些素材的再分发或商业使用权。测试中的 BOOTH HTML 为精简公开商品元数据样例，不包含账号会话、素材包或商品图片。

2026-10-26 的补充仅更新仓库中的来源说明、许可正文与核对索引，不更改应用版本号，也不会自动更新此前已发布的安装包。后续按现有配置构建时会收录 `licenses/**/*` 和本文件，发布前仍需核验实际包内文件。旧版授权与本项目现行许可边界继续按 [许可变更说明](docs/LICENSING.md) 处理。
