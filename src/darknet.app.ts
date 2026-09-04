import type { NS } from '@ns'
import { preemptStaleInstances } from './daemons/dnet-probe.daemon'
import { tryAuth } from './lib/dnet/auth'
import { getColonizedStore, resetColonizedStore } from './lib/dnet/colonized'
import { parseArgs } from './utils/args'
import { formatMediumHour } from './utils/format/dates'
import { scpRun } from './utils/scp-run'

const DNET_PROBE_DAEMON = 'daemons/dnet-probe.daemon.js'

export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  // --- ARGS

  const _args = parseArgs(ns, [
  ])

  // --- Prerequisites

  if (!ns.hasTorRouter()) {
    ns.tprint('ERROR: TOR Router not owned, purchase one first')
    return
  }

  try {
    ns.dnet.probe()
  }
  catch (e) {
    ns.tprint(`ERROR: Problem asserting dnet: ${e}`)
    return
  }

  // --- Loop

  // Full re-cascade only every RESET_EVERY_N_TICKS mutations, not every
  // single one — colonized only ever means "already visited THIS pass" (see
  // colonized.ts), so resetting it is what triggers dnet-probe.daemon.ts's
  // whole hop-by-hop cascade to redo itself. Doing that on every mutation
  // tick was hammering the network (and darknet instability) far more than
  // needed; letting several ticks pass between full sweeps gives things
  // time to settle while still catching drift eventually. tick starts at 0
  // so the very first pass (bootstrapping from a cold start) always runs
  // immediately rather than waiting out the first 10 ticks.
  const RESET_EVERY_N_TICKS = 10
  let tick = 0

  while (true) {
    if (tick % RESET_EVERY_N_TICKS === 0) {
      ns.print('Starting new round ', formatMediumHour(Date.now()))
      resetColonizedStore()
      const colonized = getColonizedStore()

      const probe = ns.dnet.probe()
      ns.print(`Probes: ${probe.join(' | ')}`)

      for (const host of probe) {
        const res = await tryAuth(ns, host)
        if (res.type === 'failure')
          continue

        // Marked before spawning, same reasoning as
        // dnet-probe.daemon.ts's own parent-marks-before-spawn: closes the
        // (here unlikely, but cheap to close) race between this host being
        // reached from two different directions in the same pass.
        colonized[host] = 'online'
        // ns.killall(host)
        preemptStaleInstances(ns, DNET_PROBE_DAEMON, host)
        const pid = scpRun(ns, DNET_PROBE_DAEMON, host, undefined, [], 1)
        ns.print(`Launched on ${host}: PID ${pid}`)
      }
    }
    tick++

    await ns.dnet.nextMutation()
  }
}
