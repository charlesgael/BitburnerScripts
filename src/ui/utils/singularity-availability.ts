import type { AppAvailabilityContext } from '../types'
import { hasSourceFile } from './app-availability'

// Anything gated on ns.singularity.* (daemons/train.daemon.ts, backdoor.app.ts,
// ...) needs either owned SF4 or, before it's ever been owned, simply being
// in the middle of playing BitNode 4 itself (the "Singularity" BitNode) — see
// `hasSourceFile` in `ui/utils/app-availability.ts` for that shared rule.
// This stays as its own wrapper (rather than every call site using
// `hasSourceFile` directly) for the `true | string` reason text, and because
// it's shared by both `AppDefinition.isAvailable` (`ui/apps/trainer/index.ts`)
// and `ManagedAppDefinition.isAvailable` (`ui/apps/programs/index.ts`'s
// Backdoor Installer entry) — same underlying gate either way.
export function singularityAvailable(ctx: AppAvailabilityContext): true | string {
  if (hasSourceFile(ctx, 4, 1))
    return true
  return 'Needs Source-File 4 (or being in BitNode 4) for Singularity access.'
}
