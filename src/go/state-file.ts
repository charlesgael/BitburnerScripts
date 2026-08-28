/**
 * Shared file-based channel between `../go.app.ts` (the standalone IPvGO
 * player — full, unqueued `ns`, writer-only for both files below) and
 * `../ui/apps/go/` (the sidebar liveboard panel — reads through the tiered
 * `cgd` daemon's queued `ns`, reader-only). Same shape as
 * `ui/utils/xp-farm-config.ts`'s config-file channel, just in the opposite
 * direction: the standalone app is the sole writer here, not the UI.
 *
 * Two files, two purposes:
 *
 * - `GO_LIVE_STATE_FILE` — a single JSON object, overwritten (`"w"` mode)
 *   every turn: whatever the liveboard needs to render *right now* (board,
 *   score, whose turn, a short rolling feed of recent events). No history —
 *   that's the log file's job.
 * - `GO_GAME_LOG_FILE` — JSON Lines (one `GoGameLogEntry` per line),
 *   appended (`"a"` mode) once per *completed* game. Exists to answer "is
 *   the move-engine heuristic actually working?" over time — win rate per
 *   opponent/board size, how often it self-ataris, typical game length —
 *   none of which `ns.go.analysis.getStats()` captures (that's wins/losses/
 *   streaks only, no move-quality texture). Appending rather than
 *   read-modify-write keeps a mid-game crash from ever corrupting past
 *   entries, and avoids re-parsing a potentially-long file every game just
 *   to add one entry.
 *
 * Only the parsing here is shared code — `go.app.ts` writes through the raw
 * `NS` it already has, and the UI reads through `QueuedNS` (see
 * `ui/utils/ns-proxy.ts`); those are different types, so each side calls its
 * own `_read`/`ns.write` and hands the raw string to the parsers below
 * rather than sharing a single read/write function (same split
 * `daemons/xp-farm.daemon.ts`'s own `readHosts` and `xp-farm-config.ts`'s
 * `readXpFarmHosts` have, and for the same reason).
 */

export const GO_LIVE_STATE_FILE = 'go-live-state.txt'
export const GO_GAME_LOG_FILE = 'go-game-log.txt'
export const GO_SCRIPT = 'go.app.js'
export const GO_HOST = 'home'

/** Which move-selection engine produced a `GoLiveState`/`GoGameLogEntry` — see `go.app.ts`'s `-e`/`--experimental` flag. */
export type GoEngineName = 'heuristic' | 'experimental'

/** Bounds `GoLiveState.recentEvents` — see `pushEvent` in `../go.app.ts`. */
export const GO_LIVE_STATE_MAX_EVENTS = 15

/** Rewritten wholesale every turn — see this file's header comment. */
export interface GoLiveState {
  updatedAt: number
  /** The `GoOpponent` string this game is against — kept as `string` here so this file has no dependency on the un-exported NetscriptDefinitions type (see `go.app.ts`'s own `GoOpponent` derivation). */
  opponent: string
  boardSize: number
  /** Same column-strings format as `ns.go.getBoardState()`. */
  board: string[]
  currentPlayer: 'White' | 'Black' | 'None'
  blackScore: number
  whiteScore: number
  komi: number
  lastMove: [number, number] | null
  /** Whether go.app.ts is auto-rotating through every faction, vs pinned to one opponent via CLI args. */
  rotating: boolean
  /** Most-recent-last, capped at `GO_LIVE_STATE_MAX_EVENTS`. */
  recentEvents: string[]
  /** Which move-selection engine is currently playing — see `GoEngineName`. */
  engine: GoEngineName
}

/** One completed game, appended to `GO_GAME_LOG_FILE`. */
export interface GoGameLogEntry {
  timestamp: number
  opponent: string
  boardSize: number
  result: 'win' | 'loss' | 'tie'
  blackScore: number
  whiteScore: number
  /** Stones we placed (passes not included). */
  moves: number
  passes: number
  /** Opponent stones captured across the whole game, by board-diff — see `go.app.ts`'s `countStones`. */
  captures: number
  /** Our own stones captured across the whole game. */
  lostStones: number
  /** How many of our moves the engine flagged as leaving us at 1 liberty (accepted anyway, not necessarily a mistake — see `go/heuristic-engine.ts`/`go/experimental-engine.ts`). */
  selfAtariMoves: number
  durationMs: number
  /** Which move-selection engine played this game — see `GoEngineName`. Lets `summarizeGameLog` compare them from the same log instead of needing separate files per engine. */
  engine: GoEngineName
}

/** Parses `GO_LIVE_STATE_FILE`'s content; `null` if missing/empty/corrupt. */
export function parseLiveState(raw: string): GoLiveState | null {
  if (!raw)
    return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as GoLiveState : null
  }
  catch {
    return null
  }
}

/** Parses `GO_GAME_LOG_FILE`'s JSON-Lines content, skipping any unparsable line rather than failing the whole read. */
export function parseGameLog(raw: string): GoGameLogEntry[] {
  if (!raw)
    return []
  const entries: GoGameLogEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed)
      continue
    try {
      entries.push(JSON.parse(trimmed) as GoGameLogEntry)
    }
    catch {
      // Skip a corrupt/partial line (e.g. a write cut short by a crash)
      // rather than discarding every entry around it.
    }
  }
  return entries
}

/** Per-opponent slice of `summarizeGameLog`'s output. */
export interface GoOpponentSummary {
  opponent: string
  games: number
  wins: number
  losses: number
  ties: number
  winRate: number
  /** Mean `blackScore - whiteScore` — how comfortably (or not) games are being won/lost, not just the win/loss tally. */
  avgMargin: number
}

/** Per-engine slice of `summarizeGameLog`'s output — same shape as `GoOpponentSummary`, keyed by engine instead of opponent. */
export interface GoEngineSummary {
  engine: GoEngineName
  games: number
  wins: number
  losses: number
  ties: number
  winRate: number
  avgMargin: number
}

export interface GoLogSummary {
  games: number
  wins: number
  losses: number
  ties: number
  winRate: number
  avgDurationMs: number
  /** Sorted by `opponent`, so the UI table's row order is stable across polls. */
  byOpponent: GoOpponentSummary[]
  /** Sorted by `engine`, same stability reasoning as `byOpponent`. */
  byEngine: GoEngineSummary[]
}

const EMPTY_SUMMARY: GoLogSummary = { games: 0, wins: 0, losses: 0, ties: 0, winRate: 0, avgDurationMs: 0, byOpponent: [], byEngine: [] }

/**
 * Aggregates a batch of `GoGameLogEntry` rows (typically `parseGameLog`'s
 * full output, capped at `GAME_LOG_MAX_ENTRIES` by go.app.ts's own
 * trimming) into overall + per-opponent win-rate stats — the "is the
 * heuristic actually working" view the `ui/apps/go/` liveboard shows
 * alongside the live board.
 */
export function summarizeGameLog(entries: GoGameLogEntry[]): GoLogSummary {
  if (entries.length === 0)
    return EMPTY_SUMMARY

  const byOpponent = new Map<string, GoGameLogEntry[]>()
  const byEngine = new Map<string, GoGameLogEntry[]>()
  for (const entry of entries) {
    const opponentList = byOpponent.get(entry.opponent) ?? []
    opponentList.push(entry)
    byOpponent.set(entry.opponent, opponentList)

    // entry.engine is absent on log lines written before this field
    // existed — group those under 'heuristic', the only engine that could
    // have written them.
    const engineKey = entry.engine ?? 'heuristic'
    const engineList = byEngine.get(engineKey) ?? []
    engineList.push(entry)
    byEngine.set(engineKey, engineList)
  }

  function summarize(rows: GoGameLogEntry[]) {
    const wins = rows.filter(r => r.result === 'win').length
    const losses = rows.filter(r => r.result === 'loss').length
    const ties = rows.length - wins - losses
    const avgMargin = rows.reduce((sum, r) => sum + (r.blackScore - r.whiteScore), 0) / rows.length
    return { wins, losses, ties, avgMargin, winRate: (wins / rows.length) * 100 }
  }

  const overall = summarize(entries)
  const avgDurationMs = entries.reduce((sum, r) => sum + r.durationMs, 0) / entries.length

  return {
    games: entries.length,
    ...overall,
    avgDurationMs,
    byOpponent: [...byOpponent.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([opponent, rows]) => ({ opponent, games: rows.length, ...summarize(rows) })),
    byEngine: [...byEngine.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([engine, rows]) => ({ engine: engine as GoEngineName, games: rows.length, ...summarize(rows) })),
  }
}
