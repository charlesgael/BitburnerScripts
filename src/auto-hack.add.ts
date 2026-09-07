import type { NS, Server } from '@ns'
import { scanHwgwTargets } from './lib/hwgw/workers'
import { AUTO_HACK_HOST, AUTO_HACK_SCRIPT, HWGW_HOSTS_FILE } from './ui/utils/hwgw-config'
import { parseArgs } from './utils/args'

const SERVER_FILE = `known-servers.json`
const START_SCRIPT = 'hwgw/start.js'

/** Same `positional` -> dedicated-host-list expansion `auto-hack.app.ts`'s `computeDedicated` uses, so a `cloud` keyword works identically here. */
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
 * `HWGW_HOSTS_FILE`) when no hosts were passed as arguments — same fallback
 * `auto-hack.app.ts` uses, see that script's own `readConfiguredHosts` for
 * why this stays a plain `ns.read` rather than the `QueuedNS` version
 * `hwgw-config.ts` also exports.
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
 * `auto-hack.app.ts`'s own `--count` uses, reused here so `--number` picks
 * the same "best" targets an auto-hack instance would auto-pick.
 */
function scoreServer(ns: NS, server: Server): number | null {
  const weakenTime = ns.getWeakenTime(server.hostname)
  return weakenTime > 0 ? (server.moneyMax ?? 0) * ns.hackAnalyzeChance(server.hostname) / weakenTime : null
}

/**
 * One-shot companion to `auto-hack.app.ts`: adds `--number` more hwgw
 * targets on top of whatever's already running, then exits — unlike
 * `auto-hack.app.ts` itself, this never loops. Refuses to run at all unless
 * an `auto-hack.app.js` instance is already alive on `home`, since a bare
 * `hwgw/start.js` launched without that watching over it has nothing
 * managing its host pool going forward.
 */
export async function main(ns: NS) {
  ns.disableLog('ALL')

  const args = parseArgs(ns, [
    { long: 'number', defaultValue: 1, description: 'Number of additional hwgw targets to start.', short: 'n' },
  ] as const, [])
  const number = args.number
  const positional = args._.map(String)

  const autoHackRunning = ns.ps(AUTO_HACK_HOST).some(p => p.filename === AUTO_HACK_SCRIPT)
  if (!autoHackRunning) {
    ns.tprint(`WARNING: ${AUTO_HACK_SCRIPT} isn't running on ${AUTO_HACK_HOST} — start it first so it can manage these targets going forward. Exiting.`)
    return
  }

  if (number <= 0) {
    ns.tprint('WARNING: --number/-n must be > 0 — exiting.')
    return
  }

  const dedicated = positional.length ? computeDedicated(ns, positional) : readConfiguredHosts(ns)
  if (!dedicated.length) {
    ns.tprint(`WARNING: No hosts given as arguments (or "cloud") and ${HWGW_HOSTS_FILE} has none configured — exiting.`)
    return
  }

  const ignored: string[] = positional.length ? positional : dedicated
  const servers: Server[] = JSON.parse(ns.read(SERVER_FILE))
  const alreadyTargeted = scanHwgwTargets(ns, dedicated)
  const hackingLevel = ns.getHackingLevel()

  const possible = servers
    .filter(server =>
      ns.serverExists(server.hostname)
      && !ignored.includes(server.hostname)
      && !server.purchasedByPlayer
      && server.hasAdminRights
      && !alreadyTargeted.has(server.hostname)
      && (server.moneyMax ?? 0) > 0
      && (server.requiredHackingSkill ?? 0) <= hackingLevel,
    )
    .map(server => ({ server, score: scoreServer(ns, server) }))
    .filter((it): it is { server: Server, score: number } => it.score !== null)
    .sort((a, b) => b.score - a.score)

  const candidates = possible.slice(0, number)
  if (!candidates.length) {
    ns.tprint('WARNING: No untargeted, eligible servers found — exiting.')
    return
  }

  let started = 0
  for (const { server } of candidates) {
    const pid = ns.run(START_SCRIPT, {
      threads: 1,
      preventDuplicates: true,
    }, '--target', server.hostname, ...dedicated)

    await ns.sleep(500)
    if (pid === 0) {
      ns.tprint(`ERROR: failed to launch ${START_SCRIPT} on ${server.hostname}`)
    }
    else {
      ns.tprint(`INFO: Started ${START_SCRIPT} for ${server.hostname} (pid ${pid})`)
      started++
    }
  }

  ns.tprint(`INFO: Started ${started}/${candidates.length} new hwgw target(s).`)
}
