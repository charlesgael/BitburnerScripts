import type { ManagedAppDefinition, Task } from './types'

/**
 * Resolves what still needs to spawn on `host` before `app` itself can, per
 * `app.requires` (see `./types.ts`) — walked recursively, since a required
 * app can itself have `requires`. Returns the missing apps in dependency
 * order (a script's own dependencies always precede it), so spawning them
 * in that order and finishing with `app` satisfies every link in the chain.
 * Already-running-on-`host` apps are left out entirely (nothing to do for
 * them); a script required more than once anywhere in the tree only appears
 * once, at its first (deepest) position.
 *
 * Returns `null` — instead of a chain — when a dependency can't be
 * satisfied on `host` at all: it's `singleInstance` (see `./types.ts`) and
 * already running on some *other* host, so spawning a second copy here
 * would violate that app's own one-instance-total rule. None of today's
 * `requires` targets (just `netmapper.app.js`) are `singleInstance`, so this
 * is currently unreachable in practice — it's here so a future catalog
 * change fails loudly instead of silently double-spawning something it
 * shouldn't.
 *
 * Pure — no `ns` access, just `apps`/`tasks` data the caller already has
 * (`use-task-manager.ts`), so both `hostOptions` (to size up the RAM an
 * auto-launched chain would need) and `spawnTask` (to actually run it) can
 * call this without duplicating the walk.
 */
export function resolveDependencyChain(
  app: ManagedAppDefinition,
  host: string,
  appByScript: Record<string, ManagedAppDefinition>,
  tasks: Task[],
): ManagedAppDefinition[] | null {
  const chain: ManagedAppDefinition[] = []
  const seen = new Set<string>()
  let unsatisfiable = false

  function visit(current: ManagedAppDefinition) {
    if (unsatisfiable || seen.has(current.script))
      return
    seen.add(current.script)
    if (tasks.some(t => t.script === current.script && t.host === host))
      return
    if (current.singleInstance && tasks.some(t => t.script === current.script)) {
      unsatisfiable = true
      return
    }
    for (const depScript of current.requires ?? []) {
      const depApp = appByScript[depScript]
      if (depApp)
        visit(depApp)
    }
    chain.push(current)
  }

  for (const depScript of app.requires ?? []) {
    const depApp = appByScript[depScript]
    if (depApp)
      visit(depApp)
  }

  return unsatisfiable ? null : chain
}
