# Agent Note: App Builder profiles and config live outside $DSH_HOME

Status: implemented

[English](2026-09-05-app-builder-dsh-home-isolation.md) | 中文

## Problem

DeepSeek Harness owns one user home: `$DSH_HOME` (default `~/.dsh`) holds every shipped CLI's profiles, sessions, anonymous-user id, skills catalog, and credential file. An App Builder deployment that lives inside that same tree collides with the running harness on three fronts:

1. **Profile namespace** — every `dsh --profile <name>` resolves the profile under `$DSH_HOME/profiles`. A profile added by the App Builder would appear in `dsh plugin`, `dsh --dump-config`, and the Web settings surface that the running harness already serves.
2. **Credentials file** — `@deepseek-ai/dsh-credentials-local` reads `$DSH_HOME/.credentials.yaml`. The running harness owns that file; the App Builder would either write into it (silently overwriting the running harness's keys) or refuse to start without it.
3. **Session / projection / storage roots** — the shipped base anchors `session-persistence-jsonl.root`, `storage-json.root`, and the projection cache at `dshHomePath('sessions'|'storages')`. An App Builder session would land in the running harness's session tree and show up in its history surfaces.

## Decision

App Builder work uses a separate harness home, parallel to the running DSH home, and points `$DSH_HOME` at it for the App Builder's own CLI invocations:

- **App Builder home** (default): `~/.appbuilder` (configurable via the `DSH_HOME` env var at launch; the convention is to pick a home whose name matches the product, e.g. `~/.appbuilder`).
- **Profile dir**: `$DSH_HOME/profiles/app-builder-web/` (resolves to `~/.appbuilder/profiles/app-builder-web/` by default), linking the three workspace bundles the App Builder needs: `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`, `@deepseek-ai/dsh-app-builder`.
- **Credentials and config**: `$DSH_HOME/.env` for environment variables (auto-loaded by `loadLayeredEnv` as the user-env layer) and `$DSH_HOME/credentials/` for any future credential files, named parallel to the running DSH tree but in App Builder's home.
- **Launch form** (the canonical command): set `$DSH_HOME` before invoking `dsh`. The running DSH home stays at the default `~/.dsh`; App Builder invocations set `$DSH_HOME` to the App Builder home explicitly. Nothing inside `~/.dsh` is touched.

The rule that keeps this stable: **agents working on App Builder code must not edit any file under `~/.dsh/`**. The App Builder home is read-only-friendly with respect to `~/.dsh` (a key the App Builder needs can be copied into `$DSH_HOME/.env` from `~/.dsh/.credentials.yaml` if the user already has it there), but every write, override, and new file lives in the App Builder home.

## Alternatives considered

- **Reuse the running DSH home and namespace the profile as `app-builder-web`.** Rejected: `dsh plugin` and the Web settings surface see every profile under `$DSH_HOME/profiles`; a new profile shows up in the running harness's UI without an explicit opt-in, and the credential resolution would have to choose between the running harness's keys and the App Builder's. Namespacing the *file* name does not namespace the *home*.
- **Add an opt-in isolation flag to `dsh --profile` (e.g. `--isolated-home`).** Rejected: makes the CLI aware of a per-product home that the `$DSH_HOME` env var already supports natively; the env var is the existing API, the flag would duplicate it. A future CLI surface may grow one if per-launch home selection becomes common, but the env var is the documented primitive today.
- **Hard-code the App Builder home at `~/.appbuilder`.** Rejected in principle: the convention is the `$DSH_HOME` resolution contract (`@deepseek-ai/dsh-home-paths`), and a hard-coded path would fork from it. The default home is `~/.appbuilder` for *this* product, the resolution mechanism is the same.

## Consequences

- App Builder profiles, sessions, credentials, and any future App Builder-owned files live under the App Builder's `$DSH_HOME`. The running DSH home is read-only for App Builder work; the running DSH is never restarted, edited, or rewritten by App Builder invocations.
- The App Builder shares the same source-launch form as the running DSH: `node --import tsx/esm apps/cli/src/bin.ts --profile <name> -- ...`, with `$DSH_HOME` set to the App Builder home. The harness CLI is product-agnostic, so the same command line serves both surfaces.
- The App Builder's `cordis.patch.yml` overlays still apply (the profile's `cordis.yml` and any `--patch` overlays); only the home and credential roots are isolated. The plugin graph and the loader's per-row uniqueness rules are unchanged.
- A profile added by the App Builder does not appear in the running DSH's `dsh plugin` output or Web settings surface, because the running DSH resolves `$DSH_HOME` from its own ambient environment and that points at `~/.dsh`, not `~/.appbuilder`.
- Two homes means two anonymous-user ids, two skill catalogs, two credential stores. That is the trade-off: isolation buys product separation; it costs "where is my key" — the App Builder home is the answer for App Builder questions, the DSH home for DSH questions.
- Verification: the App Builder CLI reads `$DSH_HOME/.env` via `loadLayeredEnv` (the user-env layer, applied after `process.env` and before any project `.env`); an env var set in `~/.appbuilder/.env` reaches the App Builder runtime without further reference. The running DSH's `~/.dsh/.credentials.yaml` is not read by App Builder invocations.
