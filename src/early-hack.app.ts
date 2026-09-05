import type { NS, Server } from '@ns'
import { drainStatusPort } from './daemons/money-farm.daemon'
import { addMoneyFarmLog } from './lib/money-farm/state-farm'
import { parseArgs } from './utils/args'
import { noDupe } from './utils/ns/nodupe'
import { MONEY_FARM_PORT } from './utils/ports.lib'
import { scpRun } from './utils/scp-run'

const EARLY_HACK_SCRIPT = 'daemons/early-hack.daemon.js'
const SERVER_FILE = `known-servers.json`

function updateServer(ns: NS, target: string) {
  const server = ns.getServer(target)
  addMoneyFarmLog(ns, {
    action: 'update-server',
    target,
    money: server.moneyAvailable ?? 0,
    maxMoney: server.moneyMax ?? 0,
    security: server.hackDifficulty ?? 0,
    minSecurity: server.minDifficulty ?? 0,
  })
}

export async function main(ns: NS) {
  ns.disableLog(`ALL`)
  noDupe(ns)
  const args = parseArgs(ns, [
    { long: 'delay', defaultValue: 60, description: 'Delay between passes', short: 'd' },
    { long: 'once', defaultValue: false, description: 'Only run once', short: 'o' },
    { long: 'target', defaultValue: 'foodnstuff', description: 'Which target to repeatedly hurt', short: 't' },
  ] as const)
  const delay = args.delay * 1000
  const repeat = !args.once
  const threadCost = ns.getScriptRam(EARLY_HACK_SCRIPT)
  const deployed: string[] = []
  const ignored: string[] = args._.map(String)

  const server = ns.getServer(args.target)
  if (!server) {
    ns.print(`ERROR: The target you wish to aim for '${args.target}' does not exist`)
    return
  }
  const maxMoney = ns.getServerMaxMoney(args.target)
  const minSecurity = ns.getServerMinSecurityLevel(args.target)

  ns.atExit(() => {
    deployed.forEach(host => ns.killall(host))
    addMoneyFarmLog(ns, {
      action: 'end-work',
      target: args.target,
    })
  }, 'early-hack-clean')

  addMoneyFarmLog(ns, {
    action: 'start-work',
    target: args.target,
  })
  addMoneyFarmLog(ns, {
    action: 'change-mode',
    target: args.target,
    mode: 'early',
    oldMode: 'null',
  })

  do {
    updateServer(ns, args.target)
    drainStatusPort(ns)
    const servers: Server[] = JSON.parse(ns.read(SERVER_FILE))
    ns.print(`\nReloaded ${SERVER_FILE}`)

    for (const server of servers) {
      if (ignored.includes(server.hostname))
        continue
      if (!server.hasAdminRights)
        continue
      if (server.maxRam < threadCost)
        continue
      if (deployed.includes(server.hostname))
        continue

      ns.print(`INFO: Acquired server ${server.hostname}`)
      ns.killall(server.hostname)

      const threads = Math.floor(server.maxRam / threadCost)
      const pid = scpRun(ns, EARLY_HACK_SCRIPT, server.hostname, 'home', [], {
        threads,
        preventDuplicates: true,
      }, '--money', maxMoney, '--security', minSecurity, '--port', MONEY_FARM_PORT, args.target, threads)
      if (pid === 0)
        ns.print(`ERROR: failed to launch ${EARLY_HACK_SCRIPT} on ${server.hostname}`)
      else
        deployed.push(server.hostname)
    }

    if (repeat) {
      ns.print(
        `Will search again at ${new Date(
          Date.now() + delay,
        ).toLocaleTimeString(undefined, { hour12: false })}.`,
      )
      await ns.sleep(delay)
    }
    // repeat is a const set once from `ns.args` above (run-once vs.
    // persistent-loop mode) — intentionally never reassigned.
    // eslint-disable-next-line no-unmodified-loop-condition
  } while (repeat)
}
