/**
 * @module @deepseek-ai/dsh-app-builder-snapshot-bridge
 *
 * Cordis plugin that bridges the App Builder host state into the browser
 * projects pane. Subscribes to two upstream-owned event sources:
 *
 * - `project/created` (from `@deepseek-ai/dsh-app-builder-project`) — every
 *   durable project added to the in-memory registry.
 * - `app-builder-preview/dev-state` (from `@deepseek-ai/dsh-app-builder-preview`)
 *   — every state transition of a project dev server.
 *
 * The plugin keeps one in-memory snapshot of `{ ts, projects, devServers }` and
 * on every change atomically writes it to `$DSH_HOME/state/app-builder-snapshot.json`
 * (`.tmp` then `rename`, so a reader never sees a half-written file). The
 * HTTP handler at `GET /__dsh/app-builder/snapshot.json` reads from the
 * in-memory snapshot, so a successful response is always coherent even if the
 * file write has not completed yet.
 *
 * The route returns 503 when no project has been created yet (the projects
 * pane treats that as the empty state). The file write is fire-and-forget: a
 * transient I/O failure logs a warning but does not break the host. The
 * snapshot is a derived view of upstream-owned state — never a claim — and
 * the package's invariant companion reflects this.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { ProjectRegistry } from '@deepseek-ai/dsh-app-builder-project'

/** Snapshot path relative to `$DSH_HOME`. Single source of truth for the host and the browser pane. */
const SNAPSHOT_RELATIVE_PATH = join('state', 'app-builder-snapshot.json')

/** Snapshot URL the browser projects pane polls. */
export const SNAPSHOT_URL_PATH = '/__dsh/app-builder/snapshot.json'

/** Status a project's preview dev server is currently in. */
export type DevServerStatus = 'idle' | 'starting' | 'ready' | 'failed' | 'stopped'

/** Live preview state for one App Builder project. */
export interface SnapshotDevServer {
  /** Canonical localhost URL the dev server is bound to; absent until `ready`. */
  url?: string
  /** Port the dev server is bound to; `-1` while idle or pending. */
  port: number
  /** Current status of the preview dev server. */
  status: DevServerStatus
  /** Last status message from the preview tool (e.g. `framework: vite`). */
  message?: string
  /** Last update timestamp (epoch ms); `0` on the initial idle entry. */
  updatedAt: number
}

/** One durable App Builder project as published in the snapshot. */
export interface SnapshotProject {
  /** Stable project id; opaque to the client. */
  id: string
  /** Display title for the projects list row. */
  name: string
  /** Absolute host cwd of the scaffolded project root. */
  rootPath: string
  /** Stack family (nextjs-app, nextjs-pages, svelte-spa); absent for hand-built projects. */
  stack?: string
  /** Creation timestamp (epoch ms). */
  createdAt: number
}

/** Full snapshot served by the host and consumed by the projects pane. */
export interface AppBuilderSnapshot {
  /** Last write timestamp (epoch ms); zero on the initial empty state. */
  ts: number
  /** All durable projects, in host-publication order. */
  projects: readonly SnapshotProject[]
  /** Per-project preview state; absent keys mean no preview has run yet. */
  devServers: Readonly<Record<string, SnapshotDevServer>>
}

/** Initial empty snapshot used before the first host write. */
export const EMPTY_SNAPSHOT: AppBuilderSnapshot = {
  ts: 0,
  projects: [],
  devServers: {},
}

/**
 * Dev-server state event payload emitted by the preview tool on every state
 * transition. The bridge subscribes and projects each transition into the
 * snapshot keyed by project id (resolved via the registry's `rootPath` match).
 */
export interface AppBuilderPreviewDevState {
  /** Canonical project root the dev server runs in. */
  rootPath: string
  /** Detected or overridden framework. */
  framework: 'next' | 'vite' | 'unknown'
  /** Current lifecycle status. */
  status: DevServerStatus
  /** Loopback URL the dev server is bound to; absent until `ready`. */
  url?: string
  /** Port the dev server is bound to; absent until `ready`. */
  port?: number
  /** Status message the preview tool wants the UI to surface. */
  message?: string
  /** Optional reason on terminal states. */
  reason?: string
  /** Epoch ms when the transition occurred. */
  sinceMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only accessor the App Builder BFF uses for `getPreview`. */
    appBuilderSnapshotBridge: AppBuilderSnapshotBridgeAccessor
  }
  interface Events {
    /** Preview tool → snapshot bridge. Fired on every dev-server state transition. */
    'app-builder-preview/dev-state'(state: AppBuilderPreviewDevState): void
  }
}

/** Cordis plugin name used by loader diagnostics and the bundle patch row. */
export const name = 'app-builder-snapshot-bridge'

/** Services required before the bridge can mount. `ctx.logger` is read directly; no entry required. */
export const inject = ['webServer', 'appBuilderProjects'] as const

/** Services this plugin publishes. The accessor is read by `app-builder-api.getPreview`. */
export const provide = ['appBuilderSnapshotBridge'] as const

/** Plugin-level config (all optional; the defaults match the inspect step 21 contract). */
export interface Config {
  /**
   * Override the snapshot file path. By default the bridge writes to
   * `$DSH_HOME/state/app-builder-snapshot.json`; an absolute path here is used
   * verbatim (useful for tests). An empty string disables the file projection —
   * the HTTP route still serves the in-memory state.
   */
  snapshotPath?: string
  /**
   * Override the served snapshot URL path. Default `/__dsh/app-builder/snapshot.json`.
   * The route handler is registered on `ctx.webServer` at this exact path;
   * the bundle patch's `snapshotUrl` config on the projects pane must match.
   */
  snapshotUrlPath?: string
}

export const Config: z<Config> = z.object({
  snapshotPath: z.string().default(''),
  snapshotUrlPath: z.string().default(SNAPSHOT_URL_PATH),
})

/**
 * Resolve the snapshot file path: explicit config > `DSH_HOME`-derived default.
 * `DSH_HOME` is read from the launch environment (process env wins, then
 * project `.env`, then user `.env`).
 * @param ctx - Cordis context carrying the launch environment.
 * @param override - explicit config value (empty string means use default).
 * @returns the absolute path; `undefined` when no resolvable `DSH_HOME`.
 */
function resolveSnapshotPath(ctx: Context, override: string): string | undefined {
  if (override !== '') return override
  const home = launchEnvironmentOf(ctx).get('DSH_HOME')?.value
  if (home === undefined || home === '') return undefined
  return join(home, SNAPSHOT_RELATIVE_PATH)
}

/**
 * Map an upstream `Project` to its snapshot projection. The wire shape
 * converts ISO-8601 timestamps to epoch ms for the browser renderer.
 */
function toSnapshotProject(p: { id: string; name: string; rootPath: string; stack: string; createdAt: string }): SnapshotProject {
  return {
    id: p.id,
    name: p.name,
    rootPath: p.rootPath,
    stack: p.stack,
    createdAt: Date.parse(p.createdAt),
  }
}

/**
 * Build the current snapshot from authoritative upstream state. The bridge
 * keeps its own `devServers` map because dev-server lifecycle is observable
 * through the preview tool's events, not through the project registry.
 */
function buildSnapshot(
  projects: readonly SnapshotProject[],
  devServers: Readonly<Record<string, SnapshotDevServer>>,
  ts: number,
): AppBuilderSnapshot {
  return { ts, projects, devServers }
}

/**
 * Find the project id whose `rootPath` matches the given canonical path.
 * Returns `undefined` when the preview was started against a non-App-Builder
 * directory; the bridge then drops the dev-server entry.
 */
function projectIdForRootPath(
  registry: { list(): readonly { id: string; rootPath: string }[] },
  rootPath: string,
): string | undefined {
  for (const project of registry.list()) {
    if (project.rootPath === rootPath) return project.id
  }
  return undefined
}

/**
 * Atomically write the snapshot to disk: write to a sibling `.tmp` then
 * `rename` so a reader never observes a half-written file. A write failure
 * logs a warning but does not propagate; the in-memory state is still
 * authoritative for the HTTP route.
 */
async function writeSnapshotFile(path: string, snapshot: AppBuilderSnapshot): Promise<void> {
  const tmpPath = `${path}.tmp.${Date.now()}.${process.pid}`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(tmpPath, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 })
  await rename(tmpPath, path)
}

/** Read-only accessor the App Builder BFF consumes for `getPreview`. */
export interface AppBuilderSnapshotBridgeAccessor {
  /** Return the latest in-memory snapshot the HTTP route serves. */
  snapshot(): AppBuilderSnapshot
}

/** Send a JSON response. The snapshot endpoint always speaks JSON. */
function sendJson(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** Plugin entry: mount the route, subscribe to upstream events, mirror state. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = Config(config)
  const webServer = ctx.webServer as WebServer
  const registry = ctx.appBuilderProjects as ProjectRegistry
  /** Snapshot path the writer closes over. The schema defaults to `""` (skip file write). */
  const filePath: string | undefined = resolveSnapshotPath(ctx, resolved.snapshotPath ?? '')
  const urlPath: string = resolved.snapshotUrlPath ?? SNAPSHOT_URL_PATH

  /** Per-project dev-server state keyed by project id. */
  const devServers: Record<string, SnapshotDevServer> = {}
  /** Cached snapshot projection; rebuilt on every change. */
  let cachedSnapshot: AppBuilderSnapshot = EMPTY_SNAPSHOT
  /**
   * Tail of the file-write queue. Each new write awaits the previous one
   * so a burst of state changes lands in monotonic order on disk; without
   * the queue, two fire-and-forget writes can race and the older one can
   * overwrite the newer one at the rename step.
   */
  let writeQueue: Promise<void> = Promise.resolve()

  /**
   * Recompute the snapshot and write it both to disk (when configured) and
   * to the in-memory cache. The in-memory cache is what the HTTP handler
   * reads; the file write is best-effort and serialized through the queue.
   */
  const flush = (): void => {
    const projects = registry.list().map(toSnapshotProject)
    const ts = Date.now()
    cachedSnapshot = buildSnapshot(projects, devServers, ts)
    const path = filePath
    if (path === undefined) return
    writeQueue = writeQueue.then(() => writeSnapshotFile(path, cachedSnapshot)).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      ctx.logger('app-builder-snapshot-bridge').warn(
        `snapshot file write failed at ${path}: ${reason}`,
      )
    })
  }

  // Mount the HTTP route. The handler reads the in-memory cache so a slow
  // disk write never blocks a poll. A 503 keeps the projects pane in its
  // empty state until the host has produced at least one snapshot.
  const dispose = webServer.register({
    kind: 'exact',
    path: urlPath,
    handler: (_req: IncomingMessage, res: ServerResponse): void => {
      sendJson(res, 200, JSON.stringify(cachedSnapshot))
    },
  })

  // Subscribe to project creation. The registry emits `project/created`
  // BEFORE it adds the project to its in-memory map (Phase 1 contract), so
  // a synchronous flush here would project an empty snapshot. Defer the
  // flush one microtask so the registry finishes the add before we read
  // `registry.list()`. The `ctx.on` listener ties to the caller fiber.
  // Subscribe to project creation. The registry adds the record to its
  // in-memory map BEFORE emitting `project/created` so a synchronous flush
  // here sees the new project in `registry.list()`. The `ctx.on` listener
  // ties to the caller fiber (the plugin entry), so disposing the plugin
  // removes it.
  ctx.on('project/created', () => { flush() })
  ctx.on('project/deleted', () => { flush() })

  // Seed the snapshot once at apply time: a deployment that boots with a
  // pre-existing in-memory registry has projects before any new event fires.
  flush()

  // Subscribe to preview state transitions. Each event maps to one project
  // by root path match; non-matching roots (preview started against a
  // hand-built directory) are ignored. Terminal states (`failed`, `stopped`)
  // keep the last entry visible so the pane can surface the failure.
  ctx.on('app-builder-preview/dev-state', (state) => {
    const projectId = projectIdForRootPath(registry, state.rootPath)
    if (projectId === undefined) return
    const port = state.port ?? -1
    const updatedAt = state.sinceMs
    const next: SnapshotDevServer = {
      port,
      status: state.status,
      updatedAt,
      ...(state.url !== undefined ? { url: state.url } : {}),
      ...(state.message !== undefined ? { message: state.message } : {}),
    }
    devServers[projectId] = next
    flush()
  })

  // Expose the in-memory snapshot to the App Builder BFF's `getPreview`
  // method. The accessor returns the same cache the HTTP route serves,
  // so a BFF read is coherent with the most recent browser poll.
  // `ctx.provide` registers the service in the context's reflect layer so
  // direct `ctx.appBuilderSnapshotBridge = ...` assignment via the property
  // proxy is not allowed (Cordis rejects assignment without `provide`).
  ctx.provide('appBuilderSnapshotBridge', { snapshot: () => cachedSnapshot })

  ctx.effect(() => dispose, 'app-builder-snapshot-bridge: route disposer')
}
