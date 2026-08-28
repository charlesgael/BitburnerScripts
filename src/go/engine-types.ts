import type { NS } from '@ns'

/**
 * Shared types both move-selection engines (`./heuristic-engine.ts`,
 * `./experimental-engine.ts`) implement the same interface against, so
 * `go.app.ts` can pick either one at startup (`-e`/`--experimental`, see
 * that file) without caring which is actually running.
 */

export interface Move {
  x: number
  y: number
}

/**
 * A picked move (or `null` for pass), plus `selfAtari` — whether it leaves
 * our own resulting chain at 1 liberty (and wasn't a capture) — which
 * go.app.ts folds into `GoGameLogEntry.selfAtariMoves` (see
 * `./state-file.ts`) to track how often an engine accepts that trade-off.
 * Capture counts aren't included here on purpose: go.app.ts derives those
 * itself from a real before/after board diff once the opponent's reply is
 * known, which is ground truth rather than either engine's own prediction.
 */
export interface MoveDecision {
  move: Move | null
  selfAtari: boolean
}

/** What `go.app.ts` calls a move-selection engine with, and expects back. */
export type PickMove = (ns: NS, board: string[]) => Promise<MoveDecision>
