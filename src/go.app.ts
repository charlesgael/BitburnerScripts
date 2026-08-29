import type { NS } from '@ns'
import type { GoEngineName, GoGameLogEntry, GoLiveState } from './go/state-file'
import { pickMove as pickExperimentalMove } from './go/experimental-engine'
import { pickMove as pickHeuristicMove } from './go/heuristic-engine'
import { GO_GAME_LOG_FILE, GO_LIVE_STATE_FILE, GO_LIVE_STATE_MAX_EVENTS } from './go/state-file'
import { arg, parseArgs } from './utils/args'

/**
 * Autonomous IPvGO player. A persistent loop (spawned from the Programs app
 * — see `ui/apps/programs/index.ts` — or run directly from the terminal),
 * not a one-shot report, hence living at the root as `go.app.ts` rather
 * than under `src/daemons/` (see CLAUDE.md's daemon-classification note:
 * `flooder.app.ts` is the same shape — a root `*.app.ts` that loops
 * forever once launched).
 *
 * Default behavior (no args): rotates through every real faction opponent
 * in turn, playing one game to completion against each before moving to
 * the next, forever — spreading win-streak rep/favor/stat-bonus gains
 * (`ns.go.analysis.getStats()`) across all of them rather than farming just
 * one. `ROTATION` deliberately excludes "No AI": it has no rep/favor to
 * gain and this loop always plays Black, which "No AI" (a hotseat sandbox
 * meant for the player to play both sides) doesn't really suit.
 *
 * Args, parsed via `./utils/args.ts` (`run go.app.js --help` for the
 * generated menu): `-e`/`--experimental` swaps the move-selection engine
 * from the default `./go/heuristic-engine.ts` to `./go/experimental-engine.ts`
 * — see the latter's own header comment for what it actually does
 * differently. Two further *positional* args (both optional, after any
 * flags): `opponent` — pins the loop to a single named opponent instead of
 * rotating (any `GoOpponent` string, including "No AI" for manual testing
 * — see `ALL_OPPONENTS`); `boardSize` — one of 5/7/9/13, defaults to 7 as
 * a reasonable compute-cost/rep-per-game middle ground (not a
 * verified-optimal meta pick — tune freely). Example:
 * `run go.app.js --experimental "Illuminati" 9`.
 *
 * Move selection itself lives in one of the two engine files above — kept
 * separate from the game-loop plumbing here so either can be read (and
 * iterated on) independently, and so this file can run both behind the
 * same `PickMove` interface (`./go/engine-types.ts`) and record which one
 * produced each logged game (`GoGameLogEntry.engine`) for later
 * comparison.
 *
 * Every turn this also overwrites `GO_LIVE_STATE_FILE` — a lightweight
 * snapshot the `ui/apps/go/` sidebar panel polls to show a live board,
 * without that panel (or the tiered `cgd` daemon it reads through) ever
 * needing to reference `ns.go.*` itself. And every *completed* game appends
 * one line to `GO_GAME_LOG_FILE` — win/loss, score margin, move/pass/
 * capture counts, self-atari count, duration — so the move-engine heuristic
 * can actually be evaluated over time instead of going on vibes. Both file
 * formats/constants live in `./go/state-file.ts`, shared with the UI panel.
 */

// Not `export`ed by NetscriptDefinitions.d.ts despite being `@public` there
// (a regeneration quirk — see NS['go']), so derived from the real method's
// return type instead of hand-copied, to stay correct if the game ever
// adds an opponent.
type GoOpponent = ReturnType<NS['go']['getOpponent']>
type BoardSize = 5 | 7 | 9 | 13

const ALL_OPPONENTS: readonly GoOpponent[] = [
  `No AI`,
  `Netburners`,
  `Slum Snakes`,
  `The Black Hand`,
  `Tetrads`,
  `Daedalus`,
  `Illuminati`,
  `????????????`,
]

const ROTATION: readonly GoOpponent[] = ALL_OPPONENTS.filter(o => o !== `No AI`)

const DEFAULT_BOARD_SIZE: BoardSize = 7
const BOARD_SIZES: readonly BoardSize[] = [5, 7, 9, 13]

// Brief pause after an unexpected error so a persistent failure (e.g. some
// unhandled board state) turns into a slow retry loop instead of a tight
// spin that floods the script's log / eats CPU.
const ERROR_BACKOFF = 3000

// Bounds GO_GAME_LOG_FILE's growth over a long-running/idle session: every
// this-many completed games, trim it back down to the most recent
// GAME_LOG_MAX_ENTRIES lines rather than letting it grow forever. Checked
// by game count, not every game, so the (still cheap, but non-zero) read
// + rewrite only happens occasionally.
const GAME_LOG_TRIM_INTERVAL = 25
const GAME_LOG_MAX_ENTRIES = 500

function parseGoArgs(ns: NS): { boardSize: BoardSize, engine: GoEngineName, rotation: string[], notify: boolean } {
  const flags = parseArgs(ns, [
    { long: 'experimental', defaultValue: false, description: 'Use the experimental (real-faction-AI-inspired) move engine instead of the default heuristic one' },
    { long: 'netburners', defaultValue: false, description: 'Vs Netburners (82%)' },
    { long: 'snakes', defaultValue: false, description: `Vs Slum Snakes (63%)` },
    { long: 'blackhand', defaultValue: false, description: `Vs The Black Hand (49%)` },
    { long: 'tetrads', defaultValue: false, description: `Vs Tetrads (20%)` },
    { long: 'daedalus', defaultValue: false, description: `Vs Daedalus (24%)` },
    { long: 'illluminati', defaultValue: false, description: `Vs Illuminati (5%)` },
    { long: 'notify', defaultValue: false, description: 'Notify for each game ended', short: 'n' },
  ] as const)

  let rotation: string[] = Object.entries({
    'Netburners': flags.netburners,
    'Slum Snakes': flags.snakes,
    'The Black Hand': flags.blackhand,
    'Tetrads': flags.tetrads,
    'Daedalus': flags.daedalus,
    'Illuminati': flags.illluminati,
  }).filter(([,val]) => val).map(([key]) => key)
  if (!rotation.length)
    rotation = [...ROTATION]
  const engine: GoEngineName = flags.experimental ? 'experimental' : 'heuristic'

  const boardArg = flags._[1] !== undefined ? Number(flags._[1]) : DEFAULT_BOARD_SIZE
  const boardSize = (BOARD_SIZES as readonly number[]).includes(boardArg) ? boardArg as BoardSize : DEFAULT_BOARD_SIZE

  return { boardSize, engine, rotation, notify: flags.notify }
}

function countStones(board: string[], stone: 'X' | 'O'): number {
  let count = 0
  for (const column of board) {
    for (const ch of column) {
      if (ch === stone)
        count++
    }
  }
  return count
}

/** Keeps GO_GAME_LOG_FILE from growing without bound over a long session. */
function trimGameLogIfNeeded(ns: NS, gamesPlayed: number) {
  if (gamesPlayed % GAME_LOG_TRIM_INTERVAL !== 0)
    return
  const raw = ns.read(GO_GAME_LOG_FILE)
  if (!raw)
    return
  const lines = raw.split(`\n`).filter(l => l.trim())
  if (lines.length <= GAME_LOG_MAX_ENTRIES)
    return
  ns.write(GO_GAME_LOG_FILE, `${lines.slice(-GAME_LOG_MAX_ENTRIES).join(`\n`)}\n`, `w`)
}

export async function main(ns: NS) {
  ns.disableLog(`ALL`)

  // Only one live IPvGO game exists at a time (it's account-global state,
  // not per-host) — refuse to run alongside another instance, the same
  // defense-in-depth `daemons/xp-farm.daemon.ts` uses, so a manual
  // `run go.app.js` from the terminal can't end up fighting the
  // Programs-app-launched instance over the same game.
  const dupe = ns.ps(`home`).find(p => p.filename === ns.getScriptName() && p.pid !== ns.pid)
  if (dupe) {
    ns.tprint(`WARNING: go.app.js is already running (pid ${dupe.pid}) - exiting.`)
    return
  }

  const { rotation, boardSize, engine, notify } = parseGoArgs(ns)
  const pickMove = engine === 'experimental' ? pickExperimentalMove : pickHeuristicMove
  let rotationIndex = 0
  let gamesPlayed = 0

  // Rolling feed the liveboard panel shows underneath the board — most
  // recent last, capped so the state file (rewritten every turn) stays
  // small. History beyond this belongs in GO_GAME_LOG_FILE, not here.
  const recentEvents: string[] = []
  function pushEvent(message: string) {
    const stamp = new Date().toLocaleTimeString(undefined, { hour12: false })
    recentEvents.push(`[${stamp}] ${message}`)
    if (recentEvents.length > GO_LIVE_STATE_MAX_EVENTS)
      recentEvents.shift()
  }

  function writeLiveState(board: string[], opponent: GoOpponent, lastMove: [number, number] | null) {
    const state = ns.go.getGameState()
    const live: GoLiveState = {
      updatedAt: Date.now(),
      opponent,
      boardSize: board.length,
      board,
      currentPlayer: state.currentPlayer,
      blackScore: state.blackScore,
      whiteScore: state.whiteScore,
      komi: state.komi,
      lastMove,
      recentEvents: [...recentEvents],
      engine,
    }
    ns.write(GO_LIVE_STATE_FILE, JSON.stringify(live), `w`)
  }

  // Per-game tallies feeding GO_GAME_LOG_FILE — reset at the top of every
  // new game (resetGameStats), read out in recordGameOver.
  let moves = 0
  let passes = 0
  let captures = 0
  let lostStones = 0
  let selfAtariMoves = 0
  let gameStartedAt = Date.now()

  function resetGameStats() {
    moves = 0
    passes = 0
    captures = 0
    lostStones = 0
    selfAtariMoves = 0
    gameStartedAt = Date.now()
  }

  function recordGameOver(notify: boolean) {
    const opponent = ns.go.getOpponent()
    const { blackScore, whiteScore } = ns.go.getGameState()
    const result: GoGameLogEntry[`result`] = blackScore > whiteScore ? `win` : blackScore < whiteScore ? `loss` : `tie`
    const summary = `Black ${blackScore.toFixed(1)} - White ${whiteScore.toFixed(1)}`
    const resultLabel = result === `win` ? `WON` : result === `loss` ? `lost` : `tied`

    ns.print(`Game vs ${opponent} over - ${resultLabel} (${summary}).`)
    pushEvent(`Game vs ${opponent} over - ${resultLabel} (${summary}).`)
    if (notify) {
      ns.toast(
        `IPvGO vs ${opponent}: ${resultLabel} (${summary})`,
        result === `win` ? `success` : result === `loss` ? `warning` : `info`,
        5000,
      )
    }

    const entry: GoGameLogEntry = {
      timestamp: Date.now(),
      opponent,
      boardSize,
      result,
      blackScore,
      whiteScore,
      moves,
      passes,
      captures,
      lostStones,
      selfAtariMoves,
      durationMs: Date.now() - gameStartedAt,
      engine,
    }
    ns.write(GO_GAME_LOG_FILE, `${JSON.stringify(entry)}\n`, `a`)
    gamesPlayed++
    trimGameLogIfNeeded(ns, gamesPlayed)
  }

  ns.print(`Started (${engine} engine) - playing on a ${boardSize}x${boardSize} board for rep/favor.`)

  while (true) {
    try {
      let state = ns.go.getGameState()

      if (state.currentPlayer === `None`) {
        const opponent = rotation[rotationIndex % rotation.length]
        rotationIndex++
        ns.print(`Starting new game vs ${opponent} (${boardSize}x${boardSize}).`)
        pushEvent(`Starting new game vs ${opponent} (${boardSize}x${boardSize}).`)
        ns.go.resetBoardState(opponent as any, boardSize)
        resetGameStats()
        state = ns.go.getGameState()
      }

      let lastMove: [number, number] | null = null

      if (state.currentPlayer === `White`) {
        // We only ever play Black, so "White to move" here means we're
        // resuming a game where we're waiting on the opponent's reply
        // (e.g. Bitburner was closed mid-exchange) rather than a fresh
        // state after our own makeMove/passTurn, which already awaits
        // that reply itself. Nudges them forward instead of spinning.
        const result = await ns.go.opponentNextTurn()
        if (result.type === `move` && result.x !== null && result.y !== null) {
          lastMove = [result.x, result.y]
          pushEvent(`(resume) Opponent played (${result.x},${result.y}).`)
        }
        else if (result.type === `pass`) {
          pushEvent(`(resume) Opponent passed.`)
        }
        if (result.type === `gameOver`)
          recordGameOver(notify)
      }
      else {
        const board = ns.go.getBoardState()
        const decision = await pickMove(ns, board)
        const result = decision.move
          ? await ns.go.makeMove(decision.move.x, decision.move.y)
          : await ns.go.passTurn()

        moves += decision.move ? 1 : 0
        passes += decision.move ? 0 : 1
        selfAtariMoves += decision.selfAtari ? 1 : 0

        // Ground-truth capture counts via a real before/after board diff,
        // rather than trusting pickMove's own (correct, but
        // pre-opponent-reply) capture prediction — see MoveDecision's doc
        // comment in go/engine-types.ts. `oBefore - oAfter + added` recovers
        // how many O stones vanished specifically because of *our* move
        // (the opponent's own placement, if any, only ever adds one O
        // stone, never removes their own) — see this function's sibling
        // derivation for lostStones just below.
        const afterBoard = ns.go.getBoardState()
        const opponentPlaced = result.type === `move` ? 1 : 0
        captures += Math.max(0, countStones(board, `O`) - countStones(afterBoard, `O`) + opponentPlaced)
        const wePlaced = decision.move ? 1 : 0
        lostStones += Math.max(0, countStones(board, `X`) + wePlaced - countStones(afterBoard, `X`))

        pushEvent(decision.move
          ? `Played (${decision.move.x},${decision.move.y})${decision.selfAtari ? ` (accepted self-atari)` : ``}.`
          : `Passed.`)
        if (result.type === `move` && result.x !== null && result.y !== null) {
          lastMove = [result.x, result.y]
          pushEvent(`Opponent played (${result.x},${result.y}).`)
        }
        else if (result.type === `pass`) {
          pushEvent(`Opponent passed.`)
        }

        if (result.type === `gameOver`)
          recordGameOver(notify)
      }

      writeLiveState(ns.go.getBoardState(), ns.go.getOpponent(), lastMove)
    }
    catch (e) {
      ns.print(`ERROR: ${e} - passing this turn and retrying.`)
      try {
        await ns.go.passTurn()
      }
      catch {
        // Nothing sensible left to do if even passing fails - back off
        // and let the next loop iteration re-read game state fresh.
      }
      await ns.sleep(ERROR_BACKOFF)
    }
  }
}
