# 改模工作台与装配菜单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将工程检查、素材导入、MA 装配菜单和结果检查连成可用的改模流程。

**Architecture:** 沿用 ProjectImports 和 Unity MA 助手；新增只读工程准备度读取、导入前检查、专属工作台和用户检查记录。工作台不读取私有插件内容，不把包声明当成 Unity 运行验证。

**Tech Stack:** Electron / React / TypeScript / SQLite settings / Unity Editor C# reflection.

**Spec:** docs/AVATAR_WORKFLOW_REPORT.zh-CN.md

## Global Constraints
- 原素材只读；仅在用户点导入后向指定工程写入已有专用目录。
- 真实工程不用于自动化测试；用合成工程验证 Unity 与 Electron。
- 当前工作树为既有隔离功能分支，保留全部此前未提交改动；本轮不推送 GitHub。
- 新文案暂为中文；轻量预览仍不启动 Unity。
- 未测的真实商业角色、SDK 上传、网络同步不标记已通过。
- 用户已明确要求写完执行并不再反复询问，按本计划连续执行。

## Review Focus
- 同内容换路径或名称，以及两个同时生成的旧预览：执行时重新检查重复。
- VPM 声明与包实际文件不一致：标记 unknown/declared，不误报 ready。
- 旧助手回执缺少新菜单结果：保留导入结果，提示更新助手，不冒充菜单完成。
- 菜单创建失败或已有作者预设：回滚整次装配/保留预设，不出现双实例。
- 切换工程时异步响应串入当前页面：取消过期响应，检查记录按 job ID 保存。

### Task 1: 准备度与导入检查
**Files:** Create src/shared/avatar-workbench.ts, src/main/project-readiness.ts; modify project-contracts.ts, project-import.ts; test tests/project-workbench.test.cjs.
**Interfaces:** readProjectReadiness(project:ProjectAccess):Promise<ProjectReadiness>; ProjectImports.readiness(projectId); preview.preflight; options.allowRepeat; ProjectImports.review(id,checks).
- [x] 添加依赖状态、包改名重复、重复执行、人工检查重启回归；先验证失败。
- [x] 实现只读准备度、结构化检查、重复确认及执行时复核、严格检查记录保存。
- [x] 运行聚焦回归及类型检查，保存结果。

### Task 2: 装配同时接入菜单
**Files:** modify assets/unity/VRCALMASetup.cs, src/main/project-ma.ts, project-helper.ts, project-import.ts; preserve exact predecessor assets/unity/legacy/VRCALMASetup.v3.cs.txt; tests/project-ma.test.cjs and native acceptance script.
**Interfaces:** options.maMenuWithAssembly:boolean; request.menuWithAssembly:boolean; receipt.menuMode:'preserved'|'created'; maSetup.menuWithAssembly/menuMode.
- [x] 添加请求校验、历史助手升级、缺新回执及恢复测试并验证失败。
- [x] 同一 Undo 中装配和菜单，已有预设优先、无预设生成独立开关，失败回滚、实例保持末尾。
- [x] 真实合成 Unity/MA 测试菜单创建、预设保留、重复请求、失败回滚和撤销。

### Task 3: 应用工作台与连贯结果
**Files:** create src/renderer/avatar-workbench.tsx/.css and import-progress.tsx; modify main.tsx, project-tools.tsx, contracts.ts, preload.ts, main.ts, store.ts.
**Interfaces:** LibraryAPI.projectReadiness, reviewProjectImport, selectWorkbenchProject; AppSettings.workbenchProjectId; ProjectTools 初始菜单联动选择沿用导入页。
- [x] 工作台项目选择、准备度、记录筛选与分页、文件/商品/导入/诊断/插件入口。
- [x] 导入页显示预检查与显式再次导入选项，装配下附带菜单选项。
- [x] 共用分步状态与持久化用户检查，清楚显示未知/需要处理；异步响应不串项目。
- [x] 实际 Electron 四主题、980px/200%、空态、重启和原素材哈希验收。

### Task 4: 报告与交付
**Files:** report, usage guide, WORK_PLAN, CHANGELOG, release-notes, package.json/lock, output folder.
- [x] 更新报告实施记录与后续边界，制作可离线阅读 HTML 报告和实机图文说明。
- [x] 全套回归、构建、独立审查，处理重要问题并再次聚焦验证。
- [x] 打包 1.4.0-preview.4；检查真实启动、重启、运行时依赖和源文件哈希。
- [x] outputs 交付免安装程序、完整源码、报告、截图、说明与验收记录；不发布 GitHub。
