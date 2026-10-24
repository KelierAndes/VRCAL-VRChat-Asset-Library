# 正式版发布与更新记录

每个正式版同时更新以下位置：

1. `package.json`、`package-lock.json`：一致的稳定版本号 `x.y.z`。
2. `src/shared/release-notes.ts`：在顶部追加 `stable` 条目；`src/shared/messages-releases.ts` 补充英语和日语，随程序离线显示。
3. `CHANGELOG.md`：记录新增、改进、修复及实验功能边界。
4. `README.md` 和三语使用说明：更新下载版本与操作步骤。
5. GitHub Releases：以 `v<x.y.z>` 发布说明、免安装 EXE、对应完整源码、三语指南、验收记录及 SHA-256 清单。

## 内置更新读取哪里

更新器读取本仓库的 `https://api.github.com/repos/NecoAya/VRCAL-VRChat-Asset-Library/releases/latest`。只推送源码、分支或标签，用户不会收到新的程序更新。草稿和预发布版本也不会作为稳定更新。

发布包必须包含且只包含一个对应的 `VRC-Asset-Library-<x.y.z>-x64.exe`，GitHub 资产应为 uploaded 状态并带有 SHA-256 digest。更新器核对官方仓库、标签、文件名、大小与摘要，Release 正文就是内置更新展示的说明。通过全部检查和资产上传后再将草稿设为最新正式版。

## 发布前检查

- 运行 `npm run check`、`npm test`、`npm run build`；修复实际失败。
- 审查公开文件，不包含凭证、个人资料库、购买记录或付费素材；普通备份不含登录凭证。
- 验证打包后的主程序、全部运行资源、实际版本、SQLite 和界面启动；使用隔离资料库验证新增交互、重启与备份恢复。
- 保持扫描源文件清单和哈希不变。涉及主动导入时，只测试隔离合成工程，分别记录导入和装配结果。
- 对应源代码提交到主分支后，以相同提交创建标签和 Release。维护者可直接推送主分支，社区贡献可通过 Fork 和 PR 提交。
- 发布后核对公开 latest API、资产 SHA-256、下载入口和旧正式版的更新检查，检查 Windows CI 结果。不要在发布成功前写“已上线”。

程序中的历史 local 条目是开发记录，其试验 EXE 未单独公开发布；稳定版本汇总对应功能。旧测试系列的版本号曾高于正式版，需手动运行一次正式版，之后可正常检查更新。


## 公开预览版

版本使用 `x.y.z-preview.n`；应用内历史标记 `preview`，历史未单独发布的开发条目仍标记 `local`。在 README、CHANGELOG 与 Release 正文汇总相对上一公开版本的所有变化，说明验证边界。新增文案允许按维护安排暂缓翻译，不声称已经完整翻译。

公开预览也必须通过本地检查、实际打包启动和对应提交的 Windows CI。以准确提交创建草稿，上传并核对程序、该提交的源码、中文说明及 SHA-256；发布时设置 `prerelease: true`、`make_latest: false`。不得将其作为稳定更新推送，不要求 `/releases/latest` 指向预览。核对版本专属 Release、标签、公共下载及资产摘要。旧版已撤下的附件继续保持撤下。
