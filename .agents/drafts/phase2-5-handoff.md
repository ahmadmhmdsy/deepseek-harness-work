# Phase 2.5 — Session Resume Handoff

> **Save-as-branch** by this same workflow so a fresh agent can resume from this
> exact point without conversation context. The handoff is the original spec +
> the spot where the implementation stopped + a structured task list to drive
> 2.5 to completion.

## 0. TL;DR for the resuming agent

You are resuming **Phase 2.5** of the App Builder stack on branch
`feat/phase2-5-ui-eventsource`. You are NOT starting over. The branch is already
cut, the BFF's two new Remote methods are committed and pushed, the tests are
green, and the open question — whether to also add `subscribePreview` (option 2)
or only the minimum-viable surface (option 1) — is the only scope decision left.

**The user split the plan into option 1 (already DONE) and option 2 (user
deferred).** Both options need the same UI panes + shell edit + bundle wiring.
Those are the next 12 todos (see §8). When you get to the "do option 2 or stop
here?" decision point, ask the user before adding `subscribePreview`.

## 1. Repo state at handoff time

| Key | Value |
|---|---|
| Repo | `ahmadmhmdsy/deepseek-harness-work` (working fork) |
| Upstream | `deepseek-ai/deepseek-harness` (read-only context; never push here) |
| Working branch | `feat/phase2-5-ui-eventsource` |
| Branch base | `feat/phase2-4-projection-ui` @ `32b10fda0d` (forward-lead) |
| Branch tip | `0abc84c892258f86a81139f6d04c99426e53df6a` (BFF-only commit) |
| Working tree | clean |
| 2.4 PR | blocked on PAT permissions; user will fix later (no action here) |
| 2.4 carry-forward | `verify-cordis-inspect-catalog` fails (latent typert bug in `ui-approval/contract/slots.ts:71`); pre-push typecheck PASSES so push is unblocked |
| 2.5 PR | not yet created; pending PAT + 2.5 completion |

## 2. What was delivered in this session (option 1)

### 2.1 Files committed on `feat/phase2-5-ui-eventsource`

| File | Change | Detail |
|---|---|---|
| `packages/app-builder/api/src/deployments.ts` | +NEW | `listDeploymentsRemote` (unary) + `subscribeDeploymentEventsRemote` (stream/gap-free async generator mirroring `sessionController.follow`'s buffered-queue + wake-up + AbortSignal pattern). `toShape` projects `Deployment` records to public JSON-safe shapes (branded id erased, gate findings shallow-cloned). |
| `packages/app-builder/api/src/types.ts` | extend | Appended `DeploymentShape`, `DeploymentGateResultShape`, `DeploymentGateFindingShape`, `ListDeploymentsRequest`, `ListDeploymentsValue`, `SubscribeDeploymentEventsRequest`, `DeploymentStreamEvent`, `SubscribeDeploymentEventsFrame`. Re-exported `DeploymentStatus`, `GateKind`, `GateFindingSeverity` from the deployment package. |
| `packages/app-builder/api/src/index.ts` | edit | Added 2 `@Remote` methods (`listDeployments`, `subscribeDeploymentEvents(@Remote({mode:'stream'}))`); added imports of the new types; mirrored local-import and export re-export blocks; bumped the docstring's method count placeholder. |
| `packages/app-builder/deployment/src/index.ts` | edit | Re-exported `DeploymentStatus` (previously only `Deployment`, `DeploymentId`, etc. were exported; `DeploymentStatus` and `DeploymentFailedEvent` were missing from the public surface). |
| `packages/app-builder/api/tests/deployments.host.spec.ts` | +NEW | 8 tests covering empty registry, post-deploy record, projectId filter, missing-deployment-plugin failure, snapshot+started+succeeded ordering, projectId filter on stream, missing-deployment-plugin failure on stream, prototype method presence. |

### 2.2 Test + typecheck status (verified this session)

```sh
$ pnpm exec vitest run packages/app-builder/api/tests/deployments.host.spec.ts
 ✓ packages/app-builder/api/tests/deployments.host.spec.ts (8 tests) 294ms
 Test Files  1 passed (1)
      Tests  8 passed (8)```

- `pnpm exec tsc -p packages/app-builder/api/tsconfig.json --noEmit` => **0 errors**.
- Pre-push lefthook on the BFF commit (`pnpm run typecheck`) => **PASS in 28.57s** (host + client + tsdown).
- Pre-commit lefthook (lint + whitespace + vendor-manifest-guard) on the BFF commit => **all green**.

### 2.3 BFF Remote method surface (15 total after option 1)

13 existing methods from 2.1-2.4 + 2 new in 2.5 option 1:

| Method | Mode | New in |
|---|---|---|
| `listProjects`, `createProject`, `getProject`, `deleteProject` | unary | Phase 2.x |
| `startSession`, `sendMessage`, `getTranscript`, `forkSession`, `resumeSession` | unary | Phase 2.x |
| `subscribeEvents` | stream | Phase 2.x |
| `getPreview` | unary | Phase 2.x |
| `deploy` | unary (typed `not-implemented`) | Phase 2.x |
| `getUsage` | unary (typed `not-implemented` on projectId-only path) | Phase 2.3 |
| `listDeployments` | unary | **Phase 2.5 option 1** |
| `subscribeDeploymentEvents` | stream | **Phase 2.5 option 1** |

## 3. Architecture context (read me first)

### 3.1 Capability seam

`packages/app-builder/api/` is the **App Builder Host BFF** as a Typert Remote
service. Its class `AppBuilderApi extends TypertRemoteService`:

- Default export, Service Definition (NOT a function plugin).
- Constructor calls `super(ctx, 'appBuilderApi', { namespace: 'appBuilder' })`.
- `static inject = ['appBuilderProjects', 'sessionController', 'tokenMeter']`
  enforces required services via Cordis's Service injection machinery — the BFF
  class is **deferred** until those three are present. `appBuilderDeployment`
  is intentionally NOT in the inject list: `listDeployments` /
  `subscribeDeploymentEvents` throw informative errors when the deployment
  plugin is missing, so a bundle that intentionally omits the deployment
  plugin still constructs the BFF.

### 3.2 Stream pattern (canonical)

The new `subscribeDeploymentEventsRemote` mirrors the canonical async
generator pattern used by `sessionController.follow` (see
`packages/api/session-controller/src/history.ts:87`). The five parts:

1. **Opening `snapshot` frame** (`yield` the current registry state).
2. **Buffered queue** (`buffered: DeploymentStreamEvent[]`).
3. **Wake-up resolver** (`wake: (() => void) | undefined`; `notify()`
   consumes + clears it).
4. **Listeners** via `ctx.on('deployment/started|succeeded|failed', ...)` that
   push to the buffer + call `notify()`. All listeners push to the array
   returned by `ctx.on(...)` for cleanup.
5. **`finally` block** that disposes listeners + removes the abort handler.
6. **Closing `closed` frame** with reason `'cancelled'` (on signal abort)
   or `'source-closed'` (fallthrough).

The client pane's `useDeployments` (when written) must:
- Open the stream via the gateway transport (`ctx.typertGateway.wireStream`
  through @deepseek-ai/dsh-client-connection).
- Iterate frames in a useEffect; on cleanup, call `controller.abort()`.
- Keep a `state.deployments` map keyed by `id`; on `event` frames, replace
  or insert the deployment; on `closed` frames, mark `state.streamState` as
  `closed` and reconnect after a backoff.

### 3.3 Test fixture pattern (canonical)

`packages/app-builder/api/tests/deployments.host.spec.ts` uses:

- `@deepseek-ai/cordis` + `@deepseek-ai/cordis-plugin-loader` +
  `@deepseek-ai/cordis-plugin-include` to boot a real cordis.yml.
- The modules map at `context.loader.internal.import` simulates Node module
  resolution. AppBuilderApi is mounted via `ctx.plugin(AppBuilderApiPlugin.default)`
  AFTER `context.loader.await()` — class services are NOT loaded from yaml;
  only function plugins are. (See `api-methods.host.spec.ts:142` for the
  reference pattern.)
- A fake `FakeSessionController extends Service` satisfies the BFF's
  `sessionController` inject.
- Real project + deployment registries drive the workflow; only the
  session lifecycle is mocked.

## 4. Files to write in the next session (UI panes + shell + bundle)

### 4.1 New client packages (TWO)

1. `packages/client/ui-app-builder-deployments/`
2. `packages/client/ui-app-builder-preview-iframe/`

Each must include:

- `package.json` — mirror `packages/client/ui-app-builder-projects/package.json`
  EXACTLY (replace `projects` with `deployments` or `preview-iframe`).
  - `"name": "@deepseek-ai/dsh-client-ui-app-builder-deployments"`
  - `"dsh.client.inject"`: add `@deepseek-ai/dsh-client-ui-app-builder-preview-iframe`
    to the deployments one (so it can use the same shared styles / primitives).
  - peerDependencies / devDependencies: include `@deepseek-ai/dsh-client-ui-app-builder-shell`,
    `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-locale`, etc.
- `tsconfig.json` — mirror `packages/client/ui-app-builder-projects/tsconfig.json`.
- `tsdown.config.ts` — use `clientBundle('@deepseek-ai/dsh-client-ui-app-builder-{deployments|preview-iframe}',
  ['lib/types/index.js', 'lib/types/invariant.js'])`.
- `src/index.ts` — empty `apply()` (no Node-side behavior; pure browser UI).
- `src/invariant.ts` — empty `install: () => {}` with a documented
  "No runtime invariant" reason (this is a pure presentation pane).
- `src/css-modules.d.ts` — verbatim from the projects pkg.
- `src/client/index.ts` — apply that `ctx.slots.inject`s into the slot.
- `src/client/{Pane}.tsx` + `{Pane}.module.css` + `locales.ts` +
  `stores.ts` (if needed) + `contract/slots.ts` (slot owner typings).
- `README.md` + `README.zh.md` + `README.i18n.yaml`.
- `tests/{name}.client.spec.tsx` (8+ tests, `// @vitest-environment jsdom`
  on line 1, structured exactly like `projects-list.client.spec.tsx`).

### 4.2 Slot registration

The deployments pane registers:

```ts
// packages/client/ui-app-builder-deployments/src/client/index.ts
ctx.slots.inject('app-builder.deployments', () => ctx.slots.register({
  name: 'app-builder-deployments',
  locale: NS,
  owner: AppBuilderDeploymentsOwnerProps,
}, DeploymentsList))
```

where `AppBuilderDeploymentsOwnerProps = { readonly selectedProjectId?: string }`
and the matching `SlotMap` entry goes in
`packages/client/ui-app-builder-shell/src/client/contract/slots.ts`.

The preview iframe registers `app-builder.preview` with owner
`AppBuilderPreviewOwnerProps` (already declared in the shell) — see
`packages/client/ui-app-builder-shell/src/client/contract/slots.ts:49`. The
existing shell creates that slot's children declaration; the preview-iframe
package is the renderer that fills it.

### 4.3 Shell edits (THREE files in the same commit)

| File | Change |
|---|---|
| `packages/client/ui-app-builder-shell/src/client/contract/slots.ts` | Add `'app-builder.deployments': { kind: 'single', scope: 'root' }` to the shell's children declaration. Add `AppBuilderDeploymentsOwnerProps` interface (`{ selectedProjectId?: string }`). |
| `packages/client/ui-app-builder-shell/src/client/Shell.tsx` | Render a 4th pane via `{renderSlot('app-builder.deployments', { selectedProjectId })}` inside a new `<aside className={styles.deployments} data-pane='deployments'>`. |
| `packages/client/ui-app-builder-shell/src/client/{Shell.module.css,Shell.css,...}` | Add `.deployments` rules using the same `--dsw-*` token layer. Match the project's grid layout (`grid-template-areas: ...`; the shell's existing layout has `projects | chat | preview` — add a 4th column or 4th row as the CSS permits). |

### 4.4 Bundle wiring (THREE files)

| File | Change |
|---|---|
| `packages/bundle/web-app/cordis.patch.yml` | Add 2 `dsh.client` rows after the existing `app-builder-projects` row: `app-builder-deployments` (config: `deploymentStreamUrl: !!js `/api/appBuilder/listDeployments``) and `app-builder-preview-iframe` (config: `previewUrlForProject: !!js `/api/appBuilder/getPreview``). |
| `packages/bundle/web-app/package.json` | Add 2 `dependencies` entries: `@deepseek-ai/dsh-client-ui-app-builder-deployments` and `@deepseek-ai/dsh-client-ui-app-builder-preview-iframe`. |
| `packages/bundle/app-builder/cordis.patch.yml` | NO change needed (host plugin rows; both panes are pure browser). |
| `tsconfig.client.json` | Add 2 `references` entries after the existing `ui-app-builder-projects` line: each pointing to the new package. |

### 4.5 Agent Note (English-only per 1.5.7 directive)

`docs/PROJECT.md` location is at `/docs/PROJECT.md`; but per AGENTS.md the notes
live at `.agents/notes/implemented/architecture/2026-{date}-phase-2-5-ui-eventsource.md`.

Title: `feat(app-builder): UI status panes + EventSource-backed preview (Phase2.5)`.

Required content: Status (partial / pending UI), Problem, Decision, Supersession,
Alternatives×5, Consequences×8. Carry-forward §9 must include:

- The existing 9 oxlint baseline errors (carry-forward from 2.4 carry-forward from
  2.3 — see `scripts/oxlint-baseline-failures.md` if present).
- The new `verify-cordis-inspect-catalog` failure (latent typert bug
  `packages/client/ui-approval/src/client/contract/slots.ts:71`).
- `verify-doc-budgets` (`packages/client/ui-app-builder-shell/README.md` may
  need a few extra chars; don't try to fix).
- The 2 missing agent notes from §9 backlog.

## 5. Test commands for the next session

```sh
# Typecheck just the api package (fast feedback)
pnpm exec tsc -p packages/app-builder/api/tsconfig.json --noEmit

# Run only BFF deployments tests
pnpm exec vitest run packages/app-builder/api/tests/deployments.host.spec.ts

# Run BFF tests (deployments + existing api-methods)
pnpm exec vitest run packages/app-builder/api/tests/

# Run projects-list tests to validate the existing slot pattern
pnpm exec vitest run packages/client/ui-app-builder-projects/tests/

# Typecheck the whole repo (host + client + tsdown)
cd D:\my_deepseek_harness\deepseek-harness ; pnpm run typecheck

# Repo-wide client GUI suite (per packages/client/AGENTS.md check ladder rung 1)
pnpm run test:gui
```

## 6. Schema / API references

### 6.1 Wire shape (BFF Remote methods)

```ts
// packages/app-builder/api/src/types.ts (excerpt)
export interface DeploymentShape {
  readonly id: string  // branded DeploymentId erased to plain string on the wire
  readonly projectId: string
  readonly target: string
  readonly status: DeploymentStatus
  readonly gateResults: readonly DeploymentGateResultShape[]
  readonly url?: string
  readonly reason?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ListDeploymentsRequest {
  readonly projectId?: string
}
export interface ListDeploymentsValue {
  readonly deployments: readonly DeploymentShape[]
}

export interface SubscribeDeploymentEventsRequest {
  readonly projectId?: string
}
export type DeploymentStreamEvent =
  | { readonly type: 'started'; readonly deployment: DeploymentShape }
  | { readonly type: 'succeeded'; readonly deployment: DeploymentShape }
  | { readonly type: 'failed'; readonly deployment: DeploymentShape; readonly reason: string }
export type SubscribeDeploymentEventsFrame =
  | { readonly type: 'snapshot'; readonly cursor: number; readonly records: readonly DeploymentShape[] }
  | { readonly type: 'event'; readonly seq: number; readonly event: DeploymentStreamEvent }
  | { readonly type: 'closed'; readonly reason: 'cancelled' | 'source-closed' }
```

### 6.2 Cordis context surface (modules to import)

- `ctx.appBuilderDeployment` — `DeploymentRegistry` (process-local; methods:
  `deploy`, `get`, `list`, `has`, `toValue`, `latestForProject`).
- `ctx.appBuilderDeployment.list()` returns `readonly Deployment[]` — used by
  the opening snapshot.
- `ctx.appBuilderProjects.get(id)` — used inside `deploy.host.spec.ts` but
  not by the BFF methods.
- Events: `'deployment/started' | 'deployment/succeeded' | 'deployment/failed'`
  — payloads declared in `packages/app-builder/deployment/src/types.ts`.

## 7. Known issues / carry-forward

### 7.1 Reappearing latent typert bug (`verify-cordis-inspect-catalog`)

Adding 2 more `tsconfig.client.json` references in 2.5 (deployments +
preview-iframe) will again trigger typert to re-analyze
`packages/client/ui-approval/src/client/contract/slots.ts:71`, where the
`readonly kind = 'approval' as const` declaration lacks an explicit type
annotation. The one-line fix is:

```ts
// packages/client/ui-approval/src/client/contract/slots.ts:71
- readonly kind = 'approval' as const
+ readonly kind: 'approval' = 'approval' as const
```

This is technically unrelated to the 2.5 scope. **Defer to a follow-up PR per
AGENTS.md "no-silent-unrelated-fix"**, but EXPECT this gate to fail in CI for
2.5 even when option 1's BFF-only commit is correct. Document the carry-forward
in the Agent Note §9.

### 7.2 oxlint baseline errors (9 entries)

2.3 and 2.4 left 9 oxlint baseline errors unfixed. Adding more client packages
in 2.5 will keep the count the same (no new lint failures expected from the
clean 2.4 code patterns). If `pnpm run lint` adds new errors, the Agent Note
§9 lists them with file:line.

### 7.3 PAT (Personal Access Token) carry-forward

2.4 PR (`feat/phase2-4-projection-ui` → `feat/phase2-2-tool-policy`) is
blocked on the user fixing their GitHub PAT permissions. The user explicitly
stated they will resolve it later. **Do not act on the PAT in this session.**
When 2.4 merges, 2.5 should rebase onto the new 2.4 head before its own PR.

## 8. Resume task list (12 todos, ready to run)

The task list below drives phase 2.5 to completion. Each task is one step in
the implementing role. The reference for each step is in the file paths
section above.

| # | Task | Surfaces touched | Steps |
|---|---|---|---|
| 1 | Scaffold `packages/client/ui-app-builder-deployments` skeleton | 7 files (package.json, tsconfig.json, tsdown.config.ts, src/index.ts, src/invariant.ts, src/css-modules.d.ts, README placeholder). Mirror 2.4's projects pkg. | copy from `packages/client/ui-app-builder-projects` and rename; replace README content; verify tsc compiles empty package. |
| 2 | Implement `ui-app-builder-deployments` slot registration + component + locale + CSS | 5 files (src/client/index.ts, src/client/{DeploymentsList,DeploymentsList.module.css,locales,contract/slots}.ts) | `ctx.slots.inject('app-builder.deployments', () => ctx.slots.register({...}, DeploymentsList))`; pull deployments stream via the standard client remotes; render scrollable list with empty / loading / error states. |
| 3 | Write 12 tests for `ui-app-builder-deployments` | 1 file (tests/deployments.client.spec.tsx, jsdom env) | Mirror `packages/client/ui-app-builder-projects/tests/projects-list.client.spec.tsx`: empty stream, snapshot-only no events, snapshot + started, snapshot + succeeded, projectId filter, error banner, locale (en + zh), redux of slot state, no-project empty state. |
| 4 | Scaffold `packages/client/ui-app-builder-preview-iframe` skeleton | 7 files (same shape as deployments) | Mirror deployments pkg; inject `@deepseek-ai/dsh-client-ui-app-builder-shell`, NOT deployments. |
| 5 | Implement `ui-app-builder-preview-iframe` slot registration + iframe + EventSource | 5 files | `ctx.slots.inject('app-builder.preview', () => ctx.slots.register({...}, PreviewIframe))` (this slot is already declared in the shell); pull `getPreview` per selected project; subscribe `subscribeEvents` for url transitions; render `<iframe src={url}>` with reload on URL change, plus loading / idle / stopped / failed states. |
| 6 | Write 12 tests for `ui-app-builder-preview-iframe` | 1 file (tests/preview-iframe.client.spec.tsx, jsdom env) | Mirror projects-list.test pattern. Cover: idle / starting / ready / failed / stopped url-handoff, projectId change triggers reload, locale strings, accessibility (`aria-label` on iframe). |
| 7 | Edit shell: add 4th slot + pane + CSS for the deployments area | 3 files (shell/contract/slots.ts, shell/Shell.tsx, shell css-modules) | Add `'app-builder.deployments'` to `children` declaration; declare `AppBuilderDeploymentsOwnerProps`; render `<aside className={styles.deployments} data-pane='deployments'>{renderSlot('app-builder.deployments', { selectedProjectId })}</aside>`; add `.deployments` CSS rule that extends the existing grid. |
| 8 | Update `tsconfig.client.json` for both new packages | 1 file | Add 2 `{ "path": "./packages/client/ui-{app-builder-deployments,app-builder-preview-iframe}" }` references after `ui-app-builder-projects`. |
| 9 | Wire bundle: cordis.patch.yml rows + bundle package.json deps | 2 files | Add 2 `dsh.client` insert rows after `app-builder-projects`; add 2 `dependencies` entries. |
| 10 | Write bilingual READMEs + i18n.yaml for both new packages | 6 files (2x README.md, 2x README.zh.md, 2x README.i18n.yaml) | Copy structure from projects pkg's READMEs (replace "projects" with the new concept); run `pnpm run verify-translation-pairing` after to populate i18n.yaml. |
| 11 | Run full typecheck (`pnpm run typecheck`) + targeted tests | shell commands | Expect: 8 (BFF deployments) + 12 (deployments) + 12 (preview-iframe) + 6 (shell) + 15 (projects-list) = 53 PASS. Typecheck PASS. |
| 12 | Author Agent Note + commit + push + PR | 1 new file (Agent Note), 2 commits on the branch | Note must include §9 carry-forwards (oxlint baseline 9, verify-cordis-inspect-catalog latent, doc-budgets, etc.). Push to remote. Create PR via `gh api` or `curl POST /repos/{owner}/{repo}/pulls` once PAT has `pull_requests:write` scope. |

### 8.1 Optional follow-up (after user confirms)

| # | Task | When |
|---|---|---|
| 13 | Add BFF `subscribePreview` + types + 6 tests (option 2) | Only if user says "do option 2" |
| 14 | Refactor preview iframe pane to consume `subscribePreview` and degrade gracefully to `getPreview` polling when not present | Same as above |
| 15 | Land one-line ui-approval `readonly kind` fix as separate follow-up PR | After 2.5 PR merges, unblocks verify-cordis-inspect-catalog permanently |

## 9. Key file paths at handoff time

| Path | Purpose |
|---|---|
| `packages/app-builder/api/src/deployments.ts` | NEW; the 2.5 option-1 Remote methods. Read first. |
| `packages/app-builder/api/src/types.ts` | Extended; append `DeploymentStreamEvent` block at the end. |
| `packages/app-builder/api/src/index.ts` | Extended; the 2 new `@Remote` methods live there. |
| `packages/app-builder/api/tests/deployments.host.spec.ts` | NEW; 8 passing tests. Reference for the test fixture pattern. |
| `packages/app-builder/deployment/src/index.ts` | Re-exports `DeploymentStatus` from this session. |
| `packages/app-builder/deployment/src/types.ts` | Source of truth for `Deployment`, `DeploymentStartedEvent`, etc. |
| `packages/app-builder/deployment/src/index.ts:49` | `DeploymentRegistry` class definition. |
| `packages/api/session-controller/src/history.ts:87` | The canonical `follow()` async generator — template for SSE streams. |
| `packages/client/ui-app-builder-shell/src/client/Shell.tsx` | 3-pane shell; add 4th pane here. |
| `packages/client/ui-app-builder-shell/src/client/contract/slots.ts` | Slot owner typings; add `'app-builder.deployments'` here. |
| `packages/client/ui-app-builder-projects/src/client/index.ts` | Reference for `ctx.slots.inject` pattern. |
| `packages/client/ui-app-builder-projects/tests/projects-list.client.spec.tsx` | Reference for client tests (8+ tests, jsdom, PropsRuntime/PropsRenderSlots). |
| `packages/bundle/web-app/cordis.patch.yml` | Add 2 `dsh.client` rows after `app-builder-projects`. |
| `packages/bundle/web-app/package.json` | Add 2 deps. |
| `packages/bundle/app-builder/cordis.patch.yml` | NO change needed. |
| `tsconfig.client.json` | Add 2 references. |
| `apps/web/` | No change needed in 2.5 (pure browser via dsh.client rows). |

## 10. Resume command (fresh session, no context)

```sh
cd D:\my_deepseek_harness\deepseek-harness
git checkout feat/phase2-5-ui-eventsource
cat .agents/drafts/phase2-5-handoff.md    # this file, if committed to a draft branch; OR git log -p shows the BFF option-1 commit
pnpm run typecheck                          # expect PASS
pnpm exec vitest run packages/app-builder/api/tests/deployments.host.spec.ts   # expect 8/8 PASS
# then start the §8 todo list using todo_write
```

When the user signals "go" on the UI panes, resume at task 1 with the
`ui-app-builder-deployments` scaffold.

---

# Phase 2.5 — Session 2 Update (option 2 BFF done; UI panes still pending)

> Appended by the same workflow on the `feat/phase2-5-ui-eventsource`
> branch after the user said "continue/resume also include subscribePreview
> BFF Remote method". The original handoff above is still authoritative
> for the UI surface; this section records what changed in the second
> session and what the next session should pick up.

## 0. Branch state at session-2 close

| Key | Value |
|---|---|
| Working branch | `feat/phase2-5-ui-eventsource` |
| Tip | `831bfb1f5e0c5cd81a35e3baecb3588ec81c8a8b` (option 2 commit) |
| BFF option 1 | already on `0abc84c892` (prior session) |
| Working tree | clean |
| UI panes | not started in this session |
| Branch pushes | both commits on `origin/feat/phase2-5-ui-eventsource` |

## 1. What was delivered in session 2

### 1.1 Option 2 BFF: `subscribePreview` Remote method

| File | Change |
|---|---|
| `packages/app-builder/api/src/types.ts` | Appended `PreviewStreamRecord`, `SubscribePreviewRequest`, `PreviewStreamEvent`, `SubscribePreviewFrame` (last 32 lines). |
| `packages/app-builder/api/src/preview.ts` | Imported `AppBuilderPreviewDevState` from the snapshot-bridge; added `bridgeEntryToRecord`, `devStateToRecord`, `readBridge`, `projectIdForRootPath`, and the `subscribePreviewRemote` async generator. |
| `packages/app-builder/api/src/index.ts` | Added 2 new imports + 1 method, extended the re-export block. |
| `packages/app-builder/api/tests/preview-stream.host.spec.ts` | NEW; 10 tests PASS. |

### 1.2 Test + typecheck status (session 2)

```sh
$ pnpm exec vitest run packages/app-builder/api/tests/preview-stream.host.spec.ts
 PASS  packages/app-builder/api/tests/preview-stream.host.spec.ts (10 tests) 680ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

```sh
$ pnpm run typecheck
build:lib:host: PASS
typecheck:contracts-ready: PASS
```

- All 18 BFF tests pass (8 deployments + 10 preview-stream).
- 1 pre-existing failure in `api-methods.host.spec.ts > getTranscript` — confirmed on the clean prior commit, unrelated to this session.
- Lefthook pre-commit on the option 2 commit: lint + whitespace + vendor-manifest-guard all green.
- Pre-push typecheck on the option 2 commit: PASS.

### 1.3 BFF surface after session 2 (15 Remote methods)

13 prior + 2 new in Phase 2.5 (option 1: `listDeployments`, `subscribeDeploymentEvents`; option 2: `subscribePreview`). The BFF now exposes every upstream event surface the UI panes need.

## 2. Architecture context (carried over)

The async generator in `subscribePreviewRemote` mirrors the canonical
`sessionController.follow` pattern: a buffered queue + a wake-up
resolver + an AbortSignal-driven close path. The single
`app-builder-preview/dev-state` listener disposes in `finally` so a
signalled carrier does not leak the upstream subscription.

The snapshot frame is derived from
`appBuilderSnapshotBridge.snapshot().devServers` filtered by `projectId`.
The stream frame is the `rootPath -> projectId` resolution at call
time (the bridge uses the same resolution for its own snapshot).

The test rig applies the snapshot-bridge plugin **directly** (not via
YAML) so the FakeWebServer Service (mounted in the same fiber as the
bridge `apply`) satisfies the bridge `ctx.webServer` inject check. A
YAML-loaded bridge does not see the FakeWebServer because the Loader
runs each plugin in a child fiber and the Service `reflect.provide`
is rooted in the parent.

## 3. Files to write in the next session (UI panes — UNCHANGED)

The original handoff section 4 is still the source of truth. The only
difference is that the BFF prerequisites are now both done (option 1
+ option 2). The next session can resume directly at handoff section
8 task 1.

## 4. Known issues / carry-forward (UNCHANGED from session 1)

The latent `verify-cordis-inspect-catalog` bug
(`packages/client/ui-approval/src/client/contract/slots.ts:71` missing
`readonly kind: 'approval'` annotation) still exists and will re-fire
when task 8 (tsconfig.client.json references) lands. Defer to a
follow-up PR per AGENTS.md "no-silent-unrelated-fix"; document in the
Agent Note section 9.

The pre-existing `getTranscript` test failure in `api-methods.host.spec.ts`
is unrelated to Phase 2.5. Document and defer to the Phase 2.x
follow-up that fixes `getTranscriptRemote` `inspection.events.at(-1)` access.

## 5. Resume command (fresh session, no context)

```sh
cd D:\my_deepseek_harness\deepseek-harness
git checkout feat/phase2-5-ui-eventsource
git log --oneline -3 feat/phase2-5-ui-eventsource
pnpm run typecheck
pnpm exec vitest run packages/app-builder/api/tests/preview-stream.host.spec.ts
pnpm exec vitest run packages/app-builder/api/tests/deployments.host.spec.ts
# then start the section 8 todo list using todo_write
```

When the user signals go on the UI panes, resume at task 1 with the
`ui-app-builder-deployments` scaffold.


## 6. Session 3 — UI panes inspection (no code written)

Branch: `feat/phase2-5-ui-eventsource` @ `831bfb1f5e` (unchanged from session 2 tip).
Working tree clean. No commits added in session 3 — only inspection.

### 6.1 Critical prerequisite discovered (must be done BEFORE task 1)

The BFF currently exposes its Remote methods on the host side but has NO
browser-side Remote contribution. The UI panes cannot call BFF Remote
methods until the BFF package gets `./typert` + `./remote` exports. This
was missing from the original session 1 handoff. Without it, the pane
code will fail typecheck (`Cannot find module '@deepseek-ai/dsh-app-builder-api/remote'`)
and runtime (`ctx.remote.appBuilder` namespace not registered).

### 6.2 How the browser reaches the BFF

`packages/api/remotes/src/client/index.ts` imports each Remote namespace
via a `/remote` subpath and passes it to `ctx.remote.$mount(...)`. Example:
```ts
import sessionRemote from '@deepseek-ai/dsh-api-session-controller/remote'
...
for (const contribution of [agentPresetsRemote, ..., sessionRemote, ...]) {
  disposers.push(await ctx.remote.$mount(contribution))
}
```
After mount, browser code calls `ctx.remote.<namespace>.<method>(args)` where
`<namespace>` is the second argument of `TypertRemoteService(ctx, name, { namespace: 'appBuilder' })`
(see `packages/app-builder/api/src/index.ts:141`). The namespace here is `appBuilder`.
Call shape: `ctx.remote.appBuilder.listDeployments({})` returns
`Promise<ClientResult<ListDeploymentsValue>>`; `ctx.remote.appBuilder.subscribeDeploymentEvents({ projectId: filter }, signal)`
returns `AsyncIterable<SubscribeDeploymentEventsFrame>`.

### 6.3 Typert generation pipeline

Root `tsdown.config.ts` wires `typertPlugin({ mode: 'workspace', faces: ['host'] })`.
When `pnpm run build:lib:host` runs (tsc + `tsdown --env.DSH_BUILD_FACE host`),
the plugin emits per-package `lib/typert.host.{js,d.ts}` (Host reflection) and
`lib/typert.remote-client.{js,d.ts}` (browser Remote contribution) for any
package whose `package.json` declares `./typert` or `./remote` exports.

Required per `packages/typert/generator/src/workspace.ts:validateExport`:
- `./typert` export must point to `./lib/typert.host.{js,d.ts}`
- `./remote` export must point to `./lib/typert.remote-client.{js,d.ts}`
- `files` must include `lib/typert.host.{js,d.ts}`, `lib/typert.remote-client.{js,d.ts}`

`pnpm run typecheck` calls `build:lib:host` first, so the artifacts are
rebuilt automatically before typecheck runs.

### 6.4 UI pane wiring pattern (from `packages/client/ui-deliverables`)

Each pane plugin declares its dependencies via `inject = ['connection', 'remote', ...]`.
The `connection` is `ConnectionHandle` (transport); the `remote` is `ClientRemote`
(typed namespace map from api-gateway/client).

Browser calls: `const result = await ctx.remote.appBuilder.listDeployments({}); if (result.ok) ... else ...error`.
Streaming: `for await (const frame of ctx.remote.appBuilder.subscribeDeploymentEvents({}, signal)) ...`.
Use `signal.addEventListener('abort', ...)` and dispose upstream in `finally`.
Mirror the canonical async-generator pattern from `packages/api/session-controller/src/history.ts:87`
(`follow()`): buffered queue + wakeup resolver + ctx listeners + `finally` dispose.

### 6.5 Shell changes (must add 4th slot)

`packages/client/ui-app-builder-shell/src/client/contract/slots.ts` adds to
SlotMap: `'app-builder.deployments': { kind: 'single', scope: 'root', owner: AppBuilderDeploymentsOwnerProps }`.
New interface: `AppBuilderDeploymentsOwnerProps { children?: never; selectedProjectId?: string }`.

`Shell.tsx` adds 4th slot rendering: `<aside data-pane='deployments'>{renderSlot('app-builder.deployments', { selectedProjectId })}</aside>`.

`Shell.module.css` adds `grid-template-areas` row `'projects chat deployments preview'`
and corresponding `grid-template-columns: 260px minmax(0, 1fr) 260px minmax(0, 1fr)`.
New `.deployments { grid-area: deployments; border-right: 1px solid; ... }` selector.

### 6.6 Test patterns

Mirror `packages/client/ui-app-builder-projects/tests/projects-list.client.spec.tsx`
(15 tests): jsdom env, mock snapshot store via `createSnapshotStore(initialState)`,
build props with `useSnapshot: selector => selector(store.getSnapshot())`,
declare `LocaleNamespaceMap` locally so `t` resolves to `TranslateNS<...>`.

For the SSE pane, the test mocks `ctx.remote.appBuilder.subscribeDeploymentEvents`
returning an async iterable driven by a manual queue (push frames, dispose on `signal.aborted`).
Verify: snapshot frame populates store, event frame appends records, abort closes the stream,
projectId filter drops non-matching events, `selectedDeploymentId` mirror toggles `aria-pressed`.

## 7. Revised task list (Session 3 - supersedes session 1 section 8)

Numbered 1-14. Resume at task 1 in a fresh session.

### Phase A - BFF browser Remote wiring (prerequisite)

1. Add BFF exports - edit packages/app-builder/api/package.json:
   - Add "./typert" entry to exports (types: ./lib/typert.host.d.ts, default: ./lib/typert.host.js).
   - Add "./remote" entry to exports (types: ./lib/typert.remote-client.d.ts, default: ./lib/typert.remote-client.js).
   - Add to files: lib/typert.host.js, lib/typert.host.d.ts, lib/typert.remote-client.js, lib/typert.remote-client.d.ts.
   - Confirm peer/dev: dsh-typert-protocol and dsh-typert-registry are present (they already are).
2. Generate typert artifacts - run pnpm run build:lib:host. Expected: packages/app-builder/api/lib/typert.host.{js,d.ts} and lib/typert.remote-client.{js,d.ts,d.ts.map} appear.
3. Mount appBuilderApiRemote - edit packages/api/remotes/src/client/index.ts:
   - Add import appBuilderApiRemote from @deepseek-ai/dsh-app-builder-api/remote
   - Add appBuilderApiRemote to the $mount array (alphabetic order).
4. Add bundle dependency - edit packages/bundle/web-app/package.json:
   - Add @deepseek-ai/dsh-app-builder-api as workspace dependency (alphabetic).
   - Run pnpm install.
5. Validate Phase A - run pnpm run typecheck. Expected: PASS.

### Phase B - ui-app-builder-deployments package

6. Scaffold - create 8 skeleton files in packages/client/ui-app-builder-deployments/:
   - package.json (mirror ui-app-builder-projects/package.json; replace projects with deployments; deps: add @deepseek-ai/dsh-api-remotes to peer+dev).
   - tsconfig.json (mirror projects/tsconfig.json; references: add ../api/remotes/tsconfig.client.json).
   - tsdown.config.ts (mirror projects/tsdown.config.ts exactly).
   - src/index.ts (empty apply, mirror projects/src/index.ts docstring).
   - src/invariant.ts (PACKAGE_NAME equals the deployments package).
   - src/css-modules.d.ts (verbatim from projects).
   - README.md (mirror projects; EN-only per agent-note directive - skip zh.md + .i18n.yaml).
7. Source files - create in src/client/:
   - index.ts (apply body; opens SSE stream via ctx.remote.appBuilder.subscribeDeploymentEvents; mirrors signal abort listener + finally dispose pattern; registers slot).
   - app-builder.ts (re-declare AppBuilderShellService shape - copy from projects verbatim).
   - snapshot.ts (export DeploymentStatus, DeploymentShape, DeploymentStreamEvent, SubscribeDeploymentEventsFrame, EMPTY_DEPLOYMENTS).
   - stores.ts (export createAppBuilderDeploymentsSnapshotStore; shape records, cursor, status, error).
   - locales.ts (bilingual keys: paneTitle, paneSubtitle, noDeploymentsTitle, noDeploymentsHint, streamUnavailable, streamClosed, statusPending, statusRunning, statusSucceeded, statusFailed, statusCancelled).
   - DeploymentsList.tsx (per-row: deployment.id, projectId, target, status badge, createdAt; aria-pressed when owner.selectedProjectId equals deployment.projectId).
   - DeploymentsList.module.css (status badge styles for pending, running, succeeded, failed, cancelled).
   - contract/slots.ts (re-declare slot map fragment; AppBuilderDeploymentsComponentProps = PropsRuntime + PropsLocale + AppBuilderDeploymentsHooks; Context merge for appBuilder).
8. Add tests - create packages/client/ui-app-builder-deployments/tests/deployments-list.client.spec.tsx (12 tests). Cover: empty stream, snapshot 3 records, status badges, event frame appends, abort closes stream, projectId filter, locale en+zh, aria-pressed mirror, row click navigates to project, error frame surfaces banner.
9. Wire tsconfig.client.json - add a references entry for ui-app-builder-deployments (after ui-app-builder-projects).
10. Wire bundle - edit packages/bundle/web-app/cordis.patch.yml (add app-builder-deployments row after app-builder-projects, no snapshotUrl config) and packages/bundle/web-app/package.json (add @deepseek-ai/dsh-client-ui-app-builder-deployments as workspace dependency).

### Phase C - ui-app-builder-preview-iframe package

11. Scaffold and implement - same 7 source files + 1 test file as Phase B. Differences:
    - index.ts opens ctx.remote.appBuilder.subscribePreview, accumulates PreviewStreamRecord keyed by projectId, plus initial ctx.remote.appBuilder.getPreview to seed URL.
    - PreviewIframe.tsx renders iframe with src and sandbox=allow-scripts; re-renders when PreviewStreamRecord.url changes.
    - locales.ts keys: paneTitle, previewIdle, previewStarting, previewReady, previewFailed, previewStopped, previewNoProject, previewUrlLabel.
    - CSS: empty-state, error state with retry button (no-op), loading skeleton.
    - tests (12): empty shows previewIdle, snapshot ready renders iframe with URL, failed shows error, selectedProjectId triggers getPreview re-seed, abort closes stream, sandbox allow-scripts only, URL transition on event.
12. Wire - same tsconfig.client.json + bundle edits. The iframe fills the existing app-builder.preview shell-declared slot (its package id is preview-iframe).

### Phase D - Shell + bundle updates

13. Shell - edit packages/client/ui-app-builder-shell/src/client/{contract/slots.ts,Shell.tsx,Shell.module.css}:
    - slots.ts: add AppBuilderDeploymentsOwnerProps interface; add app-builder.deployments to SlotMap; extend PropsRenderSlots in AppBuilderShellComponentProps.
    - Shell.tsx: render 4th aside with data-pane=deployments and renderSlot(app-builder.deployments, { selectedProjectId }).
    - Shell.module.css: extend grid template to 4 columns (260 + 1fr + 260 + 1fr), grid-template-areas header+projects+chat+deployments+preview, add .deployments selector.
14. Update shell test - packages/client/ui-app-builder-shell/tests/shell.client.spec.tsx: extend RenderSlotCall slot union to include app-builder.deployments; add 2 tests (deployments slot receives selectedProjectId; renders 4 panes).

### Phase E - Validation + commit

15. Typecheck - pnpm run typecheck. Expected: PASS. If verify-cordis-inspect-catalog fails on packages/client/ui-approval/src/client/contract/slots.ts:71, document and defer.
16. Targeted tests - run:
    - pnpm exec vitest run packages/app-builder/api/tests/preview-stream.host.spec.ts (10/10 PASS unchanged).
    - pnpm exec vitest run packages/app-builder/api/tests/deployments.host.spec.ts (8/8 PASS unchanged).
    - pnpm exec vitest run packages/client/ui-app-builder-deployments (12/12 new).
    - pnpm exec vitest run packages/client/ui-app-builder-preview-iframe (12/12 new).
    - pnpm exec vitest run packages/client/ui-app-builder-shell (existing + 2 new = ~8 PASS).
    - pnpm exec vitest run packages/client/ui-app-builder-projects (15/15 unchanged).
17. Lefthook pre-commit - commit message: feat(client): add ui-app-builder-deployments + ui-app-builder-preview-iframe (Phase 2.5 panes). Expected: PASS.
18. Lefthook pre-push - runs pnpm run typecheck. Expected: PASS.
19. Push - git push origin feat/phase2-5-ui-eventsource. Expected: success.

## 8. Files modified or created (expected diff size)

Phase A: 3 files modified (packages/app-builder/api/package.json, packages/api/remotes/src/client/index.ts, packages/bundle/web-app/package.json).

Phase B: 10 files created (packages/client/ui-app-builder-deployments/{package.json,tsconfig.json,tsdown.config.ts,README.md}, src/{index,invariant}.ts, src/css-modules.d.ts, src/client/{index,app-builder,snapshot,stores,locales}.ts, src/client/{DeploymentsList.tsx,DeploymentsList.module.css}, src/client/contract/slots.ts, tests/deployments-list.client.spec.tsx).

Phase C: 10 files created (same shape, names: ui-app-builder-preview-iframe, PreviewIframe, preview-iframe).

Phase D: 3 files modified (packages/client/ui-app-builder-shell/src/client/{contract/slots.ts,Shell.tsx,Shell.module.css}), 1 test extended (packages/client/ui-app-builder-shell/tests/shell.client.spec.tsx).

Wiring: 1 line added to tsconfig.client.json, 2 rows added to packages/bundle/web-app/cordis.patch.yml, 3 deps added to packages/bundle/web-app/package.json.

Total: 24 files modified/created, roughly 2,500 lines.

## 9. Critical patterns (MUST follow)

- Trailing newline: exactly one \n (not two). Lefthook pre-commit git diff --cached --check rejects trailing blanks.
- Max line length: 140 chars. Use named interfaces, not inline casts.
- Locale ownership: typed LocaleNamespaceMap declaration per pane; ctx.locale.register(NS, { zh, en }) in apply().
- Empty package apply() body for node-half (the pane is browser-only).
- Slot registration via ctx.slots.inject(<slot-name>, () => ctx.slots.register({ name, locale, inject: () => ({...}) }, Component)) - never ctx.slots.register directly when filling another package slot.
- Stream transport: for await (const frame of ctx.remote.<ns>.<streamMethod>({}, signal)), abort on signal, dispose in finally.
- Snapshot store: createSnapshotStore<AppBuilderDeploymentsState>(INITIAL_STATE), write via set/update, read via useSnapshot(selector).
- React: no ctx access in components; data arrives through the four props shares.
- Component-localization keys: keep en+zh identical keys; never hardcoded copy.
- tsdown.config.ts mirrors clientBundle(package, [lib/types/index.js, lib/types/invariant.js]) exactly.
- package.json exports must include ., ./invariant, ./client, ./src/*, ./package.json for client UI plugins.
- dsh.client block must declare platform: web and inject: [...] with package-name dependency edges (informational only - Cordis inject waits on services).

## 10. Resume command (fresh session, no context)

```sh
cd D:\my_deepseek_harness\deepseek-harness
git checkout feat/phase2-5-ui-eventsource
git pull origin feat/phase2-5-ui-eventsource  # if push unblock lands during session
cat .agents/drafts/phase2-5-handoff.md  # read this document
git fetch origin phase2-5-handoff-draft:phase2-5-handoff-draft
git checkout phase2-5-handoff-draft -- .agents/drafts/phase2-5-handoff.md
pnpm run typecheck  # confirm baseline green
pnpm exec vitest run packages/app-builder/api/tests/preview-stream.host.spec.ts
pnpm exec vitest run packages/app-builder/api/tests/deployments.host.spec.ts
# then start task 1 from section 7 above using todo_write
```

When the user signals go on the UI panes, resume at task 1 (Phase A: BFF
browser Remote wiring). Phase A MUST complete before any UI pane code is
written - the pane code references @deepseek-ai/dsh-app-builder-api/remote
which does not exist until Phase A task 2 emits it.

---

## Session 4 update — Phase A attempted, BFF wiring blocked by TS2878 cascade

**Branch**: `feat/phase2-5-ui-eventsource` @ `831bfb1f5e` (clean, no changes from prior session).

**Goal**: Execute Phase A tasks 1-5 per section 7 above.

### What worked (Phase A.1 + A.2 PASS)

- Modified `packages/app-builder/api/package.json` to add `./typert` + `./remote` exports and `lib/typert.*.{js,d.ts}` to `files` list. Validator in `packages/typert/generator/src/workspace.ts:validateExport` accepts this.
- Ran `pnpm run build:lib:host` -> typert artifacts emitted to `packages/app-builder/api/lib/`:
  - `typert.host.js` (36671 bytes), `typert.host.d.ts` (123 bytes)
  - `typert.remote-client.js` (36611 bytes), `typert.remote-client.d.ts` (4614 bytes)
  - `typert.remote-client.d.ts.map` (706 bytes, never published)

### What broke (Phase A.3 BLOCKED)

Wired `appBuilderApiRemote` into `packages/api/remotes/src/client/index.ts` -> `tsc -b tsconfig.client.json` -> 40 TS2878 errors on clean base.

**Root cause**: TS2878 fires because `tsc -b` resolves `@deepseek-ai/dsh-app-builder-api/remote` from api/remotes/src/client/index.ts and tries to rewrite the workspace import to a relative path between the consumers and the targets output files. The typert emitter writes artifacts to `lib/typert.remote-client.d.ts` (root of `lib/`), but each package s `tsconfig.json` declares `outDir: lib/types` -> relative output path does not match source path.

### Why message-feedback, session-controller etc. do not trip this

1. They are listed in `packages/api/remotes/tsconfig.client.json` `references` array.
2. Once listed as a project reference, `tsc -b` uses the referenced project s `tsconfig.json` to compute the relative path between outputs -> short-circuits the rewrite attempt.

### Why adding the reference for app-builder/api cascades

Adding `{"path": "../../app-builder/api"}` -> 40 TS2878 -> 0, BUT causes SessionStore cascade:

- `packages/app-builder/api/tsconfig.json` references `packages/api/session-controller/tsconfig.host.json`.
- TS uses session-controller s HOST output -> redeclares `interface Context { sessions: SessionStore }`.
- The CLIENT face augmentation from `packages/api/session-controller/src/client/sessions/service.ts:182` is overridden by the Host declaration.
- Downstream UI packages (`ui-approval`, `ui-chat`, `ui-conversation`, `ui-model-selection`, etc.) that access `ctx.sessions` as `ISessions`/`ClientSessions` fail with TS2352 / TS2339 / TS2345 errors.

### Strategies tried that did not work

1. Add `tsconfig.client.json` to app-builder/api referencing only `lib/typert.remote-client.d.ts` with `noEmit: true`. Result: TS walks via `.d.ts.map` -> source -> vendor/cordis. Tried base + base.client.json extends -> various cascading errors. Tried `noResolve: true` -> TS requires `composite: true`.
2. Add `disableSourceOfProjectReferenceRedirect: true` to `tsconfig.base.json` -> eliminates TS2878 but breaks project-reference architecture.
3. Split root `tsconfig.json` into solution-only + `tsconfig.host.json` + `tsconfig.client.json` -> `tsc -b` wrote source files into `lib/` across many packages. Catastrophic. Required `git clean -fd` to recover.

### What is needed to unblock Phase A.3

A clean fix requires ONE of:

**Option A** (structural): Change the typert generator to emit artifacts to `lib/types/typert.*` instead of `lib/typert.*`. Affects 10+ packages. High blast radius; should land as a separate PR on its own branch.

**Option B** (bypass): Mount `appBuilderApiRemote` directly inside the UI panes own `apply`. The UI pane would do `ctx.remote.$mount(appBuilderApiRemote)` before reading `ctx.remote.appBuilder.*`. Trade-off: app-builder remote is the only Remote contribution not mounted by `api/remotes`.

**Option C** (workaround): Use a `paths` entry in `tsconfig.base.json` to map `@deepseek-ai/dsh-app-builder-api/remote` to the artifact source via paths.

### Recommended next step

Take **Option B** (bypass). It keeps the rest of Phase 2.5 unblocked and isolates the workaround to the two new UI packages.

### Status snapshot

- Branch: `feat/phase2-5-ui-eventsource` @ `831bfb1f5e` (clean)
- Typecheck: PASS (clean 2.5 base)
- Tests: 18 BFF tests PASS (10 preview-stream + 8 deployments)
- Skipped work: Phase A.3-A.5 + Phase B/C/D/E
---

# Phase 2.5 — Session 5 Update (absorb web seed-map fix; Phase A.3 still TS2878-blocked)

> Appended by the same workflow on the `phase2-5-handoff-draft` branch after the user reported the new GitHub PAT is in place and they merged "the last branch" to master. The merged PRs did not contain the web-run fixes — those lived on a different repository (`github.com/ahmadmhmdsy/deepseek-harness`, no `-work` suffix). Session 4 closed with Phase A.3 (BFF Remote wiring) blocked by TS2878 + SessionStore cascade. This session absorbs the web seed-map fix into the 2.5 stack, refreshes the handoff status, and confirms Phase A.3 remains the active unblock target.

## 0. What the user provided in this session

| Item | Value |
|---|---|
| New GitHub PAT | added to the `ahmadmhmdsy` account — `git ls-remote`, `git fetch`, `git push` all succeed against `https://github.com/ahmadmhmdsy/deepseek-harness-work.git` (origin) |
| Origin/master HEAD | `9b38f16fed` (Merge PR #2: app-builder-web-reskin) — **strict ancestor of my Phase 2.4 base** `32b10fda0d`; zero new commits to absorb there |
| Two merged PRs since session 4 | PR #1 (`fix/subagent-live-routing`, 5 files: subagent child routing) and PR #2 (`app-builder-web-reskin`, 9 files: CLAUDE.md symlink → regular-file copies) — **neither touches the web build/run pipeline** |
| Web-run fixes location | **a different repository**: `https://github.com/ahmadmhmdsy/deepseek-harness.git` (no `-work` suffix), on its `master` branch |
| Other/master HEAD | `c7b9d87c9e` (2 commits ahead of `71a23c4506` = my session-4 handoff commit) |
| Other/master commits ahead of my 2.4 base | 7 (5 are handoff doc commits already on `phase2-5-handoff-draft`; 2 are new: web seed-map fix + agent note) |

## 1. Cherry-picks absorbed into `feat/phase2-5-ui-eventsource`

| New SHA | Subject | Files | Note |
|---|---|---|---|
| `7a4ee612d1` | `fix(web): add static-linked dsh-client-store transitive deps to apps/web` | `apps/web/package.json` (+2 devDeps: `immer ^10.1.1`, `zustand ~4.4.7`), `pnpm-lock.yaml` (+immer/zustand pins, vitest vite@8 → vite@6 hoisting fix), `.agents/notes/implemented/process/2026-09-02-v0.1.2-alpha.1-seed-manifest-fix.md` (NEW, 68 lines) | Clean 3-way merge, zero conflicts |
| `e59c31aacf` | `docs(notes): record app-builder-shell children-table post-merge regression` | `.agents/notes/implemented/process/2026-09-02-v0.1.2-alpha.1-app-builder-shell-children-regression.md` (NEW, 133 lines) | Clean 3-way merge, zero conflicts |

Stack now:

```
e59c31aacf docs(notes): record app-builder-shell children-table post-merge regression
7a4ee612d1 fix(web): add static-linked dsh-client-store transitive deps to apps/web
831bfb1f5e feat(api): surface subscribePreview Remote method (Phase 2.5 option 2)
0abc84c892 feat(api): surface listDeployments + subscribeDeploymentEvents Remote methods (Phase2.5)
32b10fda0d feat(app-builder): wire sessionCounts from projection cache to projects pane (Phase2.4)
```

## 2. What the web fix does (per the agent note)

The v0.1.2-alpha.1 merge brought in `@deepseek-ai/dsh-client-store` as a staticLinked package whose `lib/index.js` retains runtime bare imports for `zustand/vanilla`, `zustand/middleware`, `zustand/shallow`, and `immer`. pnpm nests those under `apps/web/node_modules/@deepseek-ai/dsh-client-store/node_modules/`, so the Vite host cannot resolve them when bundling the shell, and Rollup tree-shakes the ClientStore namespace import. The bundled seed map then lacks `@deepseek-ai/dsh-client-store` and the runtime module table reports:

```
client-modules: require("@deepseek-ai/dsh-client-store") missed the module table
- not a platform seed word, not a materialized module, and no registered package factory
```

which gates `dsh-api-session-controller` from materializing in the browser. Promoting `zustand` and `immer` to direct `devDependencies` of `apps/web` hoists them into `apps/web/node_modules/`; Vite resolves them when bundling the shell; the seed map emits `@deepseek-ai/dsh-client-store`; the runtime require resolves.

The agent note operationalizes the static-link contract from `docs/architecture.md`:

> "The Vite host resolves and deduplicates those imports and decides final chunk boundaries."

— which is *not* automatic. The host must declare every staticLinked package's transitive deps in its own `devDependencies`. This is now in the 2.5 stack.

The second agent note (`e59c31aacf`) records a related but separate regression: `packages/client/ui-app-builder-shell`'s merged entry tries to register a new `app-builder-shell` slot via `ctx.slots.inject('root', ...)`, but no parent entry in the merged tree declares `app-builder-shell` in its children table. The runtime check at `packages/client/ui-slots/src/index.ts:786` throws. **Mitigation is a transient boot overlay that disables the three App Builder entries** (app-builder-shell, app-builder-projects, app-builder-snapshot-bridge); the source tree is unchanged. The architectural fix is the per-area 1.5.x follow-up. **This regression currently masks the App Builder Web shell at runtime; document in Agent Note §9 of any 2.5 PR.**

## 3. Verification after cherry-picks

```sh
$ pnpm install
Lockfile passes supply-chain policies (1292 entries in 10.8s)
Done in 22.2s using pnpm v11.7.0

$ node -e "console.log(require.resolve('zustand/vanilla', { paths: ['apps/web'] }))"
.../zustand@4.4.7_.../node_modules/zustand/vanilla.js

$ node -e "console.log(require.resolve('immer', { paths: ['apps/web'] }))"
.../immer@10.2.0/node_modules/immer/dist/cjs/index.js

$ pnpm run typecheck
build:lib:host: PASS
typecheck:contracts-ready: PASS (exit 0)

$ pnpm exec vitest run packages/app-builder/api/tests/preview-stream.host.spec.ts \\
                       packages/app-builder/api/tests/deployments.host.spec.ts
 Test Files  2 passed (2)
      Tests  18 passed (18)   ← 10 preview-stream + 8 deployments
```

All green. The BFF tests + typecheck still pass after absorbing the web fix.

## 4. Phase A.3 status (UNCHANGED from session 4)

The web seed-map fix is **orthogonal** to the Phase A.3 TS2878 blocker. The TS2878 + SessionStore cascade still blocks wiring `appBuilderApiRemote` into `packages/api/remotes/src/client/index.ts`. The three documented options (A: structural typert emitter change; B: bypass via UI-pane-internal `ctx.remote.$mount`; C: paths entry) remain the only paths forward.

**Recommendation unchanged: take Option B** in the next session. It keeps the rest of Phase 2.5 unblocked and isolates the workaround to the two new UI packages.

## 5. Branch / stack state at session-5 close

| Key | Value |
|---|---|
| Working branch | `feat/phase2-5-ui-eventsource` |
| Tip | `e59c31aacf` (web fix + agent note cherry-picked) |
| Working tree | clean |
| Typecheck | PASS |
| BFF tests | 18/18 PASS (10 preview-stream + 8 deployments) |
| New commits pushed | none yet (cherry-picks are local on `feat/phase2-5-ui-eventsource`) |
| Handoff branch | `phase2-5-handoff-draft` @ `71a23c4506` (about to advance with this entry) |
| Origin/master | `9b38f16fed` — ancestor of my 2.4 base; no new commits to absorb |
| Origin/other/master (`ahmadmhmdsy/deepseek-harness`) | `c7b9d87c9e` — has the web fix + agent note; both cherry-picked in |

## 6. Recommended next step (fresh session)

1. Push `feat/phase2-5-ui-eventsource` (with the two new cherry-pick commits) to origin/feat/phase2-5-ui-eventsource — lefthook pre-commit + pre-push will run.
2. Take **Option B**: in the new UI pane packages (`ui-app-builder-deployments` + `ui-app-builder-preview-iframe`), do `ctx.remote.$mount(appBuilderApiRemote)` inside each pane's own `apply` before reading `ctx.remote.appBuilder.*`.
3. Then resume Phase 2.5 task list at task 6 (scaffold `ui-app-builder-deployments`) per session-3 task list.
4. The `app-builder-shell children-table regression` (per agent note `e59c31aacf`) blocks the Web shell from materializing in the browser. This is out of scope for Phase 2.5; document and defer. The `ui-app-builder-{shell,projects}` boot overlay disables it.

## 7. Resume command (fresh session, no context)

```sh
cd D:\my_deepseek_harness\deepseek-harness
git checkout feat/phase2-5-ui-eventsource
git log --oneline -5
pnpm run typecheck                                                    # expect PASS
pnpm exec vitest run packages/app-builder/api/tests/preview-stream.host.spec.ts   # expect 10/10 PASS
pnpm exec vitest run packages/app-builder/api/tests/deployments.host.spec.ts    # expect 8/8 PASS
# then resume at task 1 (Option B) → task 6 (UI panes) per session-3 task list
```
