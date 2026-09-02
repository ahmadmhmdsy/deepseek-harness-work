## Summary

Phase 2 prompt §4 step 2.4: verify the 1.5.4 `project` projection unit end-to-end and add the live-session-count badge to the projects pane.

This PR ships the consumer-side follow-through for the 1.5.4 projection unit (Agent Note: `.agents/notes/implemented/architecture/2026-08-31-projection-cache-integration.md`):

- **Host**: `packages/app-builder/snapshot-bridge` computes a per-project session count from `ctx.sessions.list()` on every flush (project/created, project/deleted, session/created, session/disposed, preview/dev-state). The walk resolves each session's owning project through the projection cache first (zero I/O, durable value), falling back to the live `sessionProjections` registry. The count is published as a new `sessionCounts: Readonly<Record<string, number>>` field on `AppBuilderSnapshot`.
- **Bug fix (incidental)**: the snapshot-bridge used to write its accessor via `ctx.appBuilderSnapshotBridge = {...}`, which throws under the current cordis reflection proxy. Replaced with `ctx.reflect.provide('appBuilderSnapshotBridge', {...})`.
- **Client**: `packages/client/ui-app-builder-projects` normalizes the new field with forward-compat (older hosts that don't publish it degrade to an empty map), renders a per-row badge using `Intl.PluralRules('en')` (1 → `sessionCountOne`, n>1 → `sessionCountOther`), and translates both arms in the en + zh dictionaries per the locale-owned client-ui-copy rule.

No new package is introduced: the consumer view is one JSON field on one existing snapshot, and the projection unit is the canonical owner of `session → project` resolution.

## Diffstat

11 files changed, 1033 insertions(+), 9 deletions(-). New files:

- `packages/app-builder/snapshot-bridge/tests/snapshot-session-counts.spec.ts` — 6 tests
- `packages/client/ui-app-builder-projects/tests/projects-list.client.spec.tsx` — 15 tests
- `packages/client/ui-app-builder-shell/tests/shell.client.spec.tsx` — 6 tests
- `.agents/notes/implemented/architecture/2026-09-04-phase-2-4-projection-ui.md` — EN-only Agent Note (no `*.zh.md`, no i18n sidecar re-record)

## Tests

```
packages/app-builder/snapshot-bridge/tests/snapshot-session-counts.spec.ts (6 tests) 142ms
packages/client/ui-app-builder-shell/tests/shell.client.spec.tsx (6 tests) 43ms
packages/client/ui-app-builder-projects/tests/projects-list.client.spec.tsx (15 tests) 72ms
Tests  27 passed (27)
```

Full `pnpm run typecheck` (host `tsc -b tsconfig.host.json` + tsdown + `tsc -b tsconfig.client.json`) PASSES; lefthook pre-push and pre-commit both green.

## Known pre-existing failures (carried in §9 of the Agent Note — not caused by this PR)

- `verify-md-links` — pre-existing
- `verify-doc-budgets` — `packages/AGENTS.md` 706 > 675 (pre-existing)
- `verify-translation-pairing` — 10 entries (9 pre-existing + `packages/app-builder/api/README.md` from 2.3)
- `verify-package-readme-model-experience` — 7 entries (pre-existing)
- `verify-export-jsdoc` — preview package (pre-existing)
- `verify-package-invariants` — peer-dep (pre-existing)
- 1 pre-existing test failure: `getTranscript returns a cold page through ctx.sessionController.page` in `packages/app-builder/api/tests/api-methods.host.spec.ts`
- 2 pre-existing test failures: `packages/app-builder/snapshot-bridge/tests/loader-composition-invariant.spec.ts` (test mounts the project plugin without `SessionProjectionRegistry`; 1.5.4 added `inject: ['sessionProjections']` but the test was never updated)
- 9 pre-existing oxlint errors on `snapshot-bridge/src/index.ts`, `projects/index.ts`, `Shell.tsx` (baseline verified byte-for-byte against HEAD `bfba258158`; new lint rules added since 2.3 catch pre-existing patterns)

## NEW carry-forward from this PR

- `verify-cordis-inspect-catalog` fails: `TypertAnalysisError: typert(client): packages/client/ui-approval/src/client/contract/slots.ts:71:3: public property is missing an explicit type annotation`. Latent bug in a file this PR does not touch; masked at HEAD because the script short-circuits when the cordis-client-runner catalog is up-to-date. 2.4 added 2 new client package references to `tsconfig.client.json` (`ui-app-builder-shell`, `ui-app-builder-projects`) to fix TS6307 on the new test files, which forces typert to re-evaluate the client face and trips the latent bug. The fix is a one-line annotation (`readonly kind: 'approval' = 'approval' as const`) in `ui-approval`; deferring per the AGENTS.md no-silent-unrelated-fix rule. Will land as a separate PR.

## Stack

Base: `feat/phase2-3-api-commission` (`bfba258158`)
Target: `feat/phase2-2-tool-policy`
Stack: 2.4 → 2.3 → 2.2 → 2.1 → master (native GitHub stacked PR).

## Out of scope

- The `ui-approval/contract/slots.ts:71` type annotation fix (separate PR + Agent Note).
- Updating `packages/app-builder/snapshot-bridge/tests/loader-composition-invariant.spec.ts` to include `SessionProjectionRegistry` (separate PR — affects snapshot-bridge test composition contract).

Full rationale and decision log: `.agents/notes/implemented/architecture/2026-09-04-phase-2-4-projection-ui.md`
