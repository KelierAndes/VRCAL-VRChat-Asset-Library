# VRC Asset Library 1.2.6

**First stable release:** 1.0.0 starts the stable version series. Earlier 1.9.x and 1.10.x releases were test builds. Because their version numbers are higher, their built-in updater will not offer 1.0.0. Close the test build and manually download and run the stable EXE once. Keep your existing library; if asked for a location, select the parent of your existing `VRChatAssetLibrary` folder. Later stable updates can use the built-in updater. Old test executables have been withdrawn; source history remains available.

A local Windows x64 library for VRChat assets. Browsing and scanning are read-only. An explicit import writes to the selected Unity project. Confirmed deletion moves selected original assets to the Windows Recycle Bin.

1. Close the older version and run `VRC-Asset-Library-1.2.6-x64.exe`. Existing users can keep their chosen library location. New users choose a data folder outside the source folders and outside drive C.
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

## 1.2.2

If the saved library cannot be opened, the app shows its path and offers retry or selection of an existing library containing library.sqlite. It does not create an empty replacement.

Settings → Assisted search → Enable Xianyu search is off by default. Accept the usage notice to show Try Xianyu enrichment in match confirmation. Review the official website results, then optionally use a product link for public metadata enrichment or continue to BOOTH with its name. No purchasing or automatic image uploads. Login verification or website changes can prevent enrichment; existing data and source undo remain available. Ordinary backups omit login credentials and cannot silently enable the tool.


## Add assets manually

Use **Add assets manually** in the toolbar to select one or more asset folders, or drop folders and local ZIP, RAR, 7z or Unitypackage files from File Explorer. Only the selected content is read; siblings and the entire library are not rescanned. Online enrichment continues only for these entries when enabled.

Manual paths persist across restarts and backups. Repeated additions preserve existing confirmations and annotations. Remove a path in Settings without deleting originals or annotations. Libraries, backups, drive roots and directory links are not accepted as assets. For files inside a Unity project, use **Read products in a project**, or add the whole project folder. Sources are never copied, moved or extracted by this operation.


## 1.2.3: sponsor credits

Below the code contributors, the community page now shows public sponsor names, optional repository-hosted avatars, social links and anonymous credits. The owner maintains `community/sponsors.json`; changes do not require an app release. Cached credits appear immediately, with checks on entry/every five minutes and a manual refresh button. Disabled networking or failed requests preserve the previous list. The cache follows library migration; ordinary material-library backups do not include this public feed. Payment records are not read or automatically verified. See the [maintainer guide](COMMUNITY_SPONSORS.md).


## 1.2.6: manage hidden materials on a dedicated page

Open **Hidden materials** below **Manual organization** in the sidebar. Its count represents hidden cards; merged files count as one card. **Settings & backup** now offers only **View hidden materials**, which opens the same page.

Search by name or path, reveal the original folder, or expand a merged item to check its files. Use **Restore visibility** for one item or select items and choose **Restore selected**. Existing covers, notes, tags and other annotations remain intact.

Single and batch deletion still list the actual paths for confirmation and move approved files to the Windows Recycle Bin. Existing path protections apply. Canceling leaves files and hidden status unchanged. Hiding itself does not move source files. Recycled items are excluded; hidden records from a removed source remain saved and reappear when the source is added again. The older sections below retain historical instructions; use this page for current hidden-item management.

## 1.2.4: hidden items and rematching

Right-click a material or open its details and choose **Hide from library**. Original files, covers and annotations remain intact. **Settings → Hidden materials** lists hidden names and paths, supports search, and restores individual or selected items. Refreshing, restarting and backup restore retain hidden flags.

**Force rematch** returns a confirmed or manually classified item to review while keeping its current source and details. Use **Match this material again** to discover candidates; a replacement always needs your confirmation. With optional Xianyu enabled, open the product page and click **Apply this product**. Public details are read from the loaded page; if unavailable, enter a verified product name in the local toolbar. Search/login pages cannot be applied. Source changes can be undone. This helper is for search assistance only, never purchases.

## 1.2.5: context menus and batch actions

In **Settings and backup → Context menu**, choose visible actions, move them up or down, or restore defaults. Preferences persist across restarts, migration and backups. A fixed settings shortcut remains even if every configurable action is hidden.

Select gallery cards or match-confirmation rows to **Hide selected** or **Delete selected (move to Recycle Bin)**. Hidden items also support single and batch deletion. Hiding affects app visibility only. Deleting moves original files and all files inside selected folders; the confirmation lists every actual target path and defaults to Cancel. Merged and overlapping paths are deduplicated.

Results show success, failure and skipped paths. Failed originals remain in place; there is no permanent-delete fallback. Shared scan roots, library/cache/session data, Unity projects and links are protected. Independent manually added assets and registered BOOTH download files are eligible after validation.

Restore files to their original paths from the Windows Recycle Bin, then refresh or re-add them. Existing covers and annotations remain; previously hidden items stay in the hidden list. Library backups contain records, not original files, and cannot restore deleted files. Use the Windows Recycle Bin to undo file deletion.
