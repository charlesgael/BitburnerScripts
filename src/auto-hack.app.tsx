import type { NS, Server } from '@ns'
import { parseArgs } from './utils/args'
import { formatMediumHour } from './utils/format/dates'
import { noDupe } from './utils/ns/nodupe'

const SERVER_FILE = `known-servers.json`

function computeDedicated(ns: NS, positional: string[]): string[] {
  if (positional.length === 1 && positional[0] === 'cloud') {
    return ns.cloud.getServerNames()
  }
  else {
    return positional
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
  noDupe(ns)

  const args = parseArgs(ns, [
    { long: 'count', defaultValue: -1, description: 'Only launch the N best-scoring targets (money/sec potential). -1 = unlimited.', short: 'n' },
  ] as const, [])
  const count = args.count
  const positional = args._.map(String)
  const deployed: string[] = []

  const dedicated = computeDedicated(ns, positional)
  if (!dedicated.length) {
    ns.tprint('Server list must be given as arguments')
  }

  const delay = 60_000
  const ignored: string[] = positional
  const pids: number[] = []

  ns.atExit(() => {
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

        const pid = ns.run('hwgw/start.js', {
          threads: 1,
          preventDuplicates: true,
        }, '--target', server.hostname, ...dedicated)
        if (pid === 0) {
          ns.print(`ERROR: failed to launch 'hwgw/start.js' on ${server.hostname}`)
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
