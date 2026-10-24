# 角色与衣服组合预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 让用户找到 3D 入口、看衣服款式，并选择本地角色作静态上身参考。

**Architecture:** 原有只读离线读取器扩展为原子双槽场景；独立资源命名空间，共享场景预算。Three.js 保持文件原坐标和骨架树，只在衣服外层应用手动变换。

**Tech Stack:** Electron、TypeScript、React、Three.js、node:test、Playwright。

**Spec:** 用户最新截图及“看款式、穿在角色身上的感觉”；沿用用户已选“不依赖 Unity，先做轻量模型预览”。

## Global Constraints

- 原素材、角色及工程只读，不解包安装、不启动 Unity。
- 仅按用户选择读取库中条目，不为角色选择全库解包索引。
- 不自动合骨骼、不做跨角色适配、试穿保证或穿模检测，组合状态始终显示适配未验证。
- 场景共享原始字节 128 MiB、贴图解码 128 MiB、最多 96 文件、300 万三角面；保留现有单文件上限。
- 支持目录、ZIP、Unitypackage 中现有格式；RAR／7z 仍明确提示先使用解压目录。

## Review Focus

- 角色变更、关闭或取消后旧读取不能回流；两槽 token 不可混用或跨窗口使用。
- 相同文件名／贴图名不得互串，第二槽不能绕过总预算。
- 不独立归一化身高，不将裙子自动放大到角色全身高度。
- 隐藏部件与手调只影响当前外层，不重绑／拆散蒙皮树。
- 980px／200% 与四主题保留控制能力及模型原色。

### Task 1: 双槽读取与安全边界（后端子代理）

**Files:** src/shared/model-preview.ts；src/main/model-preview-{window,reader,worker,files,preload}.ts；tests/model-preview-scene*.test.cjs。

**Interfaces:** ModelSceneBundle{primary,reference?}；sources(query?)；selectReference(id|null)；loadScene(primaryToken,referenceToken?)。保留旧 state/load/cancel。

- [x] 失败回归覆盖双槽总预算、授权、过期 token、取消与索引 deadline。
- [x] 同一离线 worker 串行读取两槽，原子返回，旧接口兼容。
- [x] 聚焦测试通过。

### Task 2: 双槽画面与资源管理（渲染子代理）

**Files:** src/renderer/model-viewer.ts、model-scene.ts；tests/model-scene*.test.cjs。

**Interfaces:** loadScene；setPrimaryTransform；setLayerVisible；setView；parts；setPartVisible。旧 load 包装为单槽。

- [x] 先红后绿验证原坐标、总面数、变换不改变骨骼树与各槽释放。
- [x] 双槽独立加载资源并合并相机范围；组合停用内置动画。
- [x] 聚焦测试及类型检查通过。

### Task 3: 入口、操作与交付（主代理）

**Files:** src/shared/context-menu.ts；src/renderer/main.tsx、model-preview.tsx/css；src/main/main.ts；使用说明、版本记录与验收脚本。

- [x] 增加可配置的右键 3D 入口，保留原偏好和只允许单个本地素材。
- [x] 增加角色条目／模型选择、显隐、角色部件、衣服手调与前后侧视；错误清楚说明。
- [x] 合成角色＋衣服实际渲染、资源隔离、取消、四主题、缩放及源哈希检查。
- [x] 完整类型检查与回归通过；源码版单模型及组合实际窗口验收通过。
- [ ] 最终打包启动、对应源码与验收记录交付并同步 GitHub（以发布附件和发布后核对记录为准）。

## Rulings

- 本轮由实现代理选择“本地角色模型＋衣服静态组合”，不把 Unity 工程中改好的场景或 MA 效果伪装成已还原。
- 用户曾明确要求自主落地，继续实施；新增文案按其要求暂缓翻译，精确记录延后文案。

## 实施验收记录

984 项回归全部通过。双槽源预算、内嵌图片、撤销授权、取消与多模型等待有先红后绿回归；交叉评审补齐混合线／点／精灵释放以及 FBX 文件名数据 URI 限制。源码版真实 Electron 已检查单模型和双模型像素、部件显隐、四主题、980px／200% 与合成源哈希。最终打包及公开发布结果在同版本 Release 验收附件记录，不把合成模型宣称为真实角色适配。
