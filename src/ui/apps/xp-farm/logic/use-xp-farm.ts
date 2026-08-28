import type { CloudServerRow } from '../../../utils/cloud-list'
import { useCgdActions } from '../../../context/cgd-actions-context'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { useXpFarmStatus } from '../../../context/xp-farm-status-context'
import { fetchCloudList, sortByHostname } from '../../../utils/cloud-list'
import {
  readXpFarmHosts,
  writeXpFarmHosts,
  XP_FARM_DAEMON_HOST,
  XP_FARM_DAEMON_SCRIPT,
  XP_FARM_LOOP_DELAY,
} from '../../../utils/xp-farm-config'

/**
 * All XP Farm state and behavior. See `../index.ts`'s header comment for
 * the full design (why this app never calls `ns.grow`/`ns.weaken`/etc
 * itself, the daemon's self-managing lifecycle, why dedicated hosts are
 * excluded from the Programs app, ...).
 */
export function useXpFarm(React: any) {
  const ns = useQueuedNs()
  const callAction = useCgdActions()
  // Live, pushed straight from cgd.store the instant the daemon reports a
  // new cycle — no polling needed (see xp-farm-status-context.ts's header
  // comment for why this replaced a setInterval reading xp-farm-status.txt).
  const status = useXpFarmStatus()

  const [servers, setServers]: [CloudServerRow[], (v: CloudServerRow[]) => void] = React.useState([])
  const [enabled, setEnabled]: [Set<string>, (v: Set<string>) => void] = React.useState(() => new Set())
  const [daemonRunning, setDaemonRunning] = React.useState(false)
  const [daemonBusy, setDaemonBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [busyHost, setBusyHost]: [string | null, (v: string | null) => void] = React.useState(null)
  const [error, setError]: [string | null, (v: string | null) => void] = React.useState(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const [cloudList, hosts, running] = await Promise.all([
        fetchCloudList(callAction),
        readXpFarmHosts(ns),
        ns._isRunning(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST),
      ])
      setServers(sortByHostname(cloudList.servers))
      setEnabled(new Set(hosts))
      setDaemonRunning(running)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }

  // This component remounts every time the window is opened — fetch
  // everything fresh rather than trusting stale state. `status` isn't
  // fetched here — it comes live from `useXpFarmStatus()` above.
  React.useEffect(() => {
    void refresh()
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  // Whether the orchestrator process itself is alive isn't in cgd.store
  // (only what it reports once running is) — keep polling that one thing
  // while the window's open, same as before.
  const STATUS_POLL_MS = 3000
  React.useEffect(() => {
    const interval = setInterval(() => {
      ns._isRunning(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST).then(setDaemonRunning).catch(() => {})
    }, STATUS_POLL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  async function openLog() {
    await ns._ui._openTail(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST)
  }

  // Opens a specific dedicated host's own grow/weaken loop tail, from the
  // "Ng / Mw" thread counts in its card below — filename+host+args have to
  // match exactly what the daemon actually exec'd it with (target,
  // XP_FARM_LOOP_DELAY) for openTail to find the right process, which is
  // why those come from `xp-farm-config.ts` rather than being hardcoded
  // here too.
  async function openLoopLog(script: string, host: string, target: string) {
    await ns._ui._openTail(script, host, target, XP_FARM_LOOP_DELAY)
  }

  async function ensureDaemonRunning(): Promise<string | null> {
    const alreadyRunning = await ns._isRunning(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST)
    if (alreadyRunning)
      return null
    const pid = await ns._exec(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST, 1)
    if (pid === 0) {
      return `Couldn't launch ${XP_FARM_DAEMON_SCRIPT} — enough free RAM on ${XP_FARM_DAEMON_HOST}?`
    }
    // Not tracked via addChildPid on purpose — see `../index.ts`'s
    // header comment: the daemon is meant to outlive this window/
    // ui.app.js.
    setDaemonRunning(true)
    return null
  }

  // Manual override of the daemon's otherwise self-managing lifecycle
  // (see `../index.ts`'s header comment) — a single button whose label
  // flips between Spawn and Kill depending on whether the orchestrator is
  // currently running. Killing it here doesn't touch `xp-farm-config.txt`
  // or any dedicated host's own grow/weaken loops — it's purely stopping
  // the orchestrator; re-spawning it (or re-enabling any server) picks up
  // right where the config file says it should.
  async function toggleDaemon() {
    setError(null)
    setDaemonBusy(true)
    try {
      if (daemonRunning) {
        await ns._kill(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST)
        setDaemonRunning(false)
      }
      else {
        const launchError = await ensureDaemonRunning()
        if (launchError)
          setError(launchError)
      }
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setDaemonBusy(false)
    }
  }

  async function toggle(hostname: string) {
    setError(null)
    setBusyHost(hostname)
    try {
      const next = new Set(enabled)
      if (next.has(hostname)) {
        next.delete(hostname)
      }
      else {
        next.add(hostname)
      }
      await writeXpFarmHosts(ns, [...next])
      setEnabled(next)

      if (next.size > 0) {
        const launchError = await ensureDaemonRunning()
        if (launchError) {
          setError(launchError)
        }
      }
      // No manual re-fetch needed here anymore: `status` comes live
      // from cgd.store, so it updates on its own the moment the
      // daemon's next cycle reports the change.
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setBusyHost(null)
    }
  }

  return {
    servers,
    enabled,
    status,
    daemonRunning,
    daemonBusy,
    loading,
    busyHost,
    error,
    refresh,
    openLog,
    openLoopLog,
    toggleDaemon,
    toggle,
  }
}

/** Everything a rendering component under `../components/` needs. */
export type XpFarmState = ReturnType<typeof useXpFarm>
