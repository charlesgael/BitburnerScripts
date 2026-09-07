import type { HwgwStatusResult, HwgwTargetStatus } from '../../../../lib/hwgw/workers'
import type { CloudServerRow } from '../../../utils/cloud-list'
import React from '@react'
import { useCgdActions } from '../../../context/cgd-actions-context'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { fetchCloudList, sortByHostname } from '../../../utils/cloud-list'
import { readHwgwHosts, writeHwgwHosts } from '../../../utils/hwgw-config'
import { readXpFarmHosts } from '../../../utils/xp-farm-config'

/** host -> every hwgw target currently running a worker there (see `lib/hwgw/workers.ts`'s `HwgwStatusResult.byHost`). */
export type HwgwHostStatus = Record<string, HwgwTargetStatus[]>

/**
 * target -> its status, straight from `HwgwStatusResult.byTarget` — kept
 * separate from `status` (below) rather than derived from it. `status` is
 * built by walking `byHost`, so a target whose orchestrator is alive but
 * hasn't landed a single worker on a *scanned* host yet — still in
 * `prep`/`null`, or its own `waitForHost` loop still waiting on free RAM,
 * both common with many concurrent instances competing for the same host
 * pool — has no entry there at all and would silently vanish from any view
 * built only off `status`. `targets` is the full picture: every target
 * `scanHwgwOrchestrators` found on `home`, regardless of worker state.
 */
export type HwgwTargetsStatus = Record<string, HwgwTargetStatus>

/**
 * All Money Farm state and behavior — kept at this path/id (see `../index.ts`'s
 * header comment for why), now driving hwgw (`src/hwgw/`) instead of the
 * deleted `daemons/money-farm.daemon.ts`. Mirrors `use-xp-farm.ts`'s own
 * shape for the parts that are identical: why this app never calls
 * `ns.hack`/`ns.grow`/`ns.weaken`/`ns.getServer` itself, mutual exclusion
 * with other dedicated hosts via `../../../components/server-card.tsx`.
 *
 * Status derivation differs from XP Farm's in one real way: a host here
 * can carry *more than one* target's workers at once — hwgw shares one
 * host pool across every running `hwgw/start.js` instance rather than
 * dedicating a whole host per target (see `lib/hwgw/workers.ts`'s own
 * header comment) — so `status` is host -> an *array* of target statuses,
 * not a single assignment. The scan itself (`ns.ps` + `ns.getRunningScript`
 * across every dedicated host, plus every `hwgw/start.js` on `home` for
 * mode) can't be done from this app's own RAM-conscious code directly —
 * it goes through the `hwgwStatus` compound action (`cgd/actions/hwgw.ts`,
 * tier 2) instead, same as `fetchCloudList`.
 *
 * `enabled` (this file's host list) is *not* an exclusive claim the way
 * money-farm's was: it just controls what `auto-hack.app.js` is told to
 * treat as its worker pool on its *next* restart (see `hwgw-config.ts`'s
 * own header comment) — an already-running target keeps whatever hosts it
 * was launched with regardless of a later toggle here. So, unlike
 * money-farm's version, toggling isn't gated on `ramUsed === 0`: a host
 * already running some other target's hwgw workers is still a perfectly
 * valid pool member, since hwgw was never exclusive about host use in the
 * first place.
 */
export function useMoneyFarm() {
  const ns = useQueuedNs()
  const callAction = useCgdActions()

  const [servers, setServers] = React.useState<CloudServerRow[]>([])
  const [enabled, setEnabled] = React.useState<Set<string>>(() => new Set())
  const [status, setStatus] = React.useState<HwgwHostStatus>({})
  const [targets, setTargets] = React.useState<HwgwTargetsStatus>({})
  const [loading, setLoading] = React.useState(true)
  const [busyHost, setBusyHost] = React.useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function fetchStatus(hosts: string[]): Promise<{ byHost: HwgwHostStatus, byTarget: HwgwTargetsStatus }> {
    if (hosts.length === 0)
      return { byHost: {}, byTarget: {} }
    const result = await callAction('hwgwStatus', [hosts]) as HwgwStatusResult
    const byHost: HwgwHostStatus = {}
    for (const [host, hostTargets] of Object.entries(result.byHost)) {
      byHost[host] = hostTargets
        .map(t => result.byTarget[t])
        .filter((t): t is HwgwTargetStatus => t !== undefined)
    }
    return { byHost, byTarget: result.byTarget }
  }

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const [cloudList, hosts, xpFarmHosts] = await Promise.all([
        fetchCloudList(callAction),
        readHwgwHosts(ns),
        readXpFarmHosts(ns),
      ])
      const eligible = sortByHostname(
        cloudList.servers
          .filter(serv => !xpFarmHosts.includes(serv.hostname)),
      )
      setServers(eligible)

      // Self-heal: an augmentation install wipes every purchased server,
      // but hwgw-hosts.json survives untouched — same reasoning as
      // `use-xp-farm.ts`'s identical block.
      const existing = new Set(cloudList.servers.map(s => s.hostname))
      const validHosts = hosts.filter(h => existing.has(h))
      if (validHosts.length !== hosts.length)
        await writeHwgwHosts(ns, validHosts)

      setEnabled(new Set(validHosts))
      // Nothing toggled on yet doesn't mean nothing to scan — hwgw can be
      // (and by default is — see `money-farm-dashboard.tsx`'s InstanceManager
      // args) launched against the whole eligible fleet without ever
      // writing a single host into hwgw-hosts.json. Fall back to scanning
      // every eligible host rather than showing nothing just because the
      // toggles were never touched.
      const result = await fetchStatus(validHosts.length > 0 ? validHosts : eligible.map(s => s.hostname))
      setStatus(result.byHost)
      setTargets(result.byTarget)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    const interval = setInterval(() => {
      void refresh()
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [])

  const STATUS_POLL_MS = 3000
  React.useEffect(() => {
    // Same fallback as `refresh()` above — see its own comment.
    const hosts = enabled.size > 0 ? [...enabled] : servers.map(s => s.hostname)
    const iFetchStatus = setInterval(() => {
      if (hosts.length > 0) {
        fetchStatus(hosts).then((result) => {
          setStatus(result.byHost)
          setTargets(result.byTarget)
        }).catch(() => {})
      }
    }, STATUS_POLL_MS)
    return () => clearInterval(iFetchStatus)
  }, [enabled, servers])

  async function toggle(hostname: string) {
    setError(null)
    setBusyHost(hostname)
    try {
      const next = new Set(enabled)
      const wasEnabled = next.has(hostname)
      if (wasEnabled) {
        next.delete(hostname)
        const { [hostname]: _dropped, ...rest } = status
        setStatus(rest)
      }
      else {
        next.add(hostname)
      }
      await writeHwgwHosts(ns, [...next])
      setEnabled(next)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setBusyHost(null)
    }
  }

  // No `ramUsed === 0` gate here — see this file's own header comment for
  // why hwgw's shared host pool makes that check meaningless (a host
  // already running another target's workers is still a valid pool
  // member). `selectAll`/`selectNone` operate on every server offered at
  // all (already excludes XP-Farm-dedicated hosts via `refresh()` above).
  const selectableServers = servers

  async function selectAll() {
    if (selectableServers.length === 0)
      return
    setError(null)
    setBulkBusy(true)
    try {
      const next = new Set(selectableServers.map(s => s.hostname))
      await writeHwgwHosts(ns, [...next])
      setEnabled(next)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setBulkBusy(false)
    }
  }

  async function selectNone() {
    if (enabled.size === 0)
      return
    setError(null)
    setBulkBusy(true)
    try {
      await writeHwgwHosts(ns, [])
      setEnabled(new Set())
      setStatus({})
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setBulkBusy(false)
    }
  }

  // Distinct from a plain "every selectable host is enabled" check: this
  // is also true when there's nothing selectable at all — either way,
  // clicking "Select All" would be a no-op, so the button should read
  // disabled rather than silently doing nothing. See `use-xp-farm.ts`'s
  // identical `allSelected` for the same reasoning.
  const allSelected = selectableServers.length === 0 || selectableServers.every(s => enabled.has(s.hostname))
  const noneSelected = enabled.size === 0

  return {
    servers,
    enabled,
    status,
    targets,
    loading,
    busyHost,
    bulkBusy,
    error,
    refresh,
    toggle,
    selectAll,
    selectNone,
    allSelected,
    noneSelected,
  }
}

/** Everything a rendering component under `../components/` needs. */
export type MoneyFarmState = ReturnType<typeof useMoneyFarm>
