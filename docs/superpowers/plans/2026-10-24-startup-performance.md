# Startup and memory optimization implementation plan

> **For agentic workers:** Use focused parallel agents for independent parser and empty-cloud fixes; root owns packaged measurements, integration and publication.

**Goal:** Measure current launch time and whole-process memory, then reduce verified avoidable startup/refresh work without changing saved records or parsing.

**Architecture:** Keep current Electron and synchronous parser APIs. Defer the existing HTML parser until its first actual parse and short-circuit empty cloud joins before consulting all local assets. Measure fresh processes and already-initialized isolated profiles using the same synthetic corpus and device.

**Tech Stack:** Electron, TypeScript, SQLite, Node tests, isolated packaged Playwright checks, Windows per-process memory counters.

**Spec:** User asks to optimize code and report current opening speed and RAM use. Report actual measurements with version, corpus, sample count and memory definition; never equate a microbenchmark with full application performance.

## Constraints and review focus

- Real materials, projects, credentials and synced sources remain read-only. Do not close the user’s running app.
- Benchmark profiles are isolated and offline; distinguish portable extraction from unpacked launch and first-profile initialization from a true OS cold boot.
- Retain Cheerio’s exact parsing implementation, selectors and synchronous semantics; first parse may pay deferred cost.
- Empty cloud catalogs must preserve local/cloud storage decoration and must not enumerate locals; populated cloud behavior remains unchanged.
- Measure all owned app processes; report private resident memory separately from committed memory and shared working-set sums. Do not force GC or disable GPU to manufacture smaller figures.

### Task 1: Baseline

- [x] Create a repeatable isolated launch/memory benchmark with 300 synthetic records, the portable and unpacked program, and at least three process starts per mode.
- [x] Record spawn-to-usable-gallery, initialized-profile starts and idle whole-tree memory; hash synthetic source before/after. Read the existing user process memory separately and label its old version.

### Task 2: Lazy HTML parsing

Files: new src/main/html-parser.ts, src/main/online.ts, src/main/discovery-parser.ts, src/main/baidu-page.ts, new tests/html-parser-lazy.test.cjs.

- [x] Write and run a fresh-child failing test proving business imports do not load Cheerio/Undici; retain real fixture outputs.
- [x] Implement a shared lazy wrapper around the existing cheerio.load with identical types/API and no alternative parser.
- [x] Verify first parsing loads the parser and existing product/search/discovery regressions remain unchanged. No shared dist writes by the subagent.

### Task 3: Empty cloud join

Files: src/main/cloud-catalog.ts and corresponding cloud catalog tests.

- [x] Write failing assertions that an empty catalog, empty captures and empty requested decoration do not enumerate local materials, while output storage fields remain identical.
- [x] Return early before locals() when no cloud items can contribute. No general cache, projected-record API or Store mutation redesign in this change.
- [x] Verify nonempty captures, duplicates, staleness and local/cloud decoration still work.

### Task 4: Final verification and delivery

- [x] Run type checks, complete regression suite, build and independent review. Final implementation: 1126/1126 tests, types and runtime packaging checks passed; independent review caught the remaining eager Baidu-page import and that path was added to the regression.
- [x] Repeat packaged benchmark with the same corpus/procedure; retain timings and all memory definitions even if improvement is small or variable.
- [x] Exercise packaged gallery/search/cloud/parser and the existing in-app browser workflows; preserve synthetic hashes.
- [x] Update app history, README, release notes and performance methodology; package single-file and folder programs with exact-source guide, acceptance and hashes.
- [ ] Publish after Windows CI succeeds. This source snapshot precedes release creation; release acceptance and Post-Release-Verification.json record publication.

The real portable baseline is materially slower than unpacked startup. Add an optional unpacked runtime ZIP and a clear manual-update explanation; keep the existing single-EXE update security model unchanged.

Final local verification: 1126/1126 regression checks; 16 native workspace checks, 9 actual portable and 9 actual extracted-folder checks. Same 300-record corpus: initialized-start medians preview12/13 single-file 7.570/7.505s; folder 0.755/0.666s. New-browser-profile starts 8.313/8.818s and 0.909/1.444s respectively, so first-start results are not advertised as improved. Whole-tree private-resident medians 159.3/150.2 MiB portable and 158.5/147.9 MiB folder. Four raw runs per case retained; no OS cold-boot claim.
