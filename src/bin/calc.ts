import type { NS } from '@ns'

export function main(ns: NS) {
  const calc = ns.args.join(' ')
  try {
    ns.tprint(eval(calc))
  }
  catch (e) {
    ns.tprint(`ERROR: Problem during evaluation ${e}`)
  }
}
