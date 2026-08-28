import type { NS } from '@ns'
import type { ReactGlobals } from '../types'

export function getWinGlobals() {
  const doc = eval('document')
  const win = eval('window')

  return { doc, win }
}

/**
 * Grabs the game's exposed React/ReactDOM globals via the classic
 * `eval("window")` trick — the standard, RAM-free way to reach the DOM/React
 * from a Netscript script. Returns null (after printing an error) if
 * React/ReactDOM aren't available.
 */
export function getReactGlobals(ns?: NS): ReactGlobals | null {
  const winGlob = getWinGlobals()
  const React = winGlob.win.React
  const ReactDOM = winGlob.win.ReactDOM

  if (!React || !ReactDOM) {
    if (ns)
      ns.tprint('ERROR: Could not access React/ReactDOM globals.')
    else console.log('ERROR: Could not access React/ReactDOM globals.')
    return null
  }

  return { ...winGlob, React, ReactDOM }
}
