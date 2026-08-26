import { AppAvailabilityContext } from "../../../types";

// daemons/train.daemon.ts is all ns.singularity.* calls (see `../index.ts`'s
// header comment), which need either owned SF4 or, before it's ever been
// owned, simply being in the middle of playing BitNode 4 itself (the
// "Singularity" BitNode) — a plain `minSourceFile: { n: 4, lvl: 1 }` can't
// express that OR, hence the escape-hatch lambda instead (see `ui/utils/
// app-availability.ts`).
export function trainerAvailable(ctx: AppAvailabilityContext): true | string {
    if ((ctx.ownedSF.get(4) ?? 0) >= 1 || ctx.currentNode === 4) return true;
    return "Needs Source-File 4 (or being in BitNode 4) for Singularity access.";
}
