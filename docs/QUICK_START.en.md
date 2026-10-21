# VRC Asset Library 1.2.1

**First stable release:** 1.0.0 starts the stable version series. Earlier 1.9.x and 1.10.x releases were test builds. Because their version numbers are higher, their built-in updater will not offer 1.0.0. Close the test build and manually download and run the stable EXE once. Keep your existing library; if asked for a location, select the parent of your existing `VRChatAssetLibrary` folder. Later stable updates can use the built-in updater. Old test executables have been withdrawn; source history remains available.

A local Windows x64 library for VRChat assets. Browsing and scanning are read-only. Only an explicit import writes to the selected Unity project; source assets remain unchanged.

1. Close the older version and run `VRC-Asset-Library-1.2.1-x64.exe`. Existing users can keep their chosen library location. New users choose a data folder outside the source folders and outside drive C.
2. Choose **English** in the language selector. Select **X Light**, X Dark, NASA Punk or Swiss International in the theme selector. Choices are saved immediately. Asset names, authors, personal tags and notes remain in their original language.
3. Open **Settings & backup** to add your main asset folder. Category subfolders are scanned recursively. Adding a parent replaces its registered children. Unity projects stay together.
4. Use **Remove** beside a source path to exclude it from scanning and browsing. This does not delete files or annotations. Re-adding the path restores its library entries. Keep library data and backups outside the folder being scanned; move data first if necessary.
5. Enable online enrichment when ready. The app searches BOOTH for product information and artwork. Ambiguous results need confirmation. Use the built-in BOOTH search and **Apply this product** when automatic matching needs help. You can undo an incorrect source confirmation.
6. In **Settings & backup**, check for updates, download a release and restart to apply it. Automatic replacement supports the official portable EXE stored outside source folders. Downloads are checked against the SHA-256 published by GitHub. Your first upgrade from an older version requires one manual download; subsequent updates can use this page.

Use Ctrl + mouse wheel to resize the interface. Source paths and folders can be opened from context menus. Backups include library records and artwork, but exclude login credentials and source files. Login sessions stay local and follow a library-location migration; expired or revoked logins may require signing in again.

Confirm the product source and license on its original BOOTH page before using an asset.

Project, source code and issue tracker: https://github.com/NecoAya/VRCAL-VRChat-Asset-Library

Licensed under GPL-3.0-only. See LICENSE, NOTICE and THIRD_PARTY_NOTICES.md in the source archive.

## Project files and importing

Select a project and choose **Browse project files** to read its real Assets folders, including unknown files that have no product match. The packages tab shows manifest dependencies and the project version. Right-click a file to reveal or copy its path. File presence and name matching do not prove scene usage.

Right-click a local material and choose **Import into project**, or open **Import local assets** from a project. Explicitly choose the target project and the desired file/variant, review the preview, then import.

- **Unity packages:** first use installs the open-source Editor helper in the selected `Assets/VRCALImportBridge/Editor`. Requests and receipts go to that project's `Library/VRCALImportBridge`. Unity's native import dialog lets you choose what to import. Only an exact editor-version match is launched automatically. If unavailable, select the matching Unity.exe or open the project manually. Compilation errors or disabled refresh can leave the request waiting. A queued request is not a completed import. Cancel an unclaimed request here; cancel a claimed import in Unity.
- **Ordinary files/folders:** copied with their original hierarchy and `.meta` into a new unique folder under `Assets/VRCAL_Imports`. Existing files are never overwritten. GUID conflicts in Assets, Packages or the package cache block copying. A completed copy means the files were committed, not that Unity compiled all dependencies successfully.
- **ZIP/RAR/7z:** extract manually and refresh the catalog first. The manager does not extract them for you. Linked paths, source/project overlap and changed source files are refused.

Import history survives restart and follows library migration. A successful import adds the material association without replacing existing notes or manual links. Project files and helpers are not included in ordinary library backups. If metadata saving is temporarily unavailable after copying, do not import again: the project receipt allows reconciliation. Missing shaders, SDKs and other Unity dependencies still need attention in Unity.

In **Contributors & community**, choose **Join the chat** to view the bundled QQ group QR code or copy group number **1002563035**. Chat, request updates or report bugs. The QR code is available offline.

## New in 1.2.0

- **Project products:** from project details, file browsing or the context menu, scan Assets read-only for product IDs, Prefabs, documentation links and completed imports. Review evidence, reveal paths, and register products individually or in batches for BOOTH matching. Names alone remain unconfirmed clues.
- **Optional MA assembly:** after importing, select the avatar and Prefab in Unity. With compatible Modular Avatar installed, attach the Prefab as the avatar's last child. One Undo is supported; save the scene yourself after inspection. The app reports Assets paths and separately labels metadata-based change candidates. The Unity helper now has a Chinese UI and a guarded upgrade action.
- **Baidu Netdisk (experimental):** sign in on the official website in an isolated session, then read a chosen parent folder and subfolders with pause/resume/retry. Link entries to local assets. No archive downloads or extraction. Verification and website changes may interrupt reading; unseen records are preserved.
- **Update history:** bundled offline notes in the sidebar and Settings. Published release notes and downloads are also on [GitHub Releases](https://github.com/NecoAya/VRCAL-VRChat-Asset-Library/releases); [CHANGELOG.md](../CHANGELOG.md) is included with source. The updater uses the latest stable GitHub Release.

Keep your existing library when upgrading. Users of 1.2.0-local.* trial builds should run the stable EXE manually once. More implementation and verification details: [project and cloud guide (Chinese)](LOCAL-CLOUD-MA.md).

## 1.2.1

If the saved library cannot be opened, the app shows its path and offers retry or selection of an existing library containing library.sqlite. It does not create an empty replacement.

Settings → Assisted search → Enable Xianyu search is off by default. Accept the usage notice to show Try Xianyu enrichment in match confirmation. Review the official website results, then optionally use a product link for public metadata enrichment or continue to BOOTH with its name. No purchasing or automatic image uploads. Login verification or website changes can prevent enrichment; existing data and source undo remain available. Ordinary backups omit login credentials and cannot silently enable the tool.
