# 下载后局部入库与多选归组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Follow the checkboxes and keep independent file ownership.

**Goal:** 下载完成立即更新素材库，支持勾选多个百度分享文件并依次下载，将同一商品的材质与适配包放在应用新建的同一目录。

**Architecture:** 完成事件只登记完成文件并发送 change，不触发 Scanner 全局扫描。下载目录由共享 DownloadFolders 分配；BOOTH 使用明确官方商品ID，百度使用分享范围加保守文件族。远程页面仍只能操作官方正常下载控件。

**Tech Stack:** Existing Electron, TypeScript, React, node:test, SQLite JSON metadata; no new dependency.

**Spec:** 用户 2026-10-25 的下载即入库、同商品文件归组与勾选下载请求；沿用此前直接实施、默认同步 GitHub 的授权。

## Global Constraints

- 不移动、重命名或覆盖已有素材，不自动解压、不自动导入 Unity。
- 原素材、工程、sources 只读；仅为明确点击的新下载分配可写目录。
- 下载完成与入库成功分开显示；入库失败保留已下载文件并允许重试。
- 未知来源不凭文件名跨分享、跨商品合并；人工来源与跳过优先。
- 不扩展登录读取范围；未核对日期的链接仍进入时间待核对，不冒充新链接。
- 公开预览发布同提交源码、程序、说明、验收和 SHA-256，稳定更新入口不变。

## Approaches

全局刷新会重复读取所有素材，不符合请求。自动移动既有文件会改变用户目录，不采用。采用下载完成事件定点入库；智能归组只影响本轮新下载。共享分组日志和独占目录标记防止复用用户原有目录；同名下载不覆盖。

## Review Focus

- 同名文件、并发任务和 .part 已存在：创建另一个受管目录，保留原文件名。
- 链接目录、受保护目录、伪造标记：拒绝写入，不扩大根目录范围。
- 多选中包含目录或过期行：整批拒绝；中断、退出、离线停止后续队列。
- 局部入库、重启、备份恢复和文件查看：新百度记录与 BOOTH 分组均保留，重复登记复用原ID。
- 闲鱼识别失败：区分旧运行程序与当前解析规则；只修复可复现缺口，标明未验证的真实账号环节。

### Task 1: 受管下载目录

Files: src/main/download-folders.ts, tests/download-folders.test.cjs.

- [x] 先验证缺失行为失败，再实现 DownloadFolders.reserve(directory,provider,sourceKey,label,filename)。
- [x] 验证同源同族复用、跨源分离、已存在文件避让、重启、隐私、目录替换和源文件哈希。

### Task 2: 百度队列与完成事件

Files: src/main/baidu-downloads.ts and tests/baidu-downloads*.test.cjs.

- [x] 先覆盖批量校验、串行、取消/离线、完成回调和重试入库，再实现 downloadMany/cancelBatch/retryImport。
- [x] 新任务写入受管目录；旧 UUID 历史仍可定位。完成后回调只传完成文件，不保存分享凭证。

### Task 3: BOOTH 同商品下载

Files: src/main/booth-workspace.ts and BOOTH download tests.

- [x] 明确商品ID在下载前归组；异步来源仅尝试安全归组当前新完成文件，失败保留原新下载。
- [x] 保留旧任务路径和恢复，不移动历史，不重复入库。

### Task 4: 应用整合与界面

Files: src/main/booth-import.ts, store.ts, grouping.ts, main.ts, preload.ts, src/shared/contracts.ts, baidu-download.ts, src/renderer/baidu-download-panel.tsx/.css.

- [x] 泛化受信下载登记及严格下载路径白名单，覆盖重启、备份恢复、文件查看和工程导入范围。
- [x] 勾选/全选当前文件、下载所选、待下载数、取消后续队列、完成入库反馈；原单文件入口保留。
- [x] 可信 BOOTH 明确来源即参与展示聚合，保留人工与冲突边界。

### Task 5: 交付

- [ ] 类型、完整回归、构建、实际隔离打包界面验证；不打开真实账号或原素材。
- [ ] 更新中文指南、应用内记录、README/CHANGELOG；审核公开范围。
- [ ] Windows CI 通过后提交/发布准确源码的 preview.14，验证附件与下载入口。

源码快照保留发布前状态；正式打包、完整测试和发布校验以随包 Acceptance 与 Post-Release-Verification 记录为准。独立审核发现的异步完成文件替换、目录标记复制、历史重复目录与迁移遗漏均已新增回归并修正。
