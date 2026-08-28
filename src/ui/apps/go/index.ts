import type { AppDefinition } from '../../types'
import { GoContent } from './components/go-content'

/**
 * Sidebar liveboard for the standalone IPvGO player (`go.app.ts` — see its
 * own header comment for the game-loop/heuristic design). This app is
 * purely a viewer + start/stop switch: it never references `ns.go.*`
 * itself, since that whole namespace is deliberately kept off the tiered
 * `cgd` daemon's dispatch allow-list (see `daemons/lv1.daemon.ts`'s own
 * header comment on why the allow-list is curated, not broad) — folding
 * `ns.go`'s per-call RAM cost into a daemon tier would charge every player
 * on that tier forever, not just while a game is actually running, same
 * reasoning as Trainer/Backdoor Installer staying independent.
 *
 * Instead, `go.app.ts` (full, unqueued `ns`, already paying that cost only
 * while it's actually running) writes two files every turn/game — see
 * `go/state-file.ts` — and this app just polls and renders them via
 * `read`/`isRunning`/`exec`/`kill`/`ui.openTail`, all already on tier 1's
 * allow-list. `minDaemonTier` is therefore left unset (defaults to none):
 * this app works at any daemon tier, including tier 0/1.
 *
 * `logic/use-go.ts` holds all state/polling; `components/` is presentational
 * JSX driven off its return value, split into the board grid
 * (`go-board.tsx`) and the game-log win-rate table (`go-summary-table.tsx`).
 */
export const GoApp: AppDefinition = {
  id: 'go',
  icon: '🎯',
  label: 'IPvGO',
  Content: GoContent,
  // Wide enough for a 13x13 board (the largest size) plus the side panel
  // without either being cramped.
  preferredWidth: 640,
  preferredHeight: 560,
  minWidth: 420,
  minHeight: 380,
}
