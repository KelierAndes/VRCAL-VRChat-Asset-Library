# In-app web AI implementation plan

> **For agentic workers:** Use subagent-driven development for the independent workspace, DOM adapter and renderer tasks. The root integrates and verifies the release.

**Goal:** Complete keyless official web AI assistance inside the application and pass verified search terms directly to real product search.

**Architecture:** A sandboxed WebContentsView occupies a bounded area of the existing discovery page. Trusted local controls prepare a request-specific prompt, capture only a matching assistant reply, validate its search plan, and reuse ProductDiscovery. Each provider has its own local session; normal backups exclude credentials.

**Tech stack:** Electron, TypeScript, React, Node test runner, isolated Electron/Playwright UI verification.

**Spec:** User request: “这一步能不能整合进应用，不让用户打开别的网页。” Existing keyless providers remain 千问, Kimi and DeepSeek. No external browser, private APIs, model/material uploads or automatic account message sending.

## Global constraints

- Original materials, Unity projects and synced sources remain read-only.
- Provider login and sending use the normal official page in the embedded region.
- Websites receive no desktop bridge, preload, filesystem access or download permissions.
- Reuse strict plan validation; AI text cannot create product links or execute instructions.
- Publish a preview with matching source, portable program, guide, acceptance and hashes after validation.

## Review focus

- Historic assistant/user JSON must not start a new search: bind an unpredictable request ID and strict envelope.
- Editing the request, switching provider, navigating away or going offline invalidates late work.
- Native views must not cover application navigation, dialogs or clipped scroll regions, including 200% zoom.
- Login credentials migrate with the library but never enter ordinary backups or restored download references.
- Provider redesign, loading failure or login verification must retain an in-app manual fallback and an honest status.

### Task 1: Request-bound official DOM adapter

Files: `src/main/discovery-ai-dom.ts`, `tests/discovery-ai-dom.test.cjs`.

- [x] Write failing fixtures for visible textarea/contenteditable input, current assistant response, old request IDs, user/quoted text, malformed/oversized answers.
- [x] Implement `aiEditorScript`, `aiReplyScript`, `inAppDiscoveryPrompt` and `parseInAppDiscoveryReply`; fill but never send. Only parse exact `{requestId,plan}` envelope then reuse strict discovery parser.
- [x] Run the adapter tests; confirm red-to-green and preserve existing web reply compatibility.

### Task 2: Sandboxed main-window AI workspace

Files: `src/main/discovery-ai-workspace.ts`, `src/shared/discovery.ts`, workspace tests.

- [x] Write failing tests for independent provider sessions, restricted navigation/network/permissions, CSS-to-DIP clipping, generation cancellation, stable nonce reply and single consumption.
- [x] Implement `DiscoveryAiWorkspace` with open/snapshot/bounds/fill/collect/copyPrompt/takeReply/close/shutdown/clear; export cookie migration preparation.
- [x] Test delayed callbacks, double-close, invalid/offline requests and no bridge/external browser.

### Task 3: In-app workflow and lifecycle integration

Files: discovery page/CSS, shared contracts, preload, main, storage, store and focused tests.

- [x] Add failing migration/backup-boundary tests before extending profile allowlists.
- [x] Wire fixed IPC methods through the existing main-frame sender gate; bind reply application to the immutable workspace request.
- [x] Add an embedded surface with local toolbar, official-page login/send, automatic valid-reply search, copy/fill retry and collapsed manual answer fallback.
- [x] Hide/detach the view on dialogs/settings, scrolling out of bounds, unmount, offline, migration, restore and shutdown.
- [x] Verify session migration, backup exclusion and protected download references.

### Task 4: Verification and public preview

- [x] Run type checks, complete test suite and build. Final frozen implementation: 1117/1117 regression checks, types and package build passed.
- [x] Exercise a real sandboxed native view against intercepted synthetic official pages: request fill, matching reply handoff, invalid/old replies, route/modals, four themes, 980px/200%, restart, migration/backup boundaries and source hashes. Do not send real account chats.
- [x] Verify packaged and portable startup; record the distinction between synthetic integration and unverified provider account flows.
- [x] Update guide/privacy/agreement/report, app history, README and changelog; package preview.12 and independently review source.
- [ ] Publish exact-commit assets after Windows CI passes. This source snapshot precedes release creation; the release acceptance and Post-Release-Verification.json record the final publication result.

Final local evidence: 1117/1117 regression checks; 16 packaged native workspace checks; 9 actual portable startup/restart checks. Qwen and Kimi public pages fill; DeepSeek public page reports environment validation. No authenticated AI chat was sent or verified.
