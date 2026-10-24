# 闲鱼连接修复与免密钥找素材 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** 修复闲鱼聊天断连与关闭崩溃，提供内置检索提示词和免 API 密钥的网页 AI 辅助。

**Architecture:** 保持原有站内搜索与 API 流程；网页 AI 使用用户主动复制、官网对话及 JSON 回填，不使用非公开接口。闲鱼在现有隔离会话内修复生命周期和严格 WebSocket allowlist。

**Tech Stack:** Electron、React、TypeScript、node:test、Playwright。

**Spec:** 用户本轮截图与说明；先前“尽量少操作”“暂缓翻译”“完成后上传 GitHub”的持续要求。实现方式由维护代理按现有结构选择。

## Global Constraints

- 原素材及真实账号内容不进入测试或发布包。
- 无密钥关键词规则与真正 AI 分开标示；网页 AI 仍需用户在官网正常操作，不声称可静默调用。
- 网页返回只能提供有界检索词，不提供可直接执行的商品链接或代码。
- 官方网页域名固定，不接受返回内容指定打开地址。

## Review Focus

- 已销毁窗口、迟到事件不得访问 BrowserWindow getter 或恢复采用权限。
- WebSocket 只允许已核实官方端点、GET、标准 TLS 端口，仍检验 DNS 和联网开关。
- 无 API 密钥时不调用付费服务、不计入 API 额度，仍能检索真实商品。
- 错误或超大网页回答不清空已有结果；取消任务不接收迟到结果。
- 980px 与 200% 缩放下的网页辅助表单和主要按钮可使用。

### Task 1: 闲鱼生命周期及连接（子代理）

**Files:** src/main/xianyu.ts；tests/xianyu*.test.cjs。

- [x] 先用销毁后 getter 抛错的窗口、迟到网络事件写失败回归。
- [x] 捕获稳定引用、撤销错误状态下的采用权限，严格放行已核实 IM WebSocket。
- [x] 专用回归转绿，记录公共脚本取证地址；不读取真实聊天。

### Task 2: 内置提示词与网页辅助（主代理）

**Files:** src/shared/discovery-prompt.ts；src/main/discovery-web.ts；src/main/discovery.ts；src/main/ai-schemas.ts；src/shared/discovery.ts；src/shared/contracts.ts；src/main/preload.ts；src/main/main.ts；src/renderer/discovery-page.tsx、css；tests/discovery-web.test.cjs。

**Interfaces:** buildWebDiscoveryPrompt(provider, request) 返回固定官网及脱敏提问；parseWebDiscoveryReply(raw) 返回 DiscoveryPlan；ProductDiscovery.startWithWebPlan(request, reply) 跳过 API 规划并复用真实站内搜索。

- [x] 为非法官网、注入链接、JSON 代码围栏、超限回复、API 零调用、取消与后续请求写失败回归。
- [x] 共用内置 VRChat 日英检索提示词；网页辅助只复制描述和角色，验证后检索。
- [x] 删除三条示例按钮及依赖它们的空态文字；新增折叠网页 AI 辅助入口，保留直接搜索。
- [x] 运行聚焦回归与隔离 Electron 界面测试。

### Task 3: 验证及交付（主代理）

- [x] 完整类型检查、911 项回归、生产构建；只在新改动或失败时重复检查。
- [ ] 1.4.0-preview.8 打包、实际免安装启动及持久化验证。
- [ ] 更新说明、应用历史、隐私说明，公开文件检查后推送 GitHub。
- [ ] 对应提交 Windows CI 成功、附件摘要校验后发布公开预览。

## Rulings

- 用户此前明确要求自主落地、不反复询问可行性，本轮继续执行。用户后续明确选择“登录千问／Kimi 等官方网页使用 AI，不填 API 密钥”，与已实施的官方网页辅助方式一致；保留现有规则搜索。
- 网页 AI 不保存对话、回答原文或浏览器凭证到资料库；只保存本次内存检索计划。
- 按用户暂缓翻译要求，新中文字面文本加入精确的延后翻译清单，不放宽其他界面的翻译检查。最终发布和云端检查结果以同版 Release 验收附件为准。
