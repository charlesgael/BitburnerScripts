import type { CloudServerRow } from '../../../utils/cloud-list'
import type { XpFarmStatus } from '../../../utils/xp-farm-config'
import { useCgdActions } from '../../../context/cgd-actions-context'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { fetchCloudList, sortByHostname } from '../../../utils/cloud-list'
import {
  readXpFarmHosts,
  writeXpFarmHosts,
  XP_FARM_DAEMON_HOST,
  XP_FARM_DAEMON_SCRIPT,
  XP_FARM_GROW_SCRIPT,
  XP_FARM_LOOP_DELAY,
  XP_FARM_WEAKEN_SCRIPT,
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

  const [servers, setServers]: [CloudServerRow[], (v: CloudServerRow[]) => void] = React.useState([])
  const [enabled, setEnabled]: [Set<string>, (v: Set<string>) => void] = React.useState(() => new Set())
  // What each dedicated host's grow/weaken loops are actually doing right
  // now — read straight off `ns.ps(host)` (see fetchStatus below) rather
  // than trusted from a value the daemon last pushed into cgd.store. The
  // old store-push channel (every 15s, and only on the daemon's own cycle
  // boundary) wasn't reactive enough — a toggle could sit unreflected for a
  // full cycle, and it sometimes never resolved into a render at all. Tier
  // 1 already allow-lists `ps` (see `daemons/lv1.daemon.ts`), so this needs
  // nothing beyond what XP Farm's own `minDaemonTier: 2` already requires.
  const [status, setStatus]: [XpFarmStatus, (v: XpFarmStatus) => void] = React.useState({})
  const [daemonRunning, setDaemonRunning] = React.useState(false)
  const [daemonBusy, setDaemonBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [busyHost, setBusyHost]: [string | null, (v: string | null) => void] = React.useState(null)
  const [error, setError]: [string | null, (v: string | null) => void] = React.useState(null)

  // Reads the grow/weaken processes actually running on each `hosts` entry
  // and derives an assignment from them — `ns.ps` reports real threads/args
  // for whatever's genuinely running, so a host with no matching process
  // yet (still starting) is simply omitted, same as the old "undefined ⇒
  // starting…" case the components already handle.
  async function fetchStatus(hosts: string[]): Promise<XpFarmStatus> {
    const lists = await Promise.all(hosts.map(host => ns._ps(host)))
    const next: XpFarmStatus = {}
    lists.forEach((processes, i) => {
      const host = hosts[i]
      const pGrow = processes.find(p => p.filename === XP_FARM_GROW_SCRIPT)
      const pWeaken = processes.find(p => p.filename === XP_FARM_WEAKEN_SCRIPT)
      const target = (pGrow?.args[0] ?? pWeaken?.args[0]) as string | undefined
      if (target === undefined)
        return
      next[host] = {
        target,
        growThreads: pGrow?.threads ?? 0,
        weakenThreads: pWeaken?.threads ?? 0,
      }
    })
    return next
  }

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
      setStatus(await fetchStatus(hosts))
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }

  // This component remounts every time the window is opened — fetch
  // everything fresh rather than trusting stale state.
  React.useEffect(() => {
    void refresh()
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  // Neither "is the orchestrator process itself alive" nor "what are its
  // managed hosts actually running" survive in any pushed store value
  // anymore (see fetchStatus above) — poll both directly while the window's
  // open. Re-subscribes whenever the enabled set changes (toggling a host
  // on/off) so a freshly-enabled host starts getting polled immediately
  // rather than waiting for some earlier-scheduled tick.
  const STATUS_POLL_MS = 3000
  React.useEffect(() => {
    const hosts = [...enabled] as string[]
    const interval = setInterval(() => {
      ns._isRunning(XP_FARM_DAEMON_SCRIPT, XP_FARM_DAEMON_HOST).then(setDaemonRunning).catch(() => {})
      if (hosts.length > 0)
        fetchStatus(hosts).then(setStatus).catch(() => {})
    }, STATUS_POLL_MS)
    return () => clearInterval(interval)
    // eslint-disable-next-line react/exhaustive-deps
  }, [enabled])

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
      const wasEnabled = next.has(hostname)
      if (wasEnabled) {
        next.delete(hostname)
        // Instant feedback: this host's own grow/weaken loops may take a
        // moment to actually die (see the daemon's release handling), but
        // it's no longer this app's to report on — drop it from the
        // displayed status right away rather than waiting for the next
        // poll tick to notice the process is gone.
        const { [hostname]: _dropped, ...rest } = status
        setStatus(rest)
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
      // No manual status re-fetch needed for the newly-enabled case: the
      // poll effect above re-subscribes the instant `enabled` changes, and
      // its next tick will pick up the daemon's freshly-launched processes
      // (shown as "starting…" by the components below until then).
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
