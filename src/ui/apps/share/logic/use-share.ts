import type { Server } from '@ns'
import type { CloudServerRow } from '../../../utils/cloud-list'
import React from '@react'
import { useCgdActions } from '../../../context/cgd-actions-context'
import { useQueuedNs } from '../../../context/ns-queue-context'
import { isHome } from '../../../logic/is-home'
import { fetchCloudList, sortByHostname } from '../../../utils/cloud-list'
import { readXpFarmHosts } from '../../../utils/xp-farm-config'

/**
 * All state/behavior for the app's own card grid: the cloud-server list
 * (minus hosts XP Farm has dedicated — see `../index.ts`'s header comment)
 * plus `home` itself, and the RAM-patch callback each card reports back
 * through. Per-card state/behavior lives in `use-share-host-card.ts`.
 */
export function useShare() {
  const ns = useQueuedNs()
  const callAction = useCgdActions()

  // Starts `null`, not `{}`/`[]` — `hosts` below filters it out until the
  // first `refresh()` resolves. A placeholder object with no `hostname`
  // would render as a card with an undefined `key`, and `useShareHostCard`
  // would key its own `ns._ps(host.hostname)` effect off that same
  // `undefined`, firing once for garbage before re-firing for real once
  // `homeServer` actually arrives.
  const [homeServer, setHomeServer] = React.useState<Server | null>(null)
  const [cloudServers, setCloudServers] = React.useState<CloudServerRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const [homeServer, cloudList, xpFarmHosts] = await Promise.all([
        ns._getServer('home'),
        fetchCloudList(callAction),
        readXpFarmHosts(ns),
      ])
      setHomeServer(homeServer)
      const dedicated = new Set(xpFarmHosts)
      setCloudServers(sortByHostname(cloudList.servers.filter((s: CloudServerRow) => !dedicated.has(s.hostname))))
    }
    catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    finally {
      setLoading(false)
    }
  }

  // This component remounts every time the window is opened — fetch the
  // cloud-server list fresh rather than trusting stale state. `home` used
  // to come live from useHomeRam() instead of this fetch (see
  // ui/context/home-ram-context.ts), but that context has no `isSlave`/
  // full-`Server`-shape data and made `home` a structurally different
  // object from every cloud host, so it's fetched here the same way now —
  // see `updateCloudUsedRam`/`useShareHostCard`'s `syncUsedRam` below for
  // the other half of that: `home` is patched in place after a toggle
  // exactly like a cloud host is, not treated as a special case.
  React.useEffect(() => {
    void refresh()
  }, [])

  // Patches a single cloud host's usedRam in place — how a card reports
  // back the RAM it just consumed/freed by starting/stopping a share
  // daemon, without waiting on a full Refresh (see use-share-host-card.ts's
  // syncUsedRam for why that matters).
  function updateCloudUsedRam(hostname: string, ramUsed: number) {
    if (isHome(hostname))
      setHomeServer(prev => (prev ? { ...prev, ramUsed } : prev))
    else
      setCloudServers((prev: CloudServerRow[]) => prev.map(s => (s.hostname === hostname ? { ...s, ramUsed } : s)))
  }

  // `homeServer` is `null` until the first `refresh()` resolves (see its
  // declaration above) — left out of `hosts` until then instead of handing
  // `ShareHostCard` a hostname-less placeholder.
  const hosts: CloudServerRow[] = [
    ...(homeServer ? [homeServer] : []),
    ...cloudServers,
  ]
  return {
    ns,
    loading,
    error,
    refresh,
    hosts,
    updateCloudUsedRam,
  }
}

/** Everything `ShareContent` needs from this hook. */
export type ShareState = ReturnType<typeof useShare>
