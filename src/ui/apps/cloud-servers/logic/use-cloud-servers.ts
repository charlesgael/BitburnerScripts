import type { CloudListResult, CloudServerRow } from '../../../utils/cloud-list'
import type { SlaveNodeHost } from '../../../utils/slave-nodes'
import type { ActionResult } from './types'
import React from '@react'
import { useCgdActions } from '../../../context/cgd-actions-context'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { fetchCloudList, sortByHostname } from '../../../utils/cloud-list'
import { pickCloudServerName } from '../../../utils/cloud-names'
import { fetchSlaveNodeHosts, readSlaveNodes, writeSlaveNodes } from '../../../utils/slave-nodes'

/**
 * All Cloud Servers state and behavior. See `../index.ts`'s header comment
 * for why this app never references `ns.cloud.*`/`ns.getServerMoneyAvailable`
 * itself and instead goes through `cgd.daemon.queue.enqueueAction` (see
 * `cgd/actions/cloud.ts`/`cgd/actions/slave-nodes.ts`) — no RAM-preflight
 * checks needed here anymore either, unlike the pre-epic version: an action
 * call doesn't launch a new script, so there's no per-call RAM allocation
 * that could fail.
 */
export function useCloudServers() {
  const ns = useQueuedNs()
  const callAction = useCgdActions()

  const [servers, setServers] = React.useState<CloudServerRow[]>([])
  const [moneyAvailable, setMoneyAvailable] = React.useState(0)
  const [serverLimit, setServerLimit] = React.useState(0)
  const [costByRam, setCostByRam] = React.useState<Record<number, number>>({})
  const [listLoading, setListLoading] = React.useState(true)
  const [listError, setListError] = React.useState<string | null>(null)

  const [buyHostname, setBuyHostname] = React.useState('')
  const [buyRam, setBuyRam] = React.useState(2)
  const [buyBusy, setBuyBusy] = React.useState(false)
  const [buyError, setBuyError] = React.useState<string | null>(null)

  const [confirmDeleteHost, setConfirmDeleteHost] = React.useState<string | null>(null)
  const [deleteBusyHost, setDeleteBusyHost] = React.useState<string | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  // --- Slave nodes (see `ui/utils/slave-nodes.ts`) ---
  // `slaveHosts` is every rooted/non-purchased/non-home host on the
  // network — the full checklist, independent of which are currently
  // designated (that's cross-referenced against `slaveServers` below).
  const [slaveHosts, setSlaveHosts] = React.useState<SlaveNodeHost[]>([])
  const [slaveHostsLoading, setSlaveHostsLoading] = React.useState(true)
  const [slaveHostsError, setSlaveHostsError] = React.useState<string | null>(null)
  const [toggleSlaveBusyHost, setToggleSlaveBusyHost] = React.useState<string | null>(null)
  const [toggleSlaveError, setToggleSlaveError] = React.useState<string | null>(null)

  const busy = listLoading || buyBusy || deleteBusyHost != null
  // Purchased servers vs. slave nodes are the same `servers` snapshot
  // (see `cgd/actions/cloud.ts`'s header comment on why they're merged)
  // split back out here purely for display/limit purposes — the
  // server-count/limit shown to the player, and `atServerLimit` below,
  // only ever refer to actual purchases.
  const cloudServers = servers.filter(s => !s.isSlave)
  const slaveServers = servers.filter(s => s.isSlave)

  async function refreshList() {
    setListLoading(true)
    setListError(null)
    try {
      const result: CloudListResult = await fetchCloudList(callAction)
      setServers(sortByHostname(result.servers))
      setMoneyAvailable(result.moneyAvailable)
      setServerLimit(result.serverLimit)
      setCostByRam(result.costByRam)
      // Default the RAM picker to the cheapest tier the player can
      // currently afford, if nothing sensible (or no longer
      // affordable) is selected.
      const tiers = Object.keys(result.costByRam)
        .map(Number)
        .sort((a, b) => a - b)
      const affordableTiers = tiers.filter(t => result.costByRam[t] <= result.moneyAvailable)
      if (tiers.length > 0 && (!tiers.includes(buyRam) || result.costByRam[buyRam] > result.moneyAvailable)) {
        setBuyRam(affordableTiers.length > 0 ? affordableTiers[0] : tiers[0])
      }
    }
    catch (err) {
      setListError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setListLoading(false)
    }
  }

  // Refreshes the full slave-node checklist: every rooted, non-purchased,
  // non-`home` host found by walking the whole network (see
  // `cgd/actions/slave-nodes.ts` — a separate tier-2 action from
  // `refreshList`'s tier-1 `cloudList` since the latter has no reason to
  // reference `ns.scan`/`ns.getServer` at all).
  async function refreshSlaveHosts() {
    setSlaveHostsLoading(true)
    setSlaveHostsError(null)
    try {
      setSlaveHosts(sortByHostname(await fetchSlaveNodeHosts(callAction)))
    }
    catch (err) {
      setSlaveHostsError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setSlaveHostsLoading(false)
    }
  }

  // Refreshes both the purchased/slave server list and the full slave-node
  // checklist together — what the header's Refresh button, and the
  // initial mount below, actually trigger. A network re-scan is the
  // expensive-ish half of this (walks every host), so `toggleSlave` below
  // deliberately skips it and only re-runs `refreshList` — toggling a
  // designation never changes which hosts are *eligible*, only which are
  // checked, and that's already re-derived from `refreshList`'s own
  // result.
  async function refreshAll() {
    await Promise.all([refreshList(), refreshSlaveHosts()])
  }

  // This component remounts every time the window is opened — fetch
  // everything fresh rather than trusting stale state. No daemon-RAM
  // preflight fetch needed anymore (the pre-epic version checked
  // `ns.getScriptRam` for each of the three one-shot daemon scripts
  // before launching them) — actions run inside the already-running
  // persistent daemon, so there's no new script launch, and therefore no
  // new RAM allocation, to check for on any given call.
  React.useEffect(() => {
    void refreshAll()
    // eslint-disable-next-line react/exhaustive-deps
  }, [])

  async function handleBuy() {
    // Leaving the field blank isn't an error — fall back to a random
    // themed name (see `ui/utils/cloud-names.ts`) rather than forcing
    // the player to come up with one.
    const hostname = buyHostname.trim() || pickCloudServerName(servers.map(s => s.hostname))
    setBuyError(null)
    setBuyBusy(true)
    try {
      const result = (await callAction('cloudBuy', [hostname, buyRam])) as ActionResult
      if (!result.ok) {
        setBuyError(result.error ?? 'Purchase failed.')
        return
      }
      setBuyHostname('')
      await refreshList()
    }
    catch (err) {
      setBuyError(err instanceof Error ? err.message : String(err))
    }
    finally {
      // No manual RAM refresh needed: HomeRamContext updates on its
      // own schedule regardless of what this app does.
      setBuyBusy(false)
    }
  }

  function handleDeleteClick(hostname: string) {
    if (confirmDeleteHost === hostname) {
      void doDelete(hostname)
    }
    else {
      setConfirmDeleteHost(hostname)
    }
  }

  async function doDelete(hostname: string) {
    setConfirmDeleteHost(null)
    setDeleteError(null)
    setDeleteBusyHost(hostname)
    try {
      const result = (await callAction('cloudDelete', [hostname])) as ActionResult
      if (!result.ok) {
        setDeleteError(result.error ?? 'Delete failed.')
        return
      }
      await refreshList()
    }
    catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err))
    }
    finally {
      // No manual RAM refresh needed: HomeRamContext updates on its
      // own schedule regardless of what this app does.
      setDeleteBusyHost(null)
    }
  }

  // Flips one host's checkbox in the Slave Nodes tab: designates it if it
  // wasn't already, releases it if it was. Unlike deleting a purchased
  // server, un-designating a slave node doesn't touch the server itself —
  // it's not player-owned to delete — so there's no confirm step and no
  // "must be idle first" guard: anything still running there keeps
  // running, it's just no longer offered as a spawn target to
  // Programs/XP Farm/Share. Only re-runs `refreshList` afterward, not the
  // network re-scan — see `refreshAll`'s comment for why that's safe.
  async function toggleSlave(hostname: string) {
    setToggleSlaveError(null)
    setToggleSlaveBusyHost(hostname)
    try {
      const current = await readSlaveNodes(ns)
      const next = current.includes(hostname)
        ? current.filter(h => h !== hostname)
        : [...current, hostname]
      await writeSlaveNodes(ns, next)
      await refreshList()
    }
    catch (err) {
      setToggleSlaveError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setToggleSlaveBusyHost(null)
    }
  }

  const ramTiers = Object.keys(costByRam)
    .map(Number)
    .sort((a, b) => a - b)
  const selectedCost = costByRam[buyRam] ?? 0
  // Only actual purchases count against the purchased-server limit —
  // slave nodes ride along in the same `servers` snapshot (see
  // `cgd/actions/cloud.ts`) but aren't purchases.
  const atServerLimit = cloudServers.length >= serverLimit && serverLimit > 0
  const insufficientMoney = selectedCost > moneyAvailable
  const buyDisabled = buyBusy || atServerLimit || insufficientMoney

  return {
    servers,
    cloudServers,
    slaveServers,
    moneyAvailable,
    serverLimit,
    costByRam,
    listLoading,
    listError,
    refreshList,
    refreshAll,
    busy,

    slaveHosts,
    slaveHostsLoading,
    slaveHostsError,
    toggleSlaveBusyHost,
    toggleSlaveError,
    toggleSlave,

    buyHostname,
    setBuyHostname,
    buyRam,
    setBuyRam,
    buyBusy,
    buyError,
    handleBuy,
    ramTiers,
    selectedCost,
    atServerLimit,
    insufficientMoney,
    buyDisabled,

    confirmDeleteHost,
    deleteBusyHost,
    deleteError,
    handleDeleteClick,
  }
}

/** Everything a rendering component under `../components/` needs. */
export type CloudServersState = ReturnType<typeof useCloudServers>
