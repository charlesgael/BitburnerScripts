import type { CloudServerRow } from '../../../utils/cloud-list'
import type { ManagedAppDefinition, Task } from './types'
import { useCgdActions } from '../../../context/cgd-actions-context'
import { useDaemonTier } from '../../../context/daemon-tier-context'
import { useHomeRam } from '../../../context/home-ram-context'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { checkIsAvailable } from '../../../utils/app-availability'
import { fetchCloudList } from '../../../utils/cloud-list'
import { spawnRemote } from '../../../utils/spawn-remote'
import { readXpFarmHosts } from '../../../utils/xp-farm-config'
import { resolveDependencyChain } from './dependency-chain'
import { taskKey } from './task-key'

// Plain JS timer, not `ns.sleep` — spacing out an auto-launched dependency
// chain (see `spawnTask` below) doesn't need `ns` at all, and routing it
// through `ns.sleep` would tie up the shared queue (see `ns-queue.ts`) for
// the full second, stalling every other queued ns.* call (another button's
// click, the main loop's own idle-tick work) until it resolves.
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * All state/behavior for one `createTaskManagerApp` instance. See
 * `../index.ts`'s header comment for the full design (why cloud servers
 * come from the shared `fetchCloudList` snapshot instead of polling RAM
 * per host, why `oneShot` apps are excluded from the running-task scan,
 * why spawned pids aren't tracked via `useAddChildPid`, etc).
 */
export function useTaskManager(React: any, apps: ManagedAppDefinition[], runnableApps: ManagedAppDefinition[]) {
  const ns = useQueuedNs()
  const homeRam = useHomeRam()
  const daemonTier = useDaemonTier()
  const callAction = useCgdActions()
  // Used to walk `requires` chains (see `./dependency-chain.ts`) — cheap
  // to rebuild each render, `apps` is a small fixed catalog.
  const appByScript = Object.fromEntries(apps.map(a => [a.script, a]))

  const [appRam, setAppRam] = React.useState(() => Object.fromEntries(apps.map(a => [a.script, 0])))
  const [cloudServers, setCloudServers]: [CloudServerRow[], (v: CloudServerRow[]) => void] = React.useState([])
  const [tasks, setTasks]: [Task[], (v: Task[] | ((prev: Task[]) => Task[])) => void] = React.useState([])
  // Which app's cloud-host popup menu is open, if any — at most one
  // at a time. Keyed by script.
  const [openMenuFor, setOpenMenuFor] = React.useState(null as string | null)
  const [spawnBusy, setSpawnBusy] = React.useState(() => new Set())
  // Keyed by taskKey() — a task's own (script, host) pair — since
  // several tasks for the same script can be busy independently.
  const [taskBusy, setTaskBusy] = React.useState(() => new Set())
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(null as string | null)
  // Fetched once alongside `appRam` below (see that effect) — an app's
  // `isAvailable` (see `logic/types.ts`) needs `ownedSF`/`currentNode`,
  // which only `ns.getResetInfo()` can supply; neither can change without
  // a reset that kills this script too, so no poller is needed.
  const [resetInfo, setResetInfo] = React.useState({ ownedSF: new Map() as Map<number, number>, currentNode: 0 })

  // Non-fatal on failure (e.g. no daemon registered, or it's at tier 0) —
  // this app just offers "home" as the only spawn target and can't find
  // any task running on a cloud server until a tier-1+ daemon is up.
  async function refreshCloudServers(): Promise<CloudServerRow[]> {
    try {
      const [result, xpFarmHosts] = await Promise.all([fetchCloudList(callAction), readXpFarmHosts(ns)])
      const dedicated = new Set(xpFarmHosts)
      const available = result.servers.filter(s => !dedicated.has(s.hostname))
      setCloudServers(available)
      return available
    }
    catch {
      setCloudServers([])
      return []
    }
  }

  // Scans each candidate host's process list once (`ns.ps`) rather than
  // calling `ns.isRunning(script, host, ...args)` per app — the latter
  // requires an exact args match, which breaks for an app like
  // `flooder.app.js` whose args (`buildArgs`, see `../logic/types.ts`)
  // change at spawn time and can't be predicted here. Matching by
  // filename alone, and capturing each match's real PID, is also what
  // lets `killTask`/`tailTask` below address the process directly
  // (`ns.kill(pid)`/`ns.ui.openTail(pid)`) instead of needing to guess
  // the args it was actually launched with.
  async function refreshTasks(cloud: CloudServerRow[]) {
    const candidateHosts = ['home', ...cloud.map(c => c.hostname)]
    const runnableScripts = new Set(runnableApps.map(a => a.script))
    const found: Task[] = []
    for (const host of candidateHosts) {
      const processes = await ns._ps(host)
      for (const p of processes) {
        if (runnableScripts.has(p.filename)) {
          found.push({ script: p.filename, host, pid: p.pid })
        }
      }
    }
    setTasks(found)
  }

  async function refreshAll() {
    const cloud = await refreshCloudServers()
    await refreshTasks(cloud)
  }

  // This component remounts every time the window is opened, so local
  // state can't be trusted to reflect reality — re-detect every
  // app's RAM cost and what's actually running (started from a
  // previous open, or from outside this UI entirely) instead of
  // assuming stale/default values.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true)
      const [ramEntries, info] = await Promise.all([
        Promise.all(apps.map(async a => [a.script, await ns._getScriptRam(a.script, 'home')] as const)),
        ns._getResetInfo(),
      ])
      if (cancelled)
        return
      setAppRam(Object.fromEntries(ramEntries))
      setResetInfo({ ownedSF: info.ownedSF, currentNode: info.currentNode })
      await refreshAll()
      if (!cancelled)
        setLoading(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  // Whether `app.isAvailable` (see `logic/types.ts`) passes for the
  // current player — `undefined` (no rule declared) always passes. Used
  // by `../components/task-manager-body.tsx` to leave an unavailable
  // entry out of the Spawn list entirely, same "hide, don't disable"
  // treatment `ui/utils/app-availability.ts`'s `isAppVisible` gives a
  // regular `AppDefinition`.
  function appAvailable(app: ManagedAppDefinition): boolean {
    return checkIsAvailable(app.isAvailable, { homeRam, daemonTier, ...resetInfo })
  }

  // A `requires` app (see `logic/types.ts`) no longer has to already be
  // running on a candidate host — `spawnTask` below auto-launches any
  // missing link in the chain first (see `./dependency-chain.ts`), so a
  // host only needs enough combined free RAM for that chain plus `app`
  // itself. `dependencyChainFor` exposes the same resolution for
  // `../components/spawn-row.tsx` to describe what a click will do.
  function dependencyChainFor(app: ManagedAppDefinition, host: string): ManagedAppDefinition[] | null {
    return resolveDependencyChain(app, host, appByScript, tasks)
  }

  // Hosts this app could spawn on right now: `home` plus every
  // non-reserved cloud server that isn't already running this specific
  // app and has enough free RAM for it *and* whatever missing `requires`
  // chain would need to be auto-launched alongside it there. A
  // `singleInstance` app (e.g. `flooder.app.js`) short-circuits to no
  // options at all, on any host, once it's running anywhere; a host whose
  // chain is unsatisfiable (`dependencyChainFor` returns `null` — see its
  // own comment) is excluded the same as one without enough RAM.
  function hostOptions(app: ManagedAppDefinition): { host: string, freeRam: number }[] {
    if (app.singleInstance && tasks.some(t => t.script === app.script))
      return []
    const ownRam = (appRam[app.script] ?? 0) * (app.threads ?? 1)
    const runningHosts = new Set(tasks.filter(t => t.script === app.script).map(t => t.host))
    const options: { host: string, freeRam: number }[] = []
    const consider = (host: string, freeRam: number) => {
      if (runningHosts.has(host))
        return
      const chain = dependencyChainFor(app, host)
      if (chain === null)
        return
      const chainRam = chain.reduce((sum, a) => sum + (appRam[a.script] ?? 0) * (a.threads ?? 1), 0)
      if (freeRam >= ownRam + chainRam)
        options.push({ host, freeRam })
    }
    consider('home', homeRam.max - homeRam.used)
    for (const cs of cloudServers) consider(cs.hostname, cs.maxRam - cs.ramUsed)
    return options
  }

  // Actually launches one app on `host` — `ns.exec` on `home`,
  // `spawnRemote` (which `ns.scp`'s the script over first) elsewhere —
  // and records it as a task unless it's `oneShot`. Split out of
  // `spawnTask` below so both a direct spawn and an auto-launched
  // dependency-chain step (also `spawnTask`) share the same launch logic
  // without duplicating it.
  async function launchOne(app: ManagedAppDefinition, host: string): Promise<void> {
    // `buildArgs` (see `../logic/types.ts`) is only consulted here, at
    // the moment of spawning — never for run-detection/kill/tail, which
    // are PID-based and don't need to know a task's args at all.
    const args = [...(app.args ?? []), ...(app.buildArgs ? await app.buildArgs(ns) : [])]
    let pid: number
    if (host === 'home') {
      pid = await ns._exec(app.script, 'home', app.threads ?? 1, ...args)
      if (pid === 0) {
        throw new Error(`Couldn't start ${app.script} on home — enough free RAM?`)
      }
    }
    else {
      const result = await spawnRemote(ns, app.script, host, app.threads ?? 1, args)
      if (!result.ok || !result.pid) {
        throw new Error(result.error ?? `Couldn't start ${app.script} on ${host}.`)
      }
      pid = result.pid
    }
    if (!app.oneShot) {
      setTasks((prev: Task[]) => [...prev, { script: app.script, host, pid }])
    }
  }

  // Spawns `app` on `host` — first auto-launching, one at a time and 1s
  // apart, whatever `requires` chain isn't already running there (see
  // `./dependency-chain.ts`; `hostOptions` above only ever offers `host`
  // once there's enough combined RAM for that whole chain plus `app`
  // itself). Each chain step gets marked busy under its own script too —
  // if that dependency has its own spawn row (e.g. Netmapper, while
  // Cracker's row triggers this), it visibly shows "..." while its turn
  // in the chain runs.
  async function spawnTask(app: ManagedAppDefinition, host: string) {
    setError(null)
    setSpawnBusy((prev: Set<string>) => new Set(prev).add(app.script))
    try {
      const chain = dependencyChainFor(app, host) ?? []
      for (const depApp of chain) {
        setSpawnBusy((prev: Set<string>) => new Set(prev).add(depApp.script))
        try {
          await launchOne(depApp, host)
        }
        finally {
          setSpawnBusy((prev: Set<string>) => {
            const next = new Set(prev)
            next.delete(depApp.script)
            return next
          })
        }
        await delay(1000)
      }
      await launchOne(app, host)
      await refreshCloudServers()
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setSpawnBusy((prev: Set<string>) => {
        const next = new Set(prev)
        next.delete(app.script)
        return next
      })
    }
  }

  async function killTask(task: Task) {
    const key = taskKey(task)
    setError(null)
    setTaskBusy((prev: Set<string>) => new Set(prev).add(key))
    try {
      await ns._kill(task.pid)
      setTasks((prev: Task[]) => prev.filter(t => taskKey(t) !== key))
      await refreshCloudServers()
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setTaskBusy((prev: Set<string>) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  async function tailTask(task: Task) {
    await ns._ui._openTail(task.pid)
  }

  const homePct = homeRam.max > 0 ? Math.min(100, (homeRam.used / homeRam.max) * 100) : 0

  return {
    homeRam,
    homePct,
    appRam,
    tasks,
    openMenuFor,
    setOpenMenuFor,
    spawnBusy,
    taskBusy,
    loading,
    error,
    hostOptions,
    dependencyChainFor,
    appAvailable,
    spawnTask,
    killTask,
    tailTask,
  }
}

/** Everything a rendering component under `../components/` needs. */
export type TaskManagerState = ReturnType<typeof useTaskManager>
