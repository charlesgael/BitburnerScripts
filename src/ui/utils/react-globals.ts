import type React from 'react'
import type * as ReactDOMOrig from 'react-dom'

export function getWinGlobals() {
  const doc = eval('document')
  const win = eval('window')

  return { doc, win }
}

type ReactInt = typeof React
// The real `ReactDOM` module shape (`.render`, `.createPortal`, ...) — from
// `react-dom`'s own types, not `react`'s. `react`'s types also declare a
// `ReactDOM` symbol, but it's `React.ReactDOM`, a deprecated, unrelated
// legacy interface (`ReactHTML & ReactSVG`, the old `React.DOM.div()`-style
// factory helpers) that just happens to share the name.
type ReactDOMInt = typeof ReactDOMOrig

// A one-time snapshot, not a live reference: `export default <expr>` only
// ever evaluates `<expr>` once, the first time this module loads in a given
// script — every other file's `import React from '@react'` binds to that
// same already-computed value, it doesn't re-run `getWinGlobals()`. That's
// fine here (unlike `cgd.daemon`, which really does get replaced in-place
// by a redeploy without a page reload — see `ns-proxy.ts`'s live-getter
// Proxy for why *that* needs to re-resolve on every call): `window.React`/
// `window.ReactDOM`'s object identity never changes during a tab's life,
// since the game's own React instance is never torn down and remounted —
// only a full page reload would do that, and that kills this script's
// process too.
export default getWinGlobals().win.React as ReactInt
export const ReactDOM = getWinGlobals().win.ReactDOM as ReactDOMInt
