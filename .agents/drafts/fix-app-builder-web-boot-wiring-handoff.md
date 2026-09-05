# Fix App Builder Web Boot Wiring — Session Resume Handoff

> **Save-as-branch** by this same workflow so a fresh agent can resume from this
> exact point without conversation context. The handoff is the original task +
> the spot where the work stopped + a structured task list to drive the
> follow-up to completion.

## 0. TL;DR for the resuming agent

You are resuming the **"Land this PR now"** follow-up to PR #18
(`fix/bundle/web-app, bundle/app-builder: wire App Builder plugins into the
Web boot tree (4 wiring bugs)`).

**State at handoff:**
- Branch `fix/app-builder-web-boot-wiring` exists locally and on origin
- PR #18 is **open, mergeable=true** at https://github.com/ahmadmhmdsy/deepseek-harness-work/pull/18
- PR head: `dd6830c089b30547270e32add85af35239d139c1` (base: `adopt/api-gateway-cluster` @ `8994998859c2`)
- The 4 wiring fixes in PR #18 are **correct and load-bearing**, but they do
  NOT by themselves make the App Builder Web boot. **Bug 5** was discovered:
  the Cordis loader enforces **unique loader entry ids** across the composed
  tree (`vendor/loader/src/config/group.ts:64`), not last-write-wins. Declaring
  `app-builder-snapshot-bridge` in BOTH `web-app/cordis.patch.yml` and
  `app-builder/cordis.patch.yml` therefore throws `duplicate loader entry id`
  before either row applies.

**Your job:** Decide between Option A (merge PR #18 as-is, then immediately
file the structural-fix PR) and Option B (amend PR #18 to include the
structural fix). Then execute whichever you pick, run the boot on port 3081 to
verify, and report.

The user explicitly said "Land this PR now" — so **land it** unless the
structural fix is small enough to fold in without expanding scope.

## 1. Repo state at handoff time

| Key | Value |
|---|---|
| Date | 2026-09-05 |
| Repo | `ahmadmhmdsy/deepseek-harness-work` (working fork) |
| Upstream | `deepseek-ai/deepseek-harness` (read-only context) |
| Working branch | `fix/app-builder-web-boot-wiring` |
| Branch base | `adopt/api-gateway-cluster` @ `8994998859c2` (Phase 1.5.5) |
| Branch tip (local) | `dd6830c089b30547270e32add85af35239d139c1` |
| Branch tip (remote) | `dd6830c089b30547270e32add85af35239d139c1` ✓ in sync |
| Working tree | clean except gitignored `.tmp/` |
| Local master | `cc317420c3` (Phase 1.5 Upstream Sync to dsh-v0.1.2-alpha.1) |
| Origin/master | `66696e4aed` (PR #17 tip, 1103 commits behind local master) |
| PR #18 | open, mergeable, 2 commits, base=adopt/api-gateway-cluster |
| PR #18 labels | `kind/bugfix`, `area/bundle/web-app`, `area/bundle/app-builder` |
| PR #18 Issue Type | NOT set (repo-level `issueTypes` returns `null` even though schema includes `UpdateIssueIssueType`; REST endpoint shows Task/Bug/Feature but GraphQL enablement is missing at repo level) |
| Running server | alive on port 3080, PID `8132` (~700MB RSS); served by the harness installation at `D:\deepseek_harness\deepseek-harness` — DO NOT TOUCH |
| DSH_HOME | `C:\Users\Ahmad Mahmoud\.dsh` |
| Diagnostic profile | `app-builder-web` at `~/.dsh/profiles/` was created, used, then removed; clean state |
| Plan file | `.agents/plan-app-builder-web-boot-wiring.md` (9.5KB, retargeted plan + Phase 3 diagnosis, committed as part of PR #18) |
| `.env` token | `GITHUB_TOKEN_ahmadmhmdsy` (PAT for `ahmadmhmdsy`, id 35102575) — verified working |

## 2. What was delivered in this session

### 2.1 PR #18 — `fix/app-builder-web-boot-wiring` (2 commits)

| Commit | Files | Purpose |
|---|---|---|
| `8601969907` | `packages/bundle/web-app/cordis.patch.yml` (Bug 1, 2); `packages/bundle/app-builder/cordis.patch.yml` (Bug 3, 4); `.agents/plan-app-builder-web-boot-wiring.md` (new) | The 4 wiring fixes + plan |
| `dd6830c089` | `.agents/plan-app-builder-web-boot-wiring.md` (append) | Phase 3 follow-up diagnosis appended |

### 2.2 The 4 fixes (verified at the byte level)

**File 1: `packages/bundle/web-app/cordis.patch.yml`**
- Bug 1: Added `inject: [webServer, appBuilderProjects]` to the
  `app-builder-snapshot-bridge` row (after `name:`, line 153)
- Bug 2: Replaced `snapshotUrl: !!js '/__dsh/app-builder/snapshot.json'`
  with `snapshotUrl: '/__dsh/app-builder/snapshot.json'` (line 320)

**File 2: `packages/bundle/app-builder/cordis.patch.yml`**
- Bug 3: Added `inject: [webServer, appBuilderProjects]` to the
  `app-builder-snapshot-bridge` row (line 32)
- Bug 4: Added `config: { defaultProfile: app-builder }` to the
  `app-builder-project` row (lines 11-12)

### 2.3 Validation performed (all passed)

| Check | Result |
|---|---|
| `pnpm run verify-cordis-config` | ✓ 155 config files passed |
| lefthook pre-commit (whitespace, vendor-manifest-guard) | ✓ both passed |
| lefthook pre-push (`pnpm run typecheck` = `build:lib:host` + `tsc -b tsconfig.client.json`) | ✓ passed (~25-30s each push) |
| `git diff --cached --check` | ✓ no whitespace issues |
| Exactly-one trailing newline on each YAML | ✓ |
| `git push --force-with-lease=<branch>:<observed-oid>` | ✓ succeeded twice (initial push + after docs commit) |
| `verify-cordis-config` after edits | ✓ 155 config files passed |
| Spell-check of row state via Node script reading symlinked `packages/bundle/{web-app,app-builder}` from `~/.dsh/profiles/app-builder-web/node_modules/@deepseek-ai/` | ✓ all 4 fixes reachable via the symlink |

### 2.4 Phase 3 re-test result — THE BUG 5 FINDING

Attempted boot via `pnpm dsh --profile app-builder-web` (a profile I created
linking the modified bundles) failed at compose time:

```
Error: dsh: plugin tree failed to load:
  failed to apply loader entry include (cordis:include):
  duplicate loader entry id: app-builder-snapshot-bridge
TypeError: duplicate loader entry id: app-builder-snapshot-bridge
    at EntryGroup.update (vendor/loader/src/config/group.ts:64:31)
```

**The Cordis loader enforces unique loader entry ids across the composed tree
— NOT last-write-wins.** The plan's assumption was wrong. The 4 wiring fixes
are still correct and load-bearing (each row's `inject` / `config` /
no-`!!js` form is required once the row survives composition), but the
`app-builder-snapshot-bridge` row appearing in BOTH `web-app/cordis.patch.yml`
AND `app-builder/cordis.patch.yml` is itself the failure mode.

### 2.5 Profile creation recipe (re-use for Phase 3 of follow-up)

The diagnostic profile was at `~/.dsh/profiles/app-builder-web/` with:
- `package.json` declaring `dsh.profile.bundles: [@deepseek-ai/dsh-base,
  @deepseek-ai/dsh-web-app, @deepseek-ai/dsh-app-builder]` and `dependencies`
  with `link:` spec to the userFork bundles (`D:\my_deepseek_harness\deepseek-harness\packages\bundle\{web-app,app-builder}`)
- `cordis.yml` containing `[]` (empty entry list — bundles + cordis.patch.yml
  compose the tree)
- `cordis.patch.yml` containing `[]` (empty overlay)
- Profile `node_modules/@deepseek-ai/{dsh-web-app,dsh-app-builder}` were
  symlinks resolving to the userFork bundle directories

Boot command:
```
set DSH_HOME=C:\Users\Ahmad Mahmoud\.dsh
cd D:\my_deepseek_harness\deepseek-harness
pnpm dsh --profile app-builder-web -- --port 3081 --no-open --trusted-host 127.0.0.1
```

The symlinks mean editing the patch.yml in userFork is immediately picked up
on the next boot — no `pnpm install` needed between iterations.

## 3. What is still open

### 3.1 The duplicate-id bug (Bug 5) — the only real blocker

**Choose ONE bundle as the home for `app-builder-snapshot-bridge` and remove
it from the other, OR provide it as an out-of-tree dependency that the other
bundle's consumers declare.**

Suggested resolution (lowest blast radius):

1. Keep `app-builder-snapshot-bridge` row in
   `packages/bundle/app-builder/cordis.patch.yml` (the bundle that owns the
   App Builder Host BFF cluster — Phase 1.5.5 `adopt/api-gateway-cluster`).
2. Remove the duplicate `app-builder-snapshot-bridge` row from
   `packages/bundle/web-app/cordis.patch.yml`.
3. Verify `web-app`'s consumers of `webServer` / `appBuilderProjects` are
   satisfied by the app-builder bundle's instance.

After this, the `inject: [webServer, appBuilderProjects]` and `config:`
fixes in the remaining row will apply correctly, the loader will accept the
single-row composition, and the boot will succeed.

### 3.2 Phase 3 re-test on port 3081 (still pending a successful boot)

Once Bug 5 is fixed, re-run:
```
pnpm dsh --profile app-builder-web -- --port 3081 --no-open --trusted-host 127.0.0.1
```

Expected success path:
- `pnpm typecheck` passes (will run as lefthook pre-push)
- Boot reaches "URL: http://..." line
- HTTP probes return 200:
  - `GET /` → HTML title contains App Builder chrome
  - `GET /__dsh/app-builder/snapshot.json` → JSON
  - `GET /plugins/@deepseek-ai/dsh-client-ui-app-builder-{shell,projects,deployments,preview-iframe}/client.js`
  - `window.__DSH_BOOT__.entries` includes all 4 App Builder Client plugins

### 3.3 Other carry-forward failures (UNCHANGED from PROJECT-MEMORY §4)

- Children-table gating in `ui-layout` (runtime-dead shells) — separate PR
- Typert-emitter structural fix (Phase 2.5 Option A) — separate PR
- `getTranscript` test fixture realignment — separate PR
- `ui-approval` missing `readonly kind` — separate PR

## 4. Files / artifacts to know about

| Path | Purpose |
|---|---|
| `D:\my_deepseek_harness\deepseek-harness` | userFork root (the one to work in) |
| `D:\deepseek_harness\deepseek-harness` | harness installation that runs you (PID 28112 → 8132, port 3080) — DO NOT TOUCH |
| `C:\Users\Ahmad Mahmoud\.dsh` | `DSH_HOME` (profiles, sessions, settings) |
| `C:\Users\Ahmad Mahmoud\.dsh\profiles\{headless,web,node_modules}` | the existing profiles — DO NOT delete |
| `packages/bundle/web-app/cordis.patch.yml` | PR #18 modified file 1/2 |
| `packages/bundle/app-builder/cordis.patch.yml` | PR #18 modified file 2/2 |
| `.agents/plan-app-builder-web-boot-wiring.md` | PR #18's retargeted plan + Phase 3 diagnosis |
| `.agents/drafts/phase2-5-handoff.md` | existing handoff convention reference (different phase) |
| `vendor/loader/src/config/group.ts:64` | the `duplicate loader entry id` throw — read this to confirm Bug 5 |
| `.env` at userFork root | contains `GITHUB_TOKEN_ahmadmhmdsy` (PAT, auths as `ahmadmhmdsy` id 35102575) |

## 5. Tools / commands available

- Only `run_code` is available in this session (the harness hides `ask_user_question`, `edit`, `read`, `write`, `pwsh`, `web_search`, `todo_write`, `exit_plan_mode` etc.). All work goes through `run_code` using `node:fs`, `node:child_process`, `node:http` directly.
- This means: file ops = `fs.readFileSync` / `fs.writeFileSync` / text-replace-via-read-write. No `read` / `edit` / `write` tool wrappers.
- Spawn on Windows: `node:child_process.spawn` with `.cmd` files requires `shell: true`. `spawn('cmd.exe', ['/d', '/s', '/c', 'pnpm dsh ...'])` is the reliable shape. Pipes `stdout`/`stderr` to a WriteStream for a per-iteration log; the harness may reap detached children, so prefer synchronous spawn-with-await.
- `git push --force-with-lease=<branch>:<observed-oid>` is the AGENTS.md-mandated push form. When the remote branch is new (no prior OID), use `--force-with-lease=<branch>:0000000000000000000000000000000000000000` or skip the `--force-with-lease` flag entirely — both reduce to a plain push.
- `pnpm run typecheck` runs the full `build:lib:host` (~17s build) + `tsc -b tsconfig.client.json` (~10s) — total ~30s. Lefthook's pre-push hook invokes this.
- `pnpm run verify-cordis-config` is the lightweight validator that confirms YAML structure is valid Cordis config (~1s, lightweight).
- lefthook pre-commit: whitespace check (always), vendor-manifest-guard, archived-agent-notes, translation-pairing (only on matching globs), lint (only on .ts/.tsx).
- lefthook pre-push: `pnpm run typecheck` (always).
- GitHub API via `curl` + the `.env` PAT (`GITHUB_TOKEN_ahmadmhmdsy`). `POST /repos/{owner}/{repo}/pulls` to create; `POST /repos/{owner}/{repo}/issues/{n}/labels` to apply labels.

## 6. Plan: Tasks to drive "Land this PR now" to completion

Numbered task list. Each task = one cohesive piece of work. The first three are
mandatory; tasks 4-5 are the two scope paths (A vs B); tasks 6-9 are the
post-fix verification.

### Task 1 — Confirm starting state (no fresh context)

1. `cd D:\my_deepseek_harness\deepseek-harness`
2. `git status -s` — expect: only `.tmp/` untracked, no modifications
3. `git branch --show-current` — expect: `fix/app-builder-web-boot-wiring`
4. `git log --oneline -3` — expect: top commit `dd6830c089`
5. `git ls-remote origin fix/app-builder-web-boot-wiring` — expect:
   `dd6830c089b30547270e32add85af35239d139c1 refs/heads/fix/app-builder-web-boot-wiring`
6. `curl -s -H "Authorization: Bearer $(grep ^GITHUB_TOKEN_ahmadmhmdsy .env | cut -d= -f2)" https://api.github.com/repos/ahmadmhmdsy/deepseek-harness-work/pulls/18`
   — expect: state=open, mergeable=true, head.sha=`dd6830c0`, base.ref=`adopt/api-gateway-cluster`
7. `netstat -ano | findstr :3080` — expect: server PID 8132 LISTENING on port 3080
8. **Do NOT touch** the server or anything in `D:\deepseek_harness\deepseek-harness`

If any of these checks fail, STOP and diagnose — something changed since
handoff.

### Task 2 — Read the key files fresh

1. `.agents/plan-app-builder-web-boot-wiring.md` — the retargeted plan with
   the 4 fixes and the Bug 5 diagnosis
2. `packages/bundle/web-app/cordis.patch.yml` lines 146-160 (Bug 1 context)
   and lines 313-322 (Bug 2 context)
3. `packages/bundle/app-builder/cordis.patch.yml` lines 8-15 (Bug 4 context)
   and lines 28-33 (Bug 3 context)
4. `vendor/loader/src/config/group.ts` line 60-66 — the `duplicate loader
   entry id` rule
5. `packages/app-builder/snapshot-bridge/src/index.ts` lines 140-150 — the
   plugin's own `inject = ['webServer', 'appBuilderProjects'] as const`

### Task 3 — Decide scope: Option A (merge now + follow-up) vs Option B (amend in place)

Read the user's literal request: **"Land this PR now"**. The PR was already
opened and is mergeable. The user did NOT say "amend the structural fix in".

→ **Default: Option A — land PR #18 as-is, then file a follow-up PR for
Bug 5 immediately after.**

Reconsider to Option B only if ALL of these are true:
- The structural fix is < 5 lines
- It does not change the public API of either bundle
- It does not introduce a new resolver dependency
- Combining it into PR #18 keeps the diff focused on "make App Builder Web boot"

If any of those fail → stay with Option A.

### Task 4 — Option A path: merge PR #18, then file follow-up

#### Task 4.1 — Merge PR #18

This is a fork → fork PR; the user has final say. **Do NOT auto-merge.**
Instead:

1. Confirm with the user that the PR is ready to merge (one short message,
   not a question that blocks).
2. If the user says go: `gh pr merge 18 --squash --repo ahmadmhmdsy/deepseek-harness-work`
   — but `gh` CLI is not available in this session per AGENTS.md, so fall back
   to `curl` PUT `/repos/{owner}/{repo}/pulls/{n}/merge` with `{"merge_method":"squash"}`.
3. Wait for the squash merge to complete (returns 200 with merged: true).
4. `git fetch origin adopt/api-gateway-cluster` and verify the merge landed.
5. **After merging, also merge the PR to local master if the user wants it on
   local master — but per the original plan, local master is BEHIND origin
   master by 1103 commits; merging to local master is a separate sync that
   the user must trigger.** Just merge to the PR's base.

#### Task 4.2 — Create follow-up branch

```bash
git checkout adopt/api-gateway-cluster
git pull origin adopt/api-gateway-cluster
git checkout -b fix/app-builder-snapshot-bridge-de-dup
```

#### Task 4.3 — Apply the Bug 5 fix

**Recommended resolution** (keep the row in the bundle that owns the App
Builder BFF cluster — `app-builder` — remove it from `web-app`):

1. Open `packages/bundle/web-app/cordis.patch.yml`
2. Find the `app-builder-snapshot-bridge` row (line 151 in PR #18; may shift
   after this PR merges)
3. Delete the entire row (id + name + inject) plus its leading 5-line comment
   block:
   ```yaml
   # App Builder host-side state projector: subscribes to project/created
   # and app-builder-preview/dev-state, atomically writes the snapshot
   # file, and serves GET /__dsh/app-builder/snapshot.json on ctx.webServer.
   # Mounted before the client plugins so the snapshot endpoint is live
   # by the time the projects pane starts polling.
   - id: app-builder-snapshot-bridge
     name: '@deepseek-ai/dsh-app-builder-snapshot-bridge'
     inject: [webServer, appBuilderProjects]
   ```
4. Also delete the blank line separator before the comment block (so the
   `─ browser plugin roster ─` heading sits flush against the previous row)

Leave `packages/bundle/app-builder/cordis.patch.yml` alone — the row lives
there in PR #18, and the loader will accept a single declaration.

#### Task 4.4 — Pre-push checks

```bash
pnpm run verify-cordis-config     # must pass
git diff                           # visual review
git diff --cached --check          # no whitespace
```

The full `pnpm run typecheck` will run as the lefthook pre-push hook.

#### Task 4.5 — Commit and push

Commit message:
```
fix(bundle/web-app): remove duplicate app-builder-snapshot-bridge row

The Cordis loader enforces unique loader entry ids across the composed tree
(vendor/loader/src/config/group.ts:64); declaring the same id in both
dsh-web-app and dsh-app-builder patches throws duplicate loader entry id.

PR #18 wired the snapshot-bridge into both bundles for last-write-wins
safety, but that model is wrong for this loader. The row needs to live in
exactly ONE bundle. This commit removes the duplicate from web-app; the
row remains in app-builder (the bundle that owns the App Builder Host BFF
cluster), and its consumers in web-app read the same instance.

Ref: vendor/loader/src/config/group.ts:64
Ref: PR #18 follow-up diagnosis in .agents/plan-app-builder-web-boot-wiring.md

Labels: kind/bugfix, area/bundle/web-app
```

Push: `git push --force-with-lease=fix/app-builder-snapshot-bridge-de-dup:<observed-oid> origin fix/app-builder-snapshot-bridge-de-dup`

#### Task 4.6 — Open the follow-up PR

```bash
curl -s -X POST -H "Authorization: Bearer \$(grep ^GITHUB_TOKEN_ahmadmhmdsy .env | cut -d= -f2)" \
  -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" \
  -d @followup-pr-payload.json https://api.github.com/repos/ahmadmhmdsy/deepseek-harness-work/pulls
```

with payload:
- head: `fix/app-builder-snapshot-bridge-de-dup`
- base: `adopt/api-gateway-cluster` (NOT master; this is a Phase 1.5.x line PR)
- title: `fix(bundle/web-app): remove duplicate app-builder-snapshot-bridge row`
- body: explain the duplicate-id finding, link to PR #18, link to
  `vendor/loader/src/config/group.ts:64`, link to
  `.agents/plan-app-builder-web-boot-wiring.md` diagnosis section.

Apply labels `kind/bugfix` + `area/bundle/web-app` (already created in PR #18).

#### Task 4.7 — Re-test on port 3081

Re-create the profile (deleted in the previous session):

```bash
mkdir -p ~/.dsh/profiles/app-builder-web
```

Write `~/.dsh/profiles/app-builder-web/package.json`:
```json
{
  "name": "dsh-profile-app-builder-web",
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh-web-app": "link:D:\\my_deepseek_harness\\deepseek-harness\\packages\\bundle\\web-app",
    "@deepseek-ai/dsh-app-builder": "link:D:\\my_deepseek_harness\\deepseek-harness\\packages\\bundle\\app-builder"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@deepseek-ai/dsh-app-builder"
      ]
    }
  }
}
```

Write `~/.dsh/profiles/app-builder-web/cordis.yml`:
```yaml
[]
```

Write `~/.dsh/profiles/app-builder-web/cordis.patch.yml`:
```yaml
[]
```

```bash
cd ~/.dsh/profiles/app-builder-web
pnpm install --prefer-offline
```

Boot:
```bash
cd D:\\my_deepseek_harness\\deepseek-harness
set DSH_HOME=C:\\Users\\Ahmad Mahmoud\\.dsh
pnpm dsh --profile app-builder-web -- --port 3081 --no-open --trusted-host 127.0.0.1
```

Expected: boot reaches "URL: http://127.0.0.1:3081" line within 20-30s, exits 0
on Ctrl-C. `tail` the boot log to confirm.

If it fails with a DIFFERENT error (e.g. session-projection missing, children-
table gating, etc.) — STOP, diagnose, and ask the user. Do NOT iterate beyond 3
attempts without escalating.

If it boots: HTTP probe (Node script):
```javascript
const http = require('node:http');
function get(path) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:3081' + path, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}
(async () => {
  console.log('GET /:', (await get('/')).status);
  console.log('GET /__dsh/app-builder/snapshot.json:', (await get('/__dsh/app-builder/snapshot.json')).status);
  for (const p of ['shell','projects','deployments','preview-iframe']) {
    console.log(\`GET /plugins/@deepseek-ai/dsh-client-ui-app-builder-\${p}/client.js:\`, (await get(\`/plugins/@deepseek-ai/dsh-client-ui-app-builder-\${p}/client.js\`)).status);
  }
})();
```

Stop the server when done (kill via tasklist + taskkill, NOT via Ctrl-C in
the spawned cmd).

#### Task 4.8 — Cleanup + final report

1. Remove `~/.dsh/profiles/app-builder-web` (rmdir /S /Q)
2. Confirm running server (PID 8132) still alive
3. Confirm working tree clean except `.tmp/`
4. Write a final report to the user with:
   - PR #18 merge URL
   - Follow-up PR URL
   - Boot log evidence (the URL line from `pnpm dsh --profile app-builder-web`)
   - HTTP probe results (status codes for the 6 endpoints)
   - What's STILL broken (children-table gating, etc.) and the recommended next PR
   - State summary table (branch / tip / mergeable / labels / server PID)

### Task 5 — Option B path: amend PR #18 in place

Only pursue if Task 3's criteria all hold. This is the SMALLER path but it
means PR #18 grows by ~7 lines (the removal of the `web-app` row + its
5-line comment block).

#### Task 5.1 — Reset to PR #18 base

```bash
git checkout fix/app-builder-web-boot-wiring
git reset --hard dd6830c089
```

#### Task 5.2 — Apply the removal

On top of the reset, apply the same removal as Task 4.3:
- Delete the `app-builder-snapshot-bridge` row + its leading 5-line comment
  block + the blank-line separator from
  `packages/bundle/web-app/cordis.patch.yml`

#### Task 5.3 — Commit

```
fix(bundle/web-app): remove duplicate app-builder-snapshot-bridge row

(same body as Task 4.5)

Combined with PR #18's earlier wiring fixes, this completes the boot path
for App Builder Web on the dsh-base + dsh-web-app + dsh-app-builder
composition. The snapshot-bridge row now lives in exactly one bundle
(app-builder), and the loader's unique-id rule is satisfied.
```

#### Task 5.4 — Force-push

```bash
git push --force-with-lease=fix/app-builder-web-boot-wiring:dd6830c089b30547270e32add85af35239d139c1 origin fix/app-builder-web-boot-wiring
```

(The lease OID is the OLD tip, before this amend — the lease fires if anyone
else pushed in the meantime.)

#### Task 5.5 — Verify PR #18

```bash
curl -s https://api.github.com/repos/ahmadmhmdsy/deepseek-harness-work/pulls/18
```

Expect: 3 commits, mergeable=true, head.sha points at the new commit.

#### Task 5.6 — Re-test on port 3081

Same as Task 4.7.

#### Task 5.7 — Cleanup + final report

Same as Task 4.8, but no separate follow-up PR to mention.

### Task 6 — Phase 3 success criteria

The "Land this PR now" task is complete when:

- [ ] PR #18 is **merged** (Option A) OR PR #18 is **amended and the new
  commit passes CI** (Option B)
- [ ] Option A only: follow-up PR is open, base `adopt/api-gateway-cluster`,
  labeled `kind/bugfix` + `area/bundle/web-app`
- [ ] `pnpm dsh --profile app-builder-web -- --port 3081 --no-open --trusted-host 127.0.0.1` boots to the URL line within 30s without throwing
- [ ] HTTP probe returns 200 for `GET /__dsh/app-builder/snapshot.json`
- [ ] HTTP probe returns 200 for all 4 App Builder Client plugin URLs
- [ ] Source tree clean except `.tmp/` (gitignored)
- [ ] Diagnostic profile `~/.dsh/profiles/app-builder-web/` removed
- [ ] Running server (PID 8132) on port 3080 still serving

### Task 7 — Stop conditions (escalate to user)

Stop and ask the user if ANY of these happen:

1. The boot fails after 3 iterations with a new error (e.g. session-projection
   missing, children-table gating fires, ui-layout children table still
   excludes `app-builder-shell`, etc.)
2. The duplicate-id fix introduces a different loader error (the row in
   `app-builder/cordis.patch.yml` alone is insufficient — perhaps `web-app`
   needs `webServer` first, but the single row expects both `webServer` and
   `appBuilderProjects` from a different bundle, etc.)
3. `pnpm run typecheck` fails on the amend/commit with an error in
   `packages/bundle/web-app/cordis.patch.yml` parsing (rare; YAML is
   forgiving)
4. The user asks something that contradicts the "land now" framing
   (e.g. "actually scrap it, take a different approach")

### Task 8 — If PR #18 needs to be reverted (escape hatch)

```bash
gh pr close 18 --delete-branch --repo ahmadmhmdsy/deepseek-harness-work
# Or via curl:
curl -s -X PATCH -H "Authorization: Bearer \$TOKEN" \
  -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" \
  -d '{"state":"closed"}' \
  https://api.github.com/repos/ahmadmhmdsy/deepseek-harness-work/pulls/18
```

Local cleanup: `git checkout adopt/api-gateway-cluster && git branch -D fix/app-builder-web-boot-wiring`

### Task 9 — Reporting template

Use this exact structure for the final report to the user:

```
## Summary

- PR #18: <URL> <merged|amended|open>
- Follow-up PR: <URL> <open|n/a>
- Local branch tip: <sha>

## Phase 3 re-test result

- Boot: <pass|fail with error excerpt>
- `GET /__dsh/app-builder/snapshot.json`: <status>
- App Builder Client plugin URLs: <status codes>
- `window.__DSH_BOOT__.entries`: <list or "skipped — boot failed">

## What's still broken

- <carry-forward failures from PROJECT-MEMORY §4 that apply>
- <new blockers encountered during this session>

## Recommended next PR

- <what to file next>

## State

- Branch: fix/app-builder-web-boot-wiring <tip>
- Working tree: <clean|modified>
- Server PID 8132 on port 3080: <alive|dead>
- `~/.dsh/profiles/app-builder-web`: <present|removed>
```

## 7. One-paragraph state recap

PR #18 is open, mergeable, contains the 4 wiring fixes (each individually
verified at the byte level, all lefthook hooks passed, typecheck passed),
but the App Builder Web does not boot because the Cordis loader rejects
duplicate loader entry ids across the composed tree (Bug 5). The user
asked to "land this PR now" — so the right move is merge PR #18 (the
wiring groundwork stands on its own), then immediately follow up with the
duplicate-row removal. The follow-up is small (delete ~7 lines), low risk,
and unblocks the boot. Plan tasks 1-9 above walk through the whole sequence.

## 8. Resumption command

When a fresh agent session begins and reads this handoff, the first 5 lines
of code to execute are:

```bash
cd D:\\my_deepseek_harness\\deepseek-harness
git status -s                                  # expect only .tmp/
git log --oneline -3                           # expect dd6830c089 on top
git ls-remote origin fix/app-builder-web-boot-wiring   # expect dd6830c089b30547270e32add85af35239d139c1
netstat -ano | findstr :3080                   # expect PID 8132 LISTENING
cat .agents/drafts/fix-app-builder-web-boot-wiring-handoff.md   # you're reading it
```

Then read `.agents/plan-app-builder-web-boot-wiring.md` §"Final outcome" for
the full Phase 3 diagnosis, and start Task 3 (decide Option A vs B).
