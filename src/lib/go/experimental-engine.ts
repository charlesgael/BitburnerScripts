import type { NS } from '@ns'
import type { Move, MoveDecision } from './engine-types'
import { applyMoveWithCaptures, chainCanEscape, chainSizes, neighborsOf } from './board-utils'

/**
 * An alternative move-selection engine for the IPvGO player
 * (`../go.app.ts` — pass `-e`/`--experimental` to use this instead of the
 * default `./heuristic-engine.ts`). Not a new invention — an adaptation of
 * the *real* faction-AI algorithm the actual opponents run, straight from
 * `bitburner-src`'s own source (`src/Go/boardAnalysis/goAI.ts` and
 * `patternMatching.ts`), reached via a reference dump of it at
 * github.com/nanogyth/go_bot (MIT-licensed; the underlying game logic is
 * Apache-2.0-with-Commons-Clause per that repo's own `apache_cc_LICENSE.txt`).
 *
 * Why: `./heuristic-engine.ts` never once beat Illuminati or Daedalus above
 * ~20-25%, in any of eight rounds and ~900 logged games, regardless of
 * heuristic patch (see that file's header comment for the full history) —
 * including a real 2-ply search attempt, which still came out worse
 * overall on a reliable sample. The real game's own source explains part
 * of why: Illuminati and Daedalus (90% of the time) run a specific,
 * documented priority stack — capture, then defend-from-capture, then
 * create a genuine eye/life for a group, then force a safe atari, then
 * block the opponent's own eye-creating move, then take an open corner,
 * then match one of a fixed library of 3x3 local shape patterns (hane,
 * cut, keima, etc.), then jump near a friendly stone. Two of those —
 * real eye/life detection and joseki pattern matching — are things the
 * heuristic engine never had any notion of at all; this file adds both.
 *
 * Adapted, not ported verbatim: the original tracks its own `PointState`
 * board with real per-point liberty *point sets* built from scratch every
 * move; this file instead leans on `ns.go.analysis.*`, which already gives
 * chain groupings (including grouping empty space into "chains" too — see
 * that function's own doc comment) and liberty *counts* for free. Where
 * the original needs a liberty point set this file doesn't have cheaply,
 * it calls `ns.go.analysis.getLiberties` on a real simulated board instead
 * of approximating — this is a standalone process with its own RAM budget
 * (see `go.app.ts`), not something routed through the tiered `cgd` daemon,
 * so that's an affordable trade for accuracy. The original's RNG-gated
 * personality branches (e.g. "40% chance of a jump move") are also
 * flattened into a fixed priority order — the point here is to play as
 * well as the smartest faction plays, not to imitate its occasional worse
 * choices.
 *
 * Its first round of ~177 logged games was badly worse than the heuristic
 * engine it was meant to beat (20.3% vs 44.9% overall), and self-atari
 * counts explained why — 9.81/game in losses, even 3.75/game in *wins*,
 * both multiples of the heuristic engine's own numbers. Root cause: three
 * of the priority tiers below (`findAtariMove`, `findEyeMove`,
 * `findEyeBlockMove`) never checked that the move they were about to
 * return was actually *safe for the stone playing it* — unlike
 * `findDefendCaptureMove`/`findPatternMove`/`findGrowthMove`, which all
 * correctly verify `resultingLiberties(...) > 1`. The only safety net that
 * did exist only ran while comfortably ahead on score, so it did nothing
 * during exactly the games this was meant to fix — the ones spent behind
 * against a tough opponent. All three tiers (plus the previously-unguarded
 * `disputedPoints` fallback) now verify the played stone's own resulting
 * liberties before being accepted, the same unconditional standard
 * `heuristic-engine.ts` has always held its own self-atari penalty to.
 *
 * Always assumes we are playing Black ('X'); 'O' is always the opponent.
 * Board indexing matches `ns.go.getBoardState()`: `board[x][y]`, each
 * string a column, each character a row. A dead/offline node ('#') is
 * treated the same as being off the edge of the board throughout — same
 * as the original, which represents both as `null` in its own board type.
 */

/** A dead node ('#') is treated identically to being off-board — see this file's header comment. */
function cellAt(board: string[], size: number, x: number, y: number): string | null {
  if (x < 0 || x >= size || y < 0 || y >= size)
    return null
  const ch = board[x][y]
  return ch === '#' ? null : ch
}

function opponentOf(stone: 'X' | 'O'): 'X' | 'O' {
  return stone === 'X' ? 'O' : 'X'
}

/** Every legal point for the current move, as plain coordinates. */
function collectValidPoints(validMoves: boolean[][], size: number): Move[] {
  const points: Move[] = []
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (validMoves[x]?.[y])
        points.push({ x, y })
    }
  }
  return points
}

/**
 * The real liberty count a `stone` at (x,y) would end up with, found by
 * actually simulating the move (captures included) and asking
 * `ns.go.analysis.getLiberties` — see this file's header comment on why
 * this calls out to a real what-if board instead of approximating from a
 * liberty *count* alone, which can't tell whether two touched chains would
 * newly share liberties after merging.
 */
function resultingLiberties(
  ns: NS,
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  x: number,
  y: number,
  stone: 'X' | 'O',
): number {
  const hypothetical = applyMoveWithCaptures(board, chains, liberties, x, y, stone)
  return ns.go.analysis.getLiberties(hypothetical)[x][y]
}

// ---------------------------------------------------------------------
// 1. Capture — a point that is the last liberty of an enemy chain.
// ---------------------------------------------------------------------

function findCaptureMove(
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  sizes: Map<number, number>,
  size: number,
  points: Move[],
  stone: 'X' | 'O',
): Move | null {
  const enemy = opponentOf(stone)
  let best: Move | null = null
  let bestChainSize = 0
  for (const { x, y } of points) {
    for (const [nx, ny] of neighborsOf(size, x, y)) {
      if (board[nx][ny] !== enemy || liberties[nx][ny] !== 1)
        continue
      const chainId = chains[nx][ny]
      const chainSize = chainId === null ? 1 : (sizes.get(chainId) ?? 1)
      if (chainSize > bestChainSize) {
        bestChainSize = chainSize
        best = { x, y }
      }
      break
    }
  }
  return best
}

// ---------------------------------------------------------------------
// 2. Defend capture — save one of our own chains that's in atari.
// ---------------------------------------------------------------------

function findDefendCaptureMove(
  ns: NS,
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  size: number,
  points: Move[],
  stone: 'X' | 'O',
): Move | null {
  for (const { x, y } of points) {
    let touchesAtari = false
    for (const [nx, ny] of neighborsOf(size, x, y)) {
      if (board[nx][ny] === stone && liberties[nx][ny] === 1) {
        touchesAtari = true
        break
      }
    }
    if (!touchesAtari)
      continue
    if (resultingLiberties(ns, board, chains, liberties, x, y, stone) > 1)
      return { x, y }
  }
  return null
}

// ---------------------------------------------------------------------
// 3/5. Eye creation & eye blocking — real life detection.
//
// An empty region (`ns.go.analysis.getChains` already groups continuous
// empty space into its own chain ids, same as it does stones) counts as a
// "true eye" for `color` here if every occupied point bordering it is
// `color` — i.e. no enemy stone touches it at all. That's a looser
// approximation than the original (which additionally verifies the eye is
// encircled by one single connected chain, not several disconnected
// friendly ones); this file accepts the simpler version and credits every
// friendly chain touching such a region, rather than resolving which one
// chain "really" encircles it. A chain touching 2+ such regions is
// unconditionally alive.
// ---------------------------------------------------------------------

interface EyeInfo {
  livingChains: Set<number>
  eyeRegionCount: number
}

function computeEyeInfo(board: string[], chains: (number | null)[][], size: number, color: 'X' | 'O'): EyeInfo {
  const enemy = opponentOf(color)
  const eyeRegionsSeen = new Set<number>()
  const eyeCountByChain = new Map<number, number>()
  const regionOwners = new Map<number, Set<number>>() // empty-chain id -> friendly chain ids bordering it

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (board[x][y] !== '.')
        continue
      const regionId = chains[x][y]
      if (regionId === null || regionOwners.has(regionId))
        continue

      let touchesEnemy = false
      const borderingFriendlyChains = new Set<number>()
      // Flood the whole empty region once (not just this cell's own
      // neighbors) so a big open area is only evaluated a single time.
      const stack: [number, number][] = [[x, y]]
      const visited = new Set<number>([x * size + y])
      while (stack.length > 0) {
        const [cx, cy] = stack.pop() as [number, number]
        for (const [nx, ny] of neighborsOf(size, cx, cy)) {
          const ch = board[nx][ny]
          if (ch === '.') {
            const key = nx * size + ny
            if (!visited.has(key) && chains[nx][ny] === regionId) {
              visited.add(key)
              stack.push([nx, ny])
            }
          }
          else if (ch === enemy) {
            touchesEnemy = true
          }
          else if (ch === color) {
            const chainId = chains[nx][ny]
            if (chainId !== null)
              borderingFriendlyChains.add(chainId)
          }
        }
      }

      regionOwners.set(regionId, borderingFriendlyChains)
      if (!touchesEnemy && borderingFriendlyChains.size > 0)
        eyeRegionsSeen.add(regionId)
    }
  }

  for (const regionId of eyeRegionsSeen) {
    for (const chainId of regionOwners.get(regionId) ?? [])
      eyeCountByChain.set(chainId, (eyeCountByChain.get(chainId) ?? 0) + 1)
  }

  const livingChains = new Set<number>()
  for (const [chainId, count] of eyeCountByChain) {
    if (count >= 2)
      livingChains.add(chainId)
  }

  return { livingChains, eyeRegionCount: eyeRegionsSeen.size }
}

/**
 * Candidate points for `findEyeMove`/`findEyeBlockMove` — points adjacent
 * to a `color` chain of more than one stone (matches the original: a lone
 * single stone isn't worth building eye shape around yet), restricted to
 * `points` (our own legal moves).
 */
function eyeCandidatePoints(
  board: string[],
  chains: (number | null)[][],
  sizes: Map<number, number>,
  size: number,
  points: Move[],
  color: 'X' | 'O',
): Move[] {
  const candidates: Move[] = []
  for (const { x, y } of points) {
    for (const [nx, ny] of neighborsOf(size, x, y)) {
      if (board[nx][ny] !== color)
        continue
      const chainId = chains[nx][ny]
      if (chainId !== null && (sizes.get(chainId) ?? 1) > 1) {
        candidates.push({ x, y })
        break
      }
    }
  }
  return candidates
}

function findEyeMove(
  ns: NS,
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  sizes: Map<number, number>,
  size: number,
  points: Move[],
  color: 'X' | 'O',
): Move | null {
  const candidates = eyeCandidatePoints(board, chains, sizes, size, points, color)
  if (candidates.length === 0)
    return null

  const before = computeEyeInfo(board, chains, size, color)
  let best: Move | null = null
  let bestCreatesLife = false

  for (const { x, y } of candidates) {
    const hypothetical = applyMoveWithCaptures(board, chains, liberties, x, y, color)
    const afterChains = ns.go.analysis.getChains(hypothetical)
    const afterLiberties = ns.go.analysis.getLiberties(hypothetical)
    // An eye-building move that leaves the stone that builds it in atari
    // defeats its own purpose — verified directly here (unlike
    // findAtariMove, which reuses the shared resultingLiberties helper,
    // this already has the hypothetical board's real liberties on hand).
    if (afterLiberties[x][y] <= 1)
      continue
    const after = computeEyeInfo(hypothetical, afterChains, size, color)

    const createsLife = after.livingChains.size > before.livingChains.size
    const addsEye = after.eyeRegionCount > before.eyeRegionCount && after.livingChains.size === before.livingChains.size

    if (createsLife && (!best || !bestCreatesLife)) {
      best = { x, y }
      bestCreatesLife = true
    }
    else if (addsEye && !best) {
      best = { x, y }
    }
  }

  return best
}

/** If the opponent has exactly one move that would give them life (or, failing that, exactly one that adds any eye), block it. */
function findEyeBlockMove(
  ns: NS,
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  sizes: Map<number, number>,
  size: number,
  points: Move[],
  stone: 'X' | 'O',
): Move | null {
  const enemy = opponentOf(stone)
  const candidates = eyeCandidatePoints(board, chains, sizes, size, points, enemy)
  if (candidates.length === 0)
    return null

  const before = computeEyeInfo(board, chains, size, enemy)
  const lifeMoves: Move[] = []
  const eyeMoves: Move[] = []

  for (const { x, y } of candidates) {
    // This checks what happens if the *opponent* played here (to see
    // whether it's actually worth blocking) — separate from, and not a
    // substitute for, verifying that *our own* stone is safe if we play
    // there instead, checked just below.
    const hypothetical = applyMoveWithCaptures(board, chains, liberties, x, y, enemy)
    const afterChains = ns.go.analysis.getChains(hypothetical)
    const after = computeEyeInfo(hypothetical, afterChains, size, enemy)
    const isLifeMove = after.livingChains.size > before.livingChains.size
    const isEyeMove = after.eyeRegionCount > before.eyeRegionCount
    if (!isLifeMove && !isEyeMove)
      continue

    if (resultingLiberties(ns, board, chains, liberties, x, y, stone) <= 1)
      continue

    if (isLifeMove)
      lifeMoves.push({ x, y })
    else
      eyeMoves.push({ x, y })
  }

  if (lifeMoves.length === 1)
    return lifeMoves[0]
  if (lifeMoves.length === 0 && eyeMoves.length === 1)
    return eyeMoves[0]
  return null
}

// ---------------------------------------------------------------------
// 4. Atari — force a response on an enemy chain that can't escape.
// ---------------------------------------------------------------------

function findAtariMove(
  ns: NS,
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  size: number,
  points: Move[],
  stone: 'X' | 'O',
): Move | null {
  const enemy = opponentOf(stone)
  for (const { x, y } of points) {
    let targetsEscapelessChain = false
    for (const [nx, ny] of neighborsOf(size, x, y)) {
      if (board[nx][ny] !== enemy || liberties[nx][ny] !== 2)
        continue
      const chainId = chains[nx][ny]
      if (chainId !== null && !chainCanEscape(board, chains, size, chainId, enemy, [x, y])) {
        targetsEscapelessChain = true
        break
      }
    }
    // Forcing an atari is worthless if the forcing stone itself ends up in
    // atari (or worse) — verified here, unlike the other tiers below that
    // don't need it (a capture is never suicide, and eyeMove/eyeBlock
    // check their own placed stone's safety directly).
    if (targetsEscapelessChain && resultingLiberties(ns, board, chains, liberties, x, y, stone) > 1)
      return { x, y }
  }
  return null
}

// ---------------------------------------------------------------------
// 6. Corner — an opening move into a still-fully-empty corner.
// ---------------------------------------------------------------------

function findCornerMove(board: string[], size: number, points: Move[]): Move | null {
  if (size < 5)
    return null
  const edge = size - 1
  const near = size - 3
  const corners: [Move, [number, number, number, number]][] = [
    [{ x: near, y: near }, [near, near, edge, edge]],
    [{ x: 2, y: near }, [0, near, 2, edge]],
    [{ x: 2, y: 2 }, [0, 0, 2, 2]],
    [{ x: near, y: 2 }, [near, 0, edge, 2]],
  ]

  for (const [point, [x1, y1, x2, y2]] of corners) {
    if (!points.some(p => p.x === point.x && p.y === point.y))
      continue
    let liveCount = 0
    let stoneCount = 0
    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
        const ch = cellAt(board, size, x, y)
        if (ch === null)
          continue
        liveCount++
        if (ch !== '.')
          stoneCount++
      }
    }
    if (liveCount >= 7 && stoneCount === 0)
      return point
  }
  return null
}

// ---------------------------------------------------------------------
// 7. Pattern — 3x3 local joseki shapes, straight from bitburner-src's
// patternMatching.ts (see this file's header comment for provenance).
// 'X'/'O' below are relative to whichever color is asking (mine/enemy),
// not literally black/white.
// ---------------------------------------------------------------------

const THREE_BY_THREE_PATTERNS: readonly string[][] = [
  ['XOX', '...', '???'], // hane - enclosing hane
  ['XO.', '...', '?.?'], // hane - non-cutting hane
  ['XO?', 'X..', 'o.?'], // hane - magari
  ['.O.', 'X..', '...'], // diagonal attachment (katatsuke)
  ['XO?', 'O.x', '?x?'], // cut - unprotected
  ['XO?', 'O.X', '???'], // cut - peeped
  ['?X?', 'O.O', 'xxx'], // cut - de
  ['OX?', 'x.O', '???'], // cut - keima
  ['X.?', 'O.?', '   '], // side - chase
  ['OX?', 'X.O', '   '], // side - block cut
  ['?X?', 'o.O', '   '], // side - block connection
  ['?XO', 'o.o', '   '], // side - sagari
  ['?OX', 'X.O', '   '], // side - cut
]

function rotate90(pattern: readonly string[]): string[] {
  return [
    `${pattern[2][0]}${pattern[1][0]}${pattern[0][0]}`,
    `${pattern[2][1]}${pattern[1][1]}${pattern[0][1]}`,
    `${pattern[2][2]}${pattern[1][2]}${pattern[0][2]}`,
  ]
}

function verticalMirror(pattern: readonly string[]): string[] {
  return [pattern[2], pattern[1], pattern[0]]
}

function horizontalMirror(pattern: readonly string[]): string[] {
  return pattern.map(row => row.split('').reverse().join(''))
}

/** All rotations x mirrors of every base pattern — computed once and cached, same as the original's own `expandAllThreeByThreePatterns`. */
let expandedPatterns: string[][] | null = null
function getExpandedPatterns(): string[][] {
  if (expandedPatterns)
    return expandedPatterns
  const rotations = [
    ...THREE_BY_THREE_PATTERNS,
    ...THREE_BY_THREE_PATTERNS.map(rotate90),
    ...THREE_BY_THREE_PATTERNS.map(rotate90).map(rotate90),
    ...THREE_BY_THREE_PATTERNS.map(rotate90).map(rotate90).map(rotate90),
  ]
  const mirroredV = [...rotations, ...rotations.map(verticalMirror)]
  expandedPatterns = [...mirroredV, ...mirroredV.map(horizontalMirror)]
  return expandedPatterns
}

/**
 * `X` mine-only, `O` enemy-only, `x` anything-but-enemy, `o`
 * anything-but-mine, `.` empty only, ` ` off-board/dead only, `?` anything.
 */
function matchesPatternChar(patternChar: string, cell: string | null, mine: 'X' | 'O'): boolean {
  const enemy = opponentOf(mine)
  switch (patternChar) {
    case 'X': return cell === mine
    case 'O': return cell === enemy
    case 'x': return cell !== enemy
    case 'o': return cell !== mine
    case '.': return cell === '.'
    case ' ': return cell === null
    case '?': return true
    default: return false
  }
}

function checkPatternMatch(neighborhood: (string | null)[], pattern: readonly string[], mine: 'X' | 'O'): boolean {
  const flat = pattern.join('').split('')
  return flat.every((ch, i) => matchesPatternChar(ch, neighborhood[i], mine))
}

function findPatternMove(
  ns: NS,
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  size: number,
  points: Move[],
  stone: 'X' | 'O',
): Move | null {
  const patterns = getExpandedPatterns()
  const pointSet = new Set(points.map(p => p.x * size + p.y))
  const matches: Move[] = []

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (!pointSet.has(x * size + y))
        continue
      const neighborhood = [
        cellAt(board, size, x - 1, y - 1),
        cellAt(board, size, x - 1, y),
        cellAt(board, size, x - 1, y + 1),
        cellAt(board, size, x, y - 1),
        cellAt(board, size, x, y),
        cellAt(board, size, x, y + 1),
        cellAt(board, size, x + 1, y - 1),
        cellAt(board, size, x + 1, y),
        cellAt(board, size, x + 1, y + 1),
      ]
      if (patterns.some(pattern => checkPatternMatch(neighborhood, pattern, stone))) {
        // A matched pattern is only worth playing if it doesn't leave us
        // in immediate self-atari — the original checks this too
        // ("!smart || findEffectiveLibertiesOfNewMove... > 1").
        if (resultingLiberties(ns, board, chains, liberties, x, y, stone) > 1)
          matches.push({ x, y })
      }
    }
  }
  return matches.length > 0 ? matches[0] : null
}

// ---------------------------------------------------------------------
// 8/9/10. Jump, growth, expansion — general-purpose fallbacks.
// ---------------------------------------------------------------------

/** An empty point with all 4 neighbors empty too — open space worth staking out. */
function findExpansionCandidates(board: string[], size: number, points: Move[]): Move[] {
  return points.filter(({ x, y }) =>
    neighborsOf(size, x, y).every(([nx, ny]) => board[nx][ny] === '.'),
  )
}

/** An open point ~2 spaces from a friendly stone — extends influence without directly touching. */
function findJumpMove(board: string[], size: number, points: Move[], stone: 'X' | 'O', expansionPoints: Move[]): Move | null {
  const pool = expansionPoints.length > 0 ? expansionPoints : points
  for (const { x, y } of pool) {
    const twoAway: [number, number][] = [[x, y + 2], [x + 2, y], [x, y - 2], [x - 2, y]]
    if (twoAway.some(([nx, ny]) => cellAt(board, size, nx, ny) === stone))
      return { x, y }
  }
  return null
}

/** The first point in `candidates` that doesn't leave the played stone in atari, or `null` if none qualify. */
function firstSafe(
  ns: NS,
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  candidates: Move[],
  stone: 'X' | 'O',
): Move | null {
  for (const { x, y } of candidates) {
    if (resultingLiberties(ns, board, chains, liberties, x, y, stone) > 1)
      return { x, y }
  }
  return null
}

/** The valid move that increases a friendly chain's liberties the most. */
function findGrowthMove(
  ns: NS,
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  size: number,
  points: Move[],
  stone: 'X' | 'O',
): Move | null {
  let best: Move | null = null
  let bestGain = 0
  for (const { x, y } of points) {
    let oldLibs = 0
    let touchesFriendly = false
    for (const [nx, ny] of neighborsOf(size, x, y)) {
      if (board[nx][ny] === stone) {
        touchesFriendly = true
        oldLibs = Math.max(oldLibs, liberties[nx][ny])
      }
    }
    if (!touchesFriendly)
      continue
    const newLibs = resultingLiberties(ns, board, chains, liberties, x, y, stone)
    const gain = newLibs - oldLibs
    if (newLibs > 1 && gain > bestGain) {
      bestGain = gain
      best = { x, y }
    }
  }
  return best
}

// ---------------------------------------------------------------------

export async function pickMove(ns: NS, board: string[]): Promise<MoveDecision> {
  const size = board.length
  const validMoves = ns.go.analysis.getValidMoves()
  const chains = ns.go.analysis.getChains()
  const liberties = ns.go.analysis.getLiberties()
  const controlled = ns.go.analysis.getControlledEmptyNodes()
  const sizes = chainSizes(chains)

  const points = collectValidPoints(validMoves, size)
  if (points.length === 0)
    return { move: null, selfAtari: false }

  const stone: 'X' | 'O' = 'X'

  const expansionPoints = findExpansionCandidates(board, size, points)
  const disputedPoints = points.filter(({ x, y }) => controlled[x]?.[y] === '?')

  const move
    = findCaptureMove(board, chains, liberties, sizes, size, points, stone)
      ?? findDefendCaptureMove(ns, board, chains, liberties, size, points, stone)
      ?? findEyeMove(ns, board, chains, liberties, sizes, size, points, stone)
      ?? findAtariMove(ns, board, chains, liberties, size, points, stone)
      ?? findEyeBlockMove(ns, board, chains, liberties, sizes, size, points, stone)
      ?? findCornerMove(board, size, points)
      ?? findPatternMove(ns, board, chains, liberties, size, points, stone)
      ?? findJumpMove(board, size, points, stone, expansionPoints)
      ?? findGrowthMove(ns, board, chains, liberties, size, points, stone)
      // expansionPoints (all 4 neighbors empty) are inherently safe by
      // construction, so those don't need firstSafe's check — but
      // disputedPoints (any contested point, no safety guarantee at all)
      // do, and skipping that check here was the main source of this
      // engine's very first round's inflated self-atari count, especially
      // in the long, heavily-contested endgames where expansionPoints
      // runs dry and this was the only fallback left.
      ?? (expansionPoints[0] ?? null)
      ?? firstSafe(ns, board, chains, liberties, disputedPoints, stone)

  const state = ns.go.getGameState()
  const winningComfortably = state.blackScore >= state.whiteScore

  if (!move) {
    // Nothing constructive left. Only pass while comfortably ahead —
    // same "never resign while behind" philosophy as the heuristic engine.
    if (winningComfortably || points.length === 0)
      return { move: null, selfAtari: false }
    const last = firstSafe(ns, board, chains, liberties, points, stone) ?? points[0]
    return { move: last, selfAtari: resultingLiberties(ns, board, chains, liberties, last.x, last.y, stone) <= 1 }
  }

  // resultingLiberties already simulates real captures (via
  // applyMoveWithCaptures), so — unlike a bare liberty-count comparison on
  // an unadjusted board — a capturing move's resulting liberty count is
  // already accurate here; no separate "was this a capture" exclusion
  // needed the way heuristic-engine's cheaper approximation requires.
  const finalLiberties = resultingLiberties(ns, board, chains, liberties, move.x, move.y, stone)
  const isSelfAtari = finalLiberties <= 1

  if (isSelfAtari && winningComfortably && (expansionPoints.length > 0 || disputedPoints.length > 0)) {
    // A genuinely better, non-self-atari option existed in the general
    // fallback pool and we're already ahead — take it instead, same
    // deterrent the heuristic engine applies explicitly (see
    // `heuristic-engine.ts`'s `SELF_ATARI_PENALTY`-equivalent reasoning).
    const safer = expansionPoints[0] ?? disputedPoints[0]
    return { move: safer, selfAtari: false }
  }

  return { move, selfAtari: isSelfAtari }
}
