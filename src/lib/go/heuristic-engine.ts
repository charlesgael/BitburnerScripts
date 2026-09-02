import type { NS } from '@ns'
import type { Move, MoveDecision } from './engine-types'
import { chainCanEscape, chainSizes, countChar, neighborsOf, withMoveApplied } from './board-utils'

/**
 * The proven, heuristic-only move-selection engine for the IPvGO player
 * (`../go.app.ts`) — the default engine (see that file's `-e`/
 * `--experimental` flag for the alternative). A greedy, single-turn
 * scorer, not a search: "never miss a capture, never hang a group, prefer
 * territory, don't ignore a chain fight before it's a literal atari."
 *
 * This file used to be `move-engine.ts` and, for one stretch, grew a real
 * 2-ply search on top of this same phase-1 heuristic (negamax over the
 * shortlist, modeling the opponent's best reply). That was a deliberate,
 * larger investment aimed at Daedalus/Illuminati specifically, since they
 * never moved off a 0-20% win rate across six rounds of pure heuristic
 * tuning regardless of which fix was active — the working theory being
 * that a one-step `chainCanEscape`-style correction can't out-read an
 * opponent that plans multiple moves ahead. It genuinely fixed two bugs
 * along the way (a shortlist-crowding bug, then a missing explicit
 * self-atari deterrent the search's own leaf evaluation under-punished),
 * but on a reliable ~57-games-per-opponent sample it still came out worse
 * than this plain heuristic on 5 of 6 opponents (35.3% vs 44.9%
 * overall) — the search's leaf evaluation (territory + material) was
 * simply a cruder final decision-maker than this file's own
 * six-rounds-tuned scoring, even filtered through real look-ahead. Rather
 * than keep patching the search, this file was reverted to its last
 * known-good heuristic-only state (below) and kept as the default; the
 * search's replacement, `../experimental-engine.ts`, takes a different
 * angle instead of another patch on this one — adapting the real
 * faction-AI algorithm straight from `bitburner-src` (via
 * github.com/nanogyth/go_bot's reference dump of it), including things
 * this heuristic never had at all: real eye/life detection and 3x3 joseki
 * pattern matching.
 *
 * That "don't ignore a fight" clause on captures earned its place the hard
 * way too: an initial version only ever scored a chain at the binary
 * capture-it-now/save-it-now instant (exactly 1 liberty), with zero signal
 * for one at 2-3 liberties. ~94 logged games in (see `GoGameLogEntry` in
 * `./state-file.ts`) showed a stark split — Netburners 94% win rate, but
 * 0-31% against the three toughest opponents (Illuminati/Daedalus/Tetrads),
 * and averaged across every loss vs every win: 4.4 vs 0.4 self-atari moves
 * per game, 0.09 vs 0.77 captures per move. Not "needs a different
 * algorithm per opponent" so much as "the same blind spot gets exploited
 * harder by a stronger opponent" — `pressureScore`/`reinforceScore` below
 * close it by giving a 2-3-liberty chain fight real weight in phase 1,
 * instead of only ever reacting once it's already a literal atari.
 *
 * That fix itself then regressed one round later — not just against the
 * two opponents it hadn't helped, but *overall*, below the original
 * baseline (42.6% -> 47.5% -> 36.2% across three rounds of ~94-99 logged
 * games each). Root cause: a first attempt at ruling out a hopeless chase
 * (`chainCanEscape`, now in `./board-utils.ts`) ran in phase 2, only on
 * the 12 shortlisted candidates — but the shortlist itself is cut in
 * phase 1, from scores that still included the full, not-yet-corrected
 * pressure credit. A chasing move could inflate onto the shortlist, get
 * its own score correctly cancelled back down in phase 2, and still have
 * already bumped a genuinely good move off the shortlist before that move
 * ever got evaluated at all — a per-candidate correction can cancel a bad
 * candidate's score, but it can't undo who else got excluded because of
 * it. `chainCanEscape` now runs in phase 1, before the cut, as a cheap
 * array-lookup approximation (no extra `ns.go.analysis` calls) instead of
 * a `ns.go.analysis`-based re-simulation, specifically so it's affordable
 * to run on every candidate rather than a shortlisted few.
 *
 * That round's fix recovered overall (36.2% -> 43.0%, back near the 42.6%
 * baseline) but one opponent kept getting *worse* every round regardless —
 * The Black Hand: 50% -> 56% -> 38% -> 27%, monotonically, self-atari and
 * stones-lost climbing right alongside it even after the attack-side
 * crowding-out bug was fixed. Different bug, same failure class, just on
 * defense: `reinforceScore` never had a viability check at all — it
 * credited extending *any* friendly chain at 2 liberties, even one already
 * dead, throwing good moves after a lost cause instead of taking profit
 * elsewhere. `chainCanEscape` is color-agnostic (it was always just "does
 * extending this chain to its last liberty leave it safe"), so it now
 * guards `reinforceScore` too, not only `pressureScore`.
 *
 * That guard's first cut inverted the polarity, though — copied the attack
 * side's `!chainCanEscape` verbatim instead of flipping it, so it credited
 * reinforcing a chain exactly when doing so *wouldn't* save it, and
 * withheld credit exactly when it *would*. One round of ~184 logged games
 * later: Black Hand did recover (27% -> 41%, likely just from the rest of
 * the engine being unaffected there) but Tetrads cratered further than any
 * prior round (25% -> 7%, worst margin and stones-lost yet for that
 * opponent) — systematically abandoning groups that could actually have
 * been saved. Fixed to the correct polarity: credit reinforcing only when
 * `chainCanEscape` says extending the chain actually leads to safety. That
 * fix landed cleanly — Black Hand 41%->70% and Tetrads 7%->38%, both their
 * best results across every heuristic-only round, and the state this file
 * was reverted back to after the search experiment above.
 *
 * Always assumes we are playing Black (the default for every real faction
 * opponent — `playAsWhite` on `ns.go.makeMove`/`passTurn` only exists for
 * the "No AI" sandbox opponent, which go.app.ts's default rotation never
 * selects). 'X' is always "us", 'O' is always the opponent.
 *
 * Board indexing throughout matches `ns.go.getBoardState()`: `board[x][y]`,
 * each string a column, each character in it a row.
 */

const PASS_SCORE_THRESHOLD = 0

/**
 * Picks the best move for the current player (assumed Black/'X'), or `null`
 * to signal go.app.ts should pass.
 *
 * Two-phase to keep the expensive `ns.go.analysis.*` calls (each
 * "intentionally expensive" per their own doc comments — full-board
 * flood-fills) bounded: phase 1 scores every legal move using only the
 * current board's already-computed chains/liberties/territory (cheap,
 * O(1) per candidate), then only the top `SHORTLIST_SIZE` candidates get a
 * real what-if board built and re-analyzed in phase 2.
 */
export async function pickMove(ns: NS, board: string[]): Promise<MoveDecision> {
  const size = board.length
  const validMoves = ns.go.analysis.getValidMoves()
  const chains = ns.go.analysis.getChains()
  const liberties = ns.go.analysis.getLiberties()
  const controlled = ns.go.analysis.getControlledEmptyNodes()
  const sizes = chainSizes(chains)
  const baseDelta = countChar(controlled, 'X') - countChar(controlled, 'O')

  type Candidate = Move & { phase1Score: number, captureScore: number }
  const candidates: Candidate[] = []

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (!validMoves[x]?.[y])
        continue

      let captureScore = 0
      let saveAtari = false
      let openness = 0
      // Chain-fight pressure: how urgently this move should be preferred
      // for chipping away at an enemy chain (pressureScore) or reinforcing
      // a friendly one (reinforceScore) that isn't in true atari yet but
      // is getting close (2-3 liberties). See this file's header comment
      // for the logged-game evidence that motivated this and the two
      // rounds of bugs (crowding-out, then inverted polarity) it took to
      // get right.
      let pressureScore = 0
      let reinforceScore = 0
      const seenEnemyChains = new Set<number>()
      const seenFriendlyChains = new Set<number>()

      for (const [nx, ny] of neighborsOf(size, x, y)) {
        const ch = board[nx][ny]
        if (ch === 'O') {
          const chainId = chains[nx][ny]
          if (chainId !== null && !seenEnemyChains.has(chainId)) {
            seenEnemyChains.add(chainId)
            const libs = liberties[nx][ny]
            if (libs === 1) {
              captureScore += sizes.get(chainId) ?? 1
            }
            // A chain about to be put into actual atari (libs === 2) only
            // earns pressure credit if chainCanEscape says it can't just
            // step to its remaining liberty and be safe again.
            else if (libs === 2 && !chainCanEscape(board, chains, size, chainId, 'O', [x, y])) {
              pressureScore += (4 - libs) * (sizes.get(chainId) ?? 1)
            }
            else if (libs === 3) {
              pressureScore += (4 - libs) * (sizes.get(chainId) ?? 1)
            }
          }
        }
        else if (ch === 'X') {
          const chainId = chains[nx][ny]
          if (chainId !== null && !seenFriendlyChains.has(chainId)) {
            seenFriendlyChains.add(chainId)
            const libs = liberties[nx][ny]
            if (libs === 1)
              saveAtari = true
            // Credit reinforcing only when chainCanEscape says extending
            // this chain actually leads to safety — not the other way
            // around (see this file's header comment on the polarity bug
            // this had for one round).
            else if (libs === 2 && chainCanEscape(board, chains, size, chainId, 'X', [x, y]))
              reinforceScore += sizes.get(chainId) ?? 1
          }
        }
        else if (ch === '.') {
          openness++
          if (controlled[nx]?.[ny] === '?')
            openness++
        }
      }

      const phase1Score = captureScore * 1000 + (saveAtari ? 300 : 0)
        + pressureScore * 30 + reinforceScore * 40 + openness * 2
      candidates.push({ x, y, phase1Score, captureScore })
    }
  }

  if (candidates.length === 0)
    return { move: null, selfAtari: false }

  const SHORTLIST_SIZE = 12
  const shortlist = candidates
    .sort((a, b) => b.phase1Score - a.phase1Score)
    .slice(0, SHORTLIST_SIZE)

  let best: Move | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  let bestSelfAtari = false

  for (const candidate of shortlist) {
    const { x, y, phase1Score, captureScore } = candidate
    const hypothetical = withMoveApplied(board, x, y, 'X')
    // getLiberties reports the same count for every point in a chain (see
    // its own doc comment), so reading it at [x][y] gives our new/merged
    // chain's total liberty count directly - no need for getChains here.
    const ourLiberties = ns.go.analysis.getLiberties(hypothetical)[x][y]

    // A move that actually captures is never a true suicide by Go rules —
    // the captured enemy stones become our liberties the instant the real
    // engine removes them, even though our hand-built `hypothetical` board
    // still shows them present (we never simulate captures ourselves here).
    const isSelfAtari = captureScore === 0 && ourLiberties <= 1
    const selfAtariPenalty = isSelfAtari ? 600 : 0

    const newControlled = ns.go.analysis.getControlledEmptyNodes(hypothetical)
    const newDelta = countChar(newControlled, 'X') - countChar(newControlled, 'O')
    const territoryDelta = newDelta - baseDelta

    const finalScore = phase1Score - selfAtariPenalty + territoryDelta * 15
    if (finalScore > bestScore) {
      bestScore = finalScore
      best = { x, y }
      bestSelfAtari = isSelfAtari
    }
  }

  if (best === null)
    return { move: null, selfAtari: false }

  const state = ns.go.getGameState()
  const winningComfortably = state.blackScore >= state.whiteScore
  if (bestScore <= PASS_SCORE_THRESHOLD && winningComfortably)
    return { move: null, selfAtari: false }

  return { move: best, selfAtari: bestSelfAtari }
}
