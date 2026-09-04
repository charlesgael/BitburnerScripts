type ColonizationState = 'tentative' | 'online' | 'failed'
export interface ColonizedStore {
  [host: string]: ColonizationState | undefined
}

/**
 * Record of every host touched during the CURRENT BFS pass — same
 * eval("window") trick as auth.ts's password store (see that file's
 * getPasswordStore for why this can't just be src/cgd/store.ts). Exists
 * purely to stop dnet-probe.daemon.ts's self-replicating cascade from
 * visiting the same host twice within one pass, not as a permanent "ever
 * successfully touched" record — darknet.app.ts calls resetColonizedStore()
 * at the start of each mutation-driven pass so the cascade runs fresh every
 * time, relying on auth.ts's separate (never-reset) password memory to make
 * re-authenticating an already-known host a cheap connectToSession rather
 * than a real re-solve.
 *
 * Three states, not a boolean: tryAuth() is a Promise that can take real
 * time (some algos are several authenticate()/heartbleed() round trips
 * deep), so a plain "have we started" flag only set on success/failure
 * still leaves a window where two neighbors both reach the same third host
 * before either's tryAuth() has resolved, and both start cracking it.
 * 'tentative' closes that: set *before* tryAuth() is even called, so a
 * second racer sees it and skips immediately instead of duplicating the
 * work.
 */
export function getColonizedStore(): ColonizedStore {
  const win = eval('window') as { __dnetColonized?: ColonizedStore }
  if (!win.__dnetColonized)
    win.__dnetColonized = {}
  return win.__dnetColonized
}

/** Empties the store — called by darknet.app.ts at the start of each mutation-driven pass. */
export function resetColonizedStore(): void {
  const win = eval('window') as { __dnetColonized?: ColonizedStore }
  win.__dnetColonized = {}
}
