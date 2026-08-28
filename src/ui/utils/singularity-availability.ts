import type { AppAvailabilityContext } from '../types'

// Anything gated on ns.singularity.* (daemons/train.daemon.ts, backdoor.app.ts,
// ...) needs either owned SF4 or, before it's ever been owned, simply being
// in the middle of playing BitNode 4 itself (the "Singularity" BitNode) — a
// plain `minSourceFile: { n: 4, lvl: 1 }` can't express that OR, hence this
// escape-hatch lambda instead (see `ui/utils/app-availability.ts`). Shared by
// both `AppDefinition.isAvailable` (`ui/apps/trainer/index.ts`) and
// `ManagedAppDefinition.isAvailable` (`ui/apps/programs/index.ts`'s Backdoor
// Installer entry) — same underlying gate either way.
export function singularityAvailable(ctx: AppAvailabilityContext): true | string {
  if ((ctx.ownedSF.get(4) ?? 0) >= 1 || ctx.currentNode === 4)
    return true
  return 'Needs Source-File 4 (or being in BitNode 4) for Singularity access.'
}
