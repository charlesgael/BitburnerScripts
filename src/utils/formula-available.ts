import type { Formulas, NS } from '@ns'

/**
 * Returns `ns.formulas` if the Formulas API is actually usable (owned
 * `Formulas.exe`), or `null` otherwise. There's no direct `ns.formulas`
 * availability check, so this probes it instead: a real hacking-time call on
 * mocked player/server data throws if the player doesn't own it, and is
 * cheap/side-effect-free if they do.
 */
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
