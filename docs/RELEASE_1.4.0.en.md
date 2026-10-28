# 1.4.0: Asset organization, batch downloads and the project workbench

Date: 2026-10-28 · Stable channel · Windows x64

[Release and downloads](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/releases/tag/v1.4.0) · [Quick start](QUICK_START.en.md) · [Full release notes (Chinese)](RELEASE_1.4.0.zh-CN.md)

These English notes cover the 1.4.0 stable release and essential operations. Some newer interface text and detailed guides remain in Chinese; earlier preview notes have not been fully translated. The experimental features below retain their limits in this stable release.

## Download and upgrade

- **Single-file EXE:** run `VRC-Asset-Library-1.4.0-x64.exe`. The official single-file stable edition checks the latest stable release and verifies downloads before offering to restart and update.
- **Folder ZIP:** fully extract `VRC-Asset-Library-1.4.0-x64-Folder.zip`, then run `VRC素材库.exe` inside it. Keep the entire folder. This edition still requires manual updates from the release page.
- **Other archives:** `Source.zip` and GitHub Source code archives are developer sources. Guide/Offline ZIP files are documentation. They are not the app.

Back up library records, close the old app, then start the new one using the existing library. If prompted for its location, select the parent of the existing `VRChatAssetLibrary` folder. Do not create an empty replacement. Higher-numbered old 1.9.x/1.10.x test builds require a manual upgrade. Check **Update history** to confirm which version is running.

## What changed

- **Location registration:** select several locations or all locations and remove their registrations together. Original disk files and annotations remain; re-add the original locations to use them again.
- **Baidu downloads and ZIPs:** select files for sequential downloading and register completed files without a global scan. Related downloads can share a new directory. Selected historical ZIPs can be extracted into one new asset directory, with one subfolder per archive.
- **Project workbench:** brings projects, dependency clues, products, imports and errors together. External Unity projects can be added by dragging their root folders. A directory of 30 public plugins provides official sources and installation links.
- **3D and optional AI:** lightweight model and avatar/clothing combination previews provide a static reference. Open the official Qianwen, Kimi or DeepSeek website in the app; after you send a prompt normally, an eligible response can continue to real product search.
- **Scanning and covers:** deep directories and asset file lists no longer miss entries because of a fixed depth cutoff. Exact same-name local images in an authorized directory can become package covers, reducing duplicate image cards.
- **Source matching:** explicit BOOTH download sources associate the product, author, category and artwork. Manual sources, skips and exclusions take priority; conflicting sources still need confirmation.
- **Startup and packaging:** deferred webpage-parser loading and skipping whole-library cloud association when there is no cloud content reduce unnecessary work. Runtime dependency license texts and a folder-based app package are included.
- **Reliability and diagnostics:** library, backup and source-directory boundaries and exclusive saves are strengthened. Xianyu window closure, recent-link dates and review states are handled more clearly. Unity stacks after destroyed-object messages are preserved; invalid MA menu-preview references receive Chinese guidance. The third-party exception has not been reproduced in a real project.

## Essential new operations

In **Settings & backup → 素材位置** (asset locations), tick paths or **全选** (select all), then click **移除所选（N）** (remove selected registrations). **取消勾选** only clears the selection. Removing all locations leaves the list empty; **添加素材文件夹** adds your own. This does not delete, rename, move or recycle files. See [location steps and recovery (Chinese)](SOURCE_LOCATIONS.zh-CN.md).

In the Baidu page's **下载记录** (download history), select model and material ZIPs belonging to the same asset, then click **解压所选并入库** (extract selected and register). View progress and output in **解压记录** (extraction history). The result is a new directory; original downloads are not moved by extraction.

**Automatic ZIP extraction** and **recycling original ZIPs after successful extraction and registration** are separate options, both off by default. Keep recycling off to retain originals. When enabled, recycling is attempted only after extraction, validation and registration succeed. Only ZIP is supported; this does not import into Unity. See [download, extraction and failure recovery (Chinese)](DOWNLOADS.zh-CN.md).

## Feature limits

- Scanning and organization read originals without modifying them. Explicit extraction writes to a new directory; explicit import writes to the selected Unity project.
- 3D previews do not reproduce Unity materials, MA or physics. There is no automatic try-on, body fitting or clipping repair. Real-avatar MA/SDK results, real-account deliveries and AI effectiveness still need separate acceptance checks.
- MA diagnostics improve this app's log interpretation and suggestions; they do not establish that an external plugin defect is fixed. See [MA diagnosis guide (Chinese)](MA_MENU_PREVIEW_DIAGNOSTICS.zh-CN.md).
- Xianyu reads loaded official account pages and does not provide independent background discovery after platform windows close. Web AI does not send prompts automatically or bypass login or verification.

[3D preview guide (Chinese)](MODEL_PREVIEW.zh-CN.md) · [Project workbench (Chinese)](AVATAR_WORKBENCH.zh-CN.md) · [Public plugins (Chinese)](PUBLIC_PLUGINS.zh-CN.md) · [Detailed user guide (Chinese)](USER_GUIDE.md)
