# Community sponsors implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved design task by task in the existing isolated worktree.

**Goal:** Add remotely maintained sponsor credits below code contributors and keep official repository updates under the owner's control.

**Architecture:** A public versioned JSON document on main is fetched by Electron's main process, validated and cached under the selected library's cache directory. The renderer displays cached entries immediately, refreshes on entry/every five minutes and offers manual refresh. Repository rules allow only the owner to update main directly; community PRs remain welcome.

**Tech Stack:** Existing Electron, React, TypeScript, Node test runner and GitHub REST API; no added runtime dependency.

**Spec:** User-approved design in this conversation (2026-10-22); maintainer schema and operational guide in `docs/COMMUNITY_SPONSORS.md`.

## Global constraints
- Original materials and real Unity projects remain read-only; tests use synthetic profiles.
- Respect global networking disable, migration and shutdown. No embedded credentials or material metadata in requests.
- Fetch only the fixed public JSON and repository-hosted avatar files; do not execute remote HTML or scripts.
- Preserve valid cached data on failures; anonymized entries expose no name, avatar, note or links.
- Keep four themes and Chinese, Japanese and English support.

## Review focus
- Malformed/oversized/redirected remote responses must preserve previous cached names.
- Offline mode and network disable must cancel requests without late writes.
- Empty lists are valid updates; duplicate IDs, unsafe avatar paths and invalid links are rejected.
- Restart, selected-library migration and corrupted caches must not read/write source material directories.
- Metadata refresh must return promptly while avatars load; a failed avatar uses initials and cannot break the list.

### Task 1: Validated feed, cache and desktop interface
**Files:** `src/shared/sponsors.ts`, `src/main/sponsors.ts`, `src/shared/contracts.ts`, `src/main/preload.ts`, `src/main/main.ts`, `tests/sponsors.test.cjs`.
**Interfaces:** `Sponsors.snapshot():SponsorsState`, `Sponsors.refresh(force?:boolean):Promise<SponsorsState>`, `Sponsors.link(id:unknown,index:unknown):string`, `Sponsors.networkChanged():void`, `Sponsors.close():void`.
- [ ] Add failing regressions covering the five review focus classes, fetch deduplication and conditional requests.
- [ ] Run tests red, implement bounded validation/cache/network behavior, then run tests green.
- [ ] Integrate main/preload handlers and safe local avatar rendering; no renderer-supplied external URL is opened directly.

### Task 2: Sponsor panel and translated interface
**Files:** `src/renderer/sponsors.tsx`, `src/renderer/contributors.tsx`, `src/renderer/contributors.css`, `src/shared/messages-sponsors.ts`, `src/shared/messages-ui.ts`, UI smoke script.
- [ ] Display the sponsor panel beneath the contributor list, with counts, empty/offline/error states, last checked time and refresh.
- [ ] Refresh on page entry and every 300000ms while mounted; cached content remains visible during requests.
- [ ] Verify all four themes, three languages, empty/anonymous/long-name cases, 980px and 200% zoom in isolated packaged UI.

### Task 3: Maintainer data, repository ownership and delivery
**Files:** `community/sponsors.json`, `community/sponsors.example.json`, `docs/COMMUNITY_SPONSORS.md`, README, contribution guide, release notes and package version.
- [ ] Publish a valid empty list plus a separate fictional example and document owner editing, avatar placement, privacy and polling limits.
- [ ] Save repository settings before changes, apply an owner-only main update rule with direct-owner bypass and verify it through REST.
- [ ] Run type/build/full regression and package checks; review the diff, build 1.2.3 and verify startup/persistence.
- [ ] Commit/push the reviewed change without force-pushing; publish the tested release and verify the public feed/downloads.
