import type { NS, RunOptions, ScriptArg } from '@ns'

/**
 * Copies `script` (plus any `deps`) from `source` (default: the calling
 * script's own host) to `dest`, then `ns.exec`s it there with `args`.
 * Returns the new PID (0 on launch failure, same as `ns.exec`). See the
 * inline comment below for the one failure mode this doesn't detect: a
 * failed copy over an already-present stale copy still launches something.
 */
export function scpRun(ns: NS, script: string, dest: string, source: string | undefined = undefined, deps: string[] = [], threadOrOptions: number | RunOptions = 1, ...args: ScriptArg[]) {
  const files = [script, ...deps]
  const copied = ns.scp(files, dest, source)
  if (!copied) {
    // If a file with this name already exists on `dest` from an earlier
    // successful copy, exec() below will still happily launch THAT stale
    // copy and hand back a perfectly normal nonzero PID — nothing else
    // would ever indicate the fresh code never actually landed.
    console.log(`scpRun: failed to copy ${files.join(', ')} to ${dest} (source: ${source ?? ns.getHostname()}) — exec below may run a stale copy if one already exists there`)
  }
  const pid = ns.exec(script, dest, threadOrOptions, ...args)
  // ns.ui.openTail(pid)
  return pid
}
