import type { AppAvailabilityContext, AppDefinition } from '../types'

/**
 * Checks an app's `minRam` (see `ui/types.ts`) against `ctx`. Returns `null`
 * when there's enough (or the app declares no `minRam` at all), or a
 * player-facing string explaining the shortfall. Unlike `isAppVisible`
 * below, a RAM shortfall doesn't hide the app — `ui/components/app-grid.tsx`
 * shows it as a disabled icon with this string as the tooltip, since it's
 * something the player can act on (free up RAM) without leaving the app
 * grid, unlike a missing Source-File.
 *
 * Pure and 0 GB — `ctx` is assembled by the caller from data it already has
 * (`home`'s live RAM — see `ui.app.ts`), so this never touches `ns` itself.
 */
export function ramShortfallReason(app: AppDefinition, ctx: AppAvailabilityContext): string | null {
  if (app.minRam == null)
    return null
  const headroom = ctx.homeRam.max * 0.8
  if (headroom >= app.minRam)
    return null
  return (
    `Needs ${app.minRam} GB of home's max RAM (80% headroom rule) — only `
    + `${headroom.toFixed(1)} GB of ${ctx.homeRam.max.toFixed(1)} GB qualifies.`
  )
}

/**
 * Runs an optional `isAvailable` check against `ctx` — the shape shared by
 * `AppDefinition.isAvailable` (`ui/types.ts`) and
 * `ManagedAppDefinition.isAvailable` (`ui/apps/task-manager/logic/types.ts`,
 * e.g. `ui/apps/programs/index.ts`'s Backdoor Installer entry gating on
 * `singularityAvailable`). `undefined` always passes — declaring no rule
 * means always available. Pure and 0 GB, same as everything else here.
 *
 * The check's return type is deliberately `true | string`, not
 * `boolean | string` — a lambda that inverts another `true | string` check
 * (e.g. "show this row only when Singularity *isn't* available") can't just
 * `!`-negate the result: a non-empty reason string is truthy, so
 * `!checkThatFailed` is `false` in both the pass and fail case, and the row
 * silently never shows. Keeping the parameter type strict to `true | string`
 * makes that mistake a compile error instead — compare the wrapped check's
 * result `=== true` and return `true`/a reason string from that, don't
 * negate it. See `ui/apps/programs/index.ts`'s "Backdoor Lister" entry for
 * the fixed pattern.
 */
export function checkIsAvailable(
  isAvailable: ((ctx: AppAvailabilityContext) => true | string) | undefined,
  ctx: AppAvailabilityContext,
): boolean {
  return !isAvailable || isAvailable(ctx) === true
}

/**
 * Checks an app's `minSourceFile`/`minDaemonTier`/`isAvailable` (see
 * `ui/types.ts`) against `ctx` — all AND'd together, true only if every
 * declared rule passes (an app declaring none is always visible). Unlike
 * `ramShortfallReason` above, `ui/components/app-grid.tsx` doesn't render
 * the icon at all when this is false, rather than showing it disabled: a
 * missing Source-File, an under-tier daemon, or whatever an `isAvailable`
 * lambda checks isn't something the player can fix mid-session the way
 * freeing up RAM is, so surfacing it as a locked icon would just be a
 * permanent tease for most of a run.
 *
 * Pure and 0 GB — same reasoning as `ramShortfallReason`.
 *
 * Tier 0 hides every app unconditionally, regardless of what it declares:
 * tier 0 has zero caller-facing dispatch at all (see `cgd/dispatch.ts`'s
 * `isPathAllowed`), so even an app with no `minDaemonTier` of its own —
 * Trainer, say, gated only on SF4 via `isAvailable` — still needs tier 1's
 * baseline `exec`/`kill`/`ps` just to spawn and monitor its own daemon
 * script. Nothing works at tier 0 except the stats the daemon itself
 * pushes into the store, so there's no per-app rule that would ever let one
 * through here.
 */
export function isAppVisible(app: AppDefinition, ctx: AppAvailabilityContext): boolean {
  if (ctx.daemonTier <= 0)
    return false
  if (app.minSourceFile != null) {
    const { n, lvl } = app.minSourceFile
    if (!hasSourceFile(ctx, n, lvl))
      return false
  }
  if (app.minDaemonTier != null && ctx.daemonTier < app.minDaemonTier)
    return false
  return checkIsAvailable(app.isAvailable, ctx)
}

/**
 * True if the player has access to Source-File `n` at level `lvl` or
 * higher — either because they own it (`ownedSF`), or because they're
 * currently playing inside BitNode `n` itself, which grants that
 * BitNode's mechanic live regardless of the declared `lvl` (the same
 * rule `stock-trader.app.ts`'s `canShort` applies standalone against a
 * raw `ns.getResetInfo()`, for BitNode 8/SF8 — this is a general
 * Bitburner rule, not specific to Singularity/SF4). Centralizes the OR
 * so `minSourceFile` above and `singularityAvailable` (see
 * `ui/utils/singularity-availability.ts`) apply the identical rule
 * instead of one being a hand-rolled duplicate of the other.
 */
export function hasSourceFile(ctx: Pick<AppAvailabilityContext, 'ownedSF' | 'currentNode'>, n: number, lvl: number): boolean {
  return (ctx.ownedSF.get(n) ?? 0) >= lvl || ctx.currentNode === n
}
