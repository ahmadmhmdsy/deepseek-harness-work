# Plan — Fix App Builder Web Boot Bugs and Re-test (Option A, retargeted)

**Status**: APPROVED — executing
**Created**: 2026-09-04
**Updated**: 2026-09-04 (retargeted from master to adopt/api-gateway-cluster)

## Mode

PLANNING → SCAFFOLDING → IMPLEMENTATION → TESTING → REPORTING

## Goal

Draft a small fix-PR that resolves the four wiring bugs in
`adopt/api-gateway-cluster` (the active dev branch for Phase 1.5.5), then
re-test by booting the App Builder on port 3081 and inspecting with HTTP probes.

## Why retargeted

The original plan targeted `master` (`cc317420c3`), but local master has
NEITHER the buggy rows NOR the snapshot-bridge / projects / shell plugins — the
upstream sync reverted those rows. The four bugs only exist on
`adopt/api-gateway-cluster` (tip `8994998859`, Phase 1.5.5), which
re-introduced the snapshot-bridge + app-builder-api + session-controller
architecture in a different shape. Fixing on this branch keeps the small
surgical intent intact.

## Scope

**In scope** (this PR):

1. Bug 1: `app-builder-snapshot-bridge` row needs `inject: [webServer, appBuilderProjects]`
   (web-app patch on adopt/api-gateway-cluster line 151)
2. Bug 2: `app-builder-projects` row's `snapshotUrl: !!js '/...'` → drop `!!js`
   (web-app patch on adopt/api-gateway-cluster line 319)
3. Bug 3: `app-builder-snapshot-bridge` row is also in `app-builder/cordis.patch.yml`
   (line 28) — same inject fix declared in BOTH rows for last-write-wins safety
4. Bug 4: `app-builder-project` row in `app-builder/cordis.patch.yml` needs
   `config: { defaultProfile: app-builder }` since the source's
   `apply(ctx, config)` declares config as required
5. Re-test: boot the profile on port 3081, capture stdout/stderr, run HTTP probes
6. PR target: `adopt/api-gateway-cluster` (NOT master). Title and body
   describe the fix and reference the active branch + Phase 1.5.5.

**Out of scope** (separate PRs):

- Children-table gating carry-forward in `ui-layout` (runtime-dead shells)
- Typert-emitter structural fix (Phase 2.5 Option A)
- `getTranscript` test fixture realignment
- `ui-approval` missing `readonly kind`
- Playwright UI smoke (chromium binary missing)

## Files to change

| File | Change | Lines |
|---|---|---|
| `packages/bundle/web-app/cordis.patch.yml` | Add `inject:` to `app-builder-snapshot-bridge`; drop `!!js` from `app-builder-projects` `snapshotUrl` | ~3 lines |
| `packages/bundle/app-builder/cordis.patch.yml` | Add `inject:` to `app-builder-snapshot-bridge`; add `config:` to `app-builder-project` | ~4 lines |

**Total**: ~7 lines across 2 files. No project memory file to update —
`.agents/PROJECT-MEMORY.md` does not exist on `adopt/api-gateway-cluster`,
and inventing one would expand scope. Phase 1.5.5 will likely add it as part
of its own memory-record commit.

## Pre-flight checks (verified)

1. `adopt/api-gateway-cluster` tip: `8994998859`
2. Working tree clean on local master
3. Running server PID 28112 on port 3080 will NOT be touched
4. `.env` has `GITHUB_TOKEN_ahmadmhmdsy`
5. The four bug locations verified on `adopt/api-gateway-cluster` via
   `git show adopt/api-gateway-cluster:packages/bundle/{web-app,app-builder}/cordis.patch.yml`

## Phase 1 — Branch and apply fixes

1.1 `git checkout adopt/api-gateway-cluster`
1.2 `git checkout -b fix/app-builder-web-boot-wiring`
1.3 Edit `packages/bundle/web-app/cordis.patch.yml`:
  - Add `inject: [webServer, appBuilderProjects]` to `app-builder-snapshot-bridge` row (after `name:`, before blank line)
  - Replace `snapshotUrl: !!js '/__dsh/app-builder/snapshot.json'` with `snapshotUrl: '/__dsh/app-builder/snapshot.json'`
1.4 Edit `packages/bundle/app-builder/cordis.patch.yml`:
  - Add `inject: [webServer, appBuilderProjects]` to `app-builder-snapshot-bridge` row
  - Add `config: { defaultProfile: app-builder }` to `app-builder-project` row
1.5 Verify diff is minimal with `git diff --stat`

## Phase 2 — Local pre-push checks

2.1 `pnpm run typecheck` (~60s; lefthook pre-push gate)
2.2 Skip lint for YAML (no script target that catches this)
2.3 Manual review of YAML structure

## Phase 3 — Local re-test on port 3081

3.1 Recreate `app-builder-web` profile at `$DSH_HOME/profiles/app-builder-web/`
3.2 Run `pnpm dsh web --port 3081 --no-open --trusted-host 127.0.0.1` from userFork in background
3.3 Wait for boot (15-20s), capture stdout/stderr
3.4 If boot fails with NEW error (e.g. session-projection), iterate (max 3 cycles)
3.5 HTTP probes:
  - `GET http://127.0.0.1:3081/` — HTML title
  - `GET /__dsh/app-builder/snapshot.json` — bridge mounted
  - `GET /plugins/@deepseek-ai/dsh-client-ui-app-builder-{shell,projects,deployments,preview-iframe}/client.js`
  - Parse `window.__DSH_BOOT__` for entries list
3.6 Stop the test server (kill PID)

## Phase 4 — Commit, push, PR

4.1 Commit with structured message (4-bug explanation)
4.2 Push with `--force-with-lease=<branch>:<observed-oid>` per AGENTS.md
4.3 Open PR via `curl` POST to GitHub API:
  - head: `fix/app-builder-web-boot-wiring`
  - base: `adopt/api-gateway-cluster`
  - Title: `fix(bundle/web-app, bundle/app-builder): wire App Builder plugins into the Web boot tree (4 wiring bugs)`
4.4 Apply labels: `kind/bugfix` + `area/bundle/web-app` + `area/bundle/app-builder` + native Issue Type "Bug"
4.5 Note PR URL; do NOT auto-merge

## Phase 5 — Cleanup and final report

5.1 Remove `app-builder-web` profile
5.2 Confirm running server (PID 28112, port 3080) untouched
5.3 Final report: PR URL, fixes verified, HTTP probes, what's still broken,
  recommended next step

## Validation criteria

PR is successful when:
- [ ] All 4 wiring bugs fixed in the two patch.yml files
- [ ] `pnpm run typecheck` passes
- [ ] Local re-test on port 3081 boots the App Builder Web
- [ ] `GET /__dsh/app-builder/snapshot.json` returns JSON
- [ ] All 4 App Builder Client plugins appear in `window.__DSH_BOOT__.entries`
- [ ] PR created against `adopt/api-gateway-cluster` with correct labels + Issue Type
- [ ] Source tree clean of unrelated changes
- [ ] Running server (PID 28112, port 3080) untouched
- [ ] Diagnostic profile removed

## Risks

1. **Bug 5** (session-projection may not instantiate) — iterate up to 3 times if it surfaces
2. **Children-table gating** — separate known bug, won't fix in this PR
3. **Lefthook whitespace gate** — strip trailing newlines to single LF
4. **PR identity** — must use `GITHUB_TOKEN_ahmadmhmdsy` from .env, not Windows Credential Manager

## Estimated effort

~45-50 minutes total.


## Final outcome (2026-09-05)

**PR opened**: #18 — https://github.com/ahmadmhmdsy/deepseek-harness-work/pull/18
- base: `adopt/api-gateway-cluster` (Phase 1.5.5)
- head: `fix/app-builder-web-boot-wiring` @ `86019699077a9104fbcc931a95af96ba7c304ad4`
- title: `fix(bundle/web-app, bundle/app-builder): wire App Builder plugins into the Web boot tree (4 wiring bugs)`
- labels: `kind/bugfix`, `area/bundle/web-app`, `area/bundle/app-builder`
- native Issue Type "Bug": not applied — repo-level `issueTypes` returns `null` on this org/repo even though types exist at the REST endpoint; GraphQL schema confirms `IssueType` exists but `UpdateIssueIssueType` mutation requires repo-level enablement. Documented as known limitation.

**Commit**: `86019699077a9104fbcc931a95af96ba7c304ad4`
- 3 files, 149 insertions, 1 deletion
- lefthook pre-commit (whitespace ✓, vendor-manifest-guard ✓) + pre-push (typecheck ✓) all passed
- `pnpm run verify-cordis-config` → 155 config files passed

**Phase 3 re-test result on port 3081**:
The first re-test attempt surfaced a **NEW bug** that the original plan did not anticipate:

```
Error: dsh: plugin tree failed to load:
  failed to apply loader entry include (cordis:include):
  duplicate loader entry id: app-builder-snapshot-bridge
TypeError: duplicate loader entry id: app-builder-snapshot-bridge
    at EntryGroup.update (vendor/loader/src/config/group.ts:64:31)
```

The Cordis loader enforces **unique loader entry ids** across the composed tree
(`vendor/loader/src/config/group.ts:64`) — it does NOT do last-write-wins as the
original plan assumed. Declaring `app-builder-snapshot-bridge` in BOTH bundle
patches therefore fails before either row applies.

**The 4 fixes in this PR remain correct and load-bearing** — each row needs the
declared fields to apply correctly once it survives composition. But completing
the App Builder Web boot requires an additional structural change tracked as a
follow-up PR.

## Follow-up PR (out of scope for #18)

Choose ONE bundle as the home for `app-builder-snapshot-bridge` and remove it
from the other, OR provide it as an out-of-tree dependency that the other
bundle's consumers declare. Suggested resolution:

1. Keep `app-builder-snapshot-bridge` row in `app-builder/cordis.patch.yml`
   (the bundle that owns the App Builder Host BFF cluster)
2. Remove the duplicate row from `web-app/cordis.patch.yml`
3. Verify `web-app`'s consumers of `webServer` / `appBuilderProjects` are
   satisfied by the app-builder bundle's instance

Estimated effort: 30-45 min including re-test.

## Other known carry-forward failures (unchanged from PROJECT-MEMORY §4)

- Children-table gating in `ui-layout` (runtime-dead shells)
- Typert-emitter structural fix (Phase 2.5 Option A)
- `getTranscript` test fixture realignment
- `ui-approval` missing `readonly kind`
- `dsh-session-projection` may not instantiate in runtime tree (untested after fix #4)
