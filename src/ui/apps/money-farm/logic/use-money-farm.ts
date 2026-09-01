import type { CloudServerRow } from '../../../utils/cloud-list'
import type { MoneyFarmStatus } from '../../../utils/money-farm-config'
import React from '@react'
import { useCgdActions } from '../../../context/cgd-actions-context'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { fetchCloudList, sortByHostname } from '../../../utils/cloud-list'
import {
  MONEY_FARM_DAEMON_HOST,
  MONEY_FARM_DAEMON_SCRIPT,
  MONEY_FARM_GROW_SCRIPT,
  MONEY_FARM_HACK_SCRIPT,
  MONEY_FARM_WEAKEN_SCRIPT,
  readMoneyFarmHosts,
  writeMoneyFarmHosts,
} from '../../../utils/money-farm-config'

/**
 * All Money Farm state and behavior — mirrors `use-xp-farm.ts`'s own shape
 * (see its header comment for the parts that are identical: why this app
 * never calls `ns.hack`/`ns.grow`/`ns.weaken`/`ns.getServer` itself, the
 * daemon's self-managing lifecycle, mutual exclusion with other dedicated
 * hosts via `../../../components/server-card.tsx`'s own "Occupied" state).
 *
 * Status derivation differs from XP Farm's: a farming host runs many
 * short-lived one-shot batch-leg processes (see
 * `daemons/money-farm.daemon.ts`'s header comment) rather than two stable
 * continuous loops, so there's no meaningful per-thread count to poll —
 * `fetchStatus` below only distinguishes *mode* (weaken / grow-prep /
 * farm) from whether any currently-running process carries the `--once`
 * flag (a batch leg) or not (a continuous prep loop), not thread counts.
 */
export function useMoneyFarm() {
  const ns = useQueuedNs()
  const callAction = useCgdActions()

  const [servers, setServers] = React.useState<CloudServerRow[]>([])
  const [enabled, setEnabled] = React.useState<Set<string>>(() => new Set())
  const [status, setStatus] = React.useState<MoneyFarmStatus>({})
  const [loading, setLoading] = React.useState(true)
  const [busyHost, setBusyHost] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function fetchStatus(hosts: string[]): Promise<MoneyFarmStatus> {
    const lists = await Promise.all(hosts.map(host => ns._ps(host)))
    const next: MoneyFarmStatus = {}
    lists.forEach((processes, i) => {
      const host = hosts[i]
      const relevant = processes.filter(p =>
        p.filename === MONEY_FARM_HACK_SCRIPT
        || p.filename === MONEY_FARM_GROW_SCRIPT
        || p.filename === MONEY_FARM_WEAKEN_SCRIPT)
      if (relevant.length === 0)
        return

      // Batch legs are always dispatched as `['--once', target, delay]`
      // (flag before positionals — see `utils/args.ts`'s own convention);
      // continuous prep loops are `[target, delay]`, no flag.
      const batchLegs = relevant.filter(p => p.args[0] === '--once')
      if (batchLegs.length > 0) {
        const target = batchLegs[0].args[1] as string
        next[host] = { target, mode: 'farm' }
        return
      }

      const continuous = relevant.filter(p => p.args[0] !== '--once')
      const target = continuous[0]?.args[0] as string | undefined
      if (target === undefined)
        return
      const hasGrow = continuous.some(p => p.filename === MONEY_FARM_GROW_SCRIPT)
      next[host] = { target, mode: hasGrow ? 'grow-prep' : 'weaken' }
    })
    return next
  }

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const [cloudList, hosts] = await Promise.all([
        fetchCloudList(callAction),
        readMoneyFarmHosts(ns),
      ])
      setServers(sortByHostname(cloudList.servers))

      // Self-heal: an augmentation install wipes every purchased server,
      // but money-farm-config.txt survives untouched — same reasoning as
      // `use-xp-farm.ts`'s identical block.
      const existing = new Set(cloudList.servers.map(s => s.hostname))
      const validHosts = hosts.filter(h => existing.has(h))
      if (validHosts.length !== hosts.length)
        await writeMoneyFarmHosts(ns, validHosts)

      setEnabled(new Set(validHosts))
      setStatus(await fetchStatus(validHosts))
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
    const hosts = [...enabled] as string[]
    const iFetchStatus = setInterval(() => {
      if (hosts.length > 0)
        fetchStatus(hosts).then(setStatus).catch(() => {})
    }, STATUS_POLL_MS)
    return () => clearInterval(iFetchStatus)
  }, [enabled])

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
      await writeMoneyFarmHosts(ns, [...next])
      setEnabled(next)
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
    loading,
    busyHost,
    error,
    refresh,
    toggle,
  }
}

/** Everything a rendering component under `../components/` needs. */
export type MoneyFarmState = ReturnType<typeof useMoneyFarm>
