import type { NS, Server } from '@ns'
import { HWGW_HOSTS_FILE } from './ui/utils/hwgw-config'
import { parseArgs } from './utils/args'
import { formatMediumHour } from './utils/format/dates'

const SERVER_FILE = `known-servers.json`
const START_SCRIPT = 'hwgw/start.js'

function computeDedicated(ns: NS, positional: string[]): string[] {
  if (positional.length === 1 && positional[0] === 'cloud') {
    return ns.cloud.getServerNames()
  }
  else {
    return positional
  }
}

/**
 * Falls back to `hwgw-hosts.json` (`ui/apps/money-farm/`'s host picker,
 * `HWGW_HOSTS_FILE`) when no hosts were passed as arguments — see that
 * file's own header comment, which already documents this as the intended
 * "read once at startup" contract. Plain `ns.read`, not the `QueuedNS`
 * version that file also exports (`readHwgwHosts`) — this script talks to
 * `ns` directly like the rest of it, no daemon/proxy involved.
 */
function readConfiguredHosts(ns: NS): string[] {
  const raw = ns.read(HWGW_HOSTS_FILE)
  if (!raw)
    return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === 'string') : []
  }
  catch {
    return []
  }
}

/**
 * `moneyMax * hackChance / weakenTime` — the same money/sec scoring
 * `steady-farm.daemon.ts`'s `pickTarget`/`scoreServer` uses, reused here so
 * `--count` picks the same "best" a steady-farm instance would auto-pick.
 */
function scoreServer(ns: NS, server: Server): number | null {
  const weakenTime = ns.getWeakenTime(server.hostname)
  return weakenTime > 0 ? (server.moneyMax ?? 0) * ns.hackAnalyzeChance(server.hostname) / weakenTime : null
}

export async function main(ns: NS) {
  ns.disableLog(`ALL`)

  const args = parseArgs(ns, [
    { long: 'count', defaultValue: -1, description: 'Only launch the N best-scoring targets (money/sec potential). -1 = unlimited.', short: 'n' },
  ] as const, [])
  const count = args.count
  const positional = args._.map(String)
  const deployed: string[] = []

  const dedicated = positional.length ? computeDedicated(ns, positional) : readConfiguredHosts(ns)
  if (!dedicated.length) {
    ns.tprint(`WARNING: No hosts given as arguments and ${HWGW_HOSTS_FILE} has none configured — exiting.`)
    return
  }

  const delay = 60_000
  const ignored: string[] = positional.length ? positional : dedicated
  const pids: number[] = []

  ns.atExit(() => {
    const pids = ns.ps('home')
      .filter(it => it.filename === START_SCRIPT)
      .map(it => it.pid)
    for (const s of pids) {
      ns.kill(s)
    }
  })

  do {
    const servers: Server[] = JSON.parse(ns.read(SERVER_FILE))
    ns.print(`\nReloaded ${SERVER_FILE}`)

    const hackingLevel = ns.getHackingLevel()
    const slotsRemaining = count < 0 ? Infinity : count - deployed.length

    if (slotsRemaining > 0) {
      const candidates = servers
        .filter(server =>
          ns.serverExists(server.hostname)
          && !ignored.includes(server.hostname)
          && !server.purchasedByPlayer
          && server.hasAdminRights
          && !deployed.includes(server.hostname)
          && (server.moneyMax ?? 0) > 0
          && (server.requiredHackingSkill ?? 0) <= hackingLevel,
        )
        .map(server => ({ server, score: scoreServer(ns, server) }))
        .filter((it): it is { server: Server, score: number } => it.score !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, slotsRemaining)

      for (const { server } of candidates) {
        ns.print(`INFO: Acquired server ${server.hostname}`)

        const pid = ns.run(START_SCRIPT, {
          threads: 1,
          preventDuplicates: true,
        }, '--target', server.hostname, ...dedicated)

        await ns.sleep(500)
        if (pid === 0) {
          ns.print(`ERROR: failed to launch ${START_SCRIPT} on ${server.hostname}`)
        }
        else {
          deployed.push(server.hostname)
          pids.push(pid)
        }
      }
    }

    ns.print(
      `Running ${deployed.length}${count < 0 ? '' : `/${count}`}, search again at ${formatMediumHour(Date.now() + delay)}.`,
    )
    await ns.asleep(delay)
    // repeat is a const set once from `args` above (run-once vs.
    // persistent-loop mode) — intentionally never reassigned.
  } while (true)
}
