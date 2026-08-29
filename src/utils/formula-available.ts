import type { Formulas, NS } from '@ns'

export function formulas(ns: NS): Formulas | null {
  try {
    const p = ns.formulas.mockPlayer()
    const s = ns.formulas.mockServer()

    ns.formulas.hacking.hackTime(s, p)
    return ns.formulas
  }
  catch { }
  return null
}
