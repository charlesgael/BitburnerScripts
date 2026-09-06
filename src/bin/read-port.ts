import type { NS } from '@ns'
import { parseArgs } from '../utils/args'

export async function main(ns: NS) {
  ns.disableLog('ALL')
  const args = parseArgs(ns, [], [
    { name: 'portNumber', description: 'The port to read from' },
  ])

  ns.ui.openTail(ns.pid)
  while (true) {
    ns.print(ns.readPort(Number(args.portNumber)))
    await ns.sleep(100)
  }
}
