import { AppAvailabilityContext, AppDefinition } from "../types";

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
    if (app.minRam == null) return null;
    const headroom = ctx.homeRam.max * 0.8;
    if (headroom >= app.minRam) return null;
    return (
        `Needs ${app.minRam} GB of home's max RAM (80% headroom rule) — only ` +
        `${headroom.toFixed(1)} GB of ${ctx.homeRam.max.toFixed(1)} GB qualifies.`
    );
}

/**
 * Checks an app's `minSourceFile`/`isAvailable` (see `ui/types.ts`) against
 * `ctx` — both AND'd together, true only if every declared rule passes (an
 * app declaring neither is always visible). Unlike `ramShortfallReason`
 * above, `ui/components/app-grid.tsx` doesn't render the icon at all when
 * this is false, rather than showing it disabled: a missing Source-File
 * (or whatever an `isAvailable` lambda checks) isn't something the player
 * can fix mid-session the way freeing up RAM is, so surfacing it as a
 * locked icon would just be a permanent tease for most of a run.
 *
 * Pure and 0 GB — same reasoning as `ramShortfallReason`.
 */
export function isAppVisible(app: AppDefinition, ctx: AppAvailabilityContext): boolean {
    if (app.minSourceFile != null) {
        const { n, lvl } = app.minSourceFile;
        if ((ctx.ownedSF.get(n) ?? 0) < lvl) return false;
    }
    if (app.isAvailable && app.isAvailable(ctx) !== true) return false;
    return true;
}
