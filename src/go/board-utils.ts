/**
 * Pure, `ns`-free board/chain helpers shared by both move-selection engines
 * (`./heuristic-engine.ts`, `./experimental-engine.ts`). Board indexing
 * throughout matches `ns.go.getBoardState()`: `board[x][y]`, each string a
 * column, each character in it a row.
 */

/** 4-neighbor offsets — IPvGO has no diagonal adjacency. */
const NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && x < size && y >= 0 && y < size
}

export function neighborsOf(size: number, x: number, y: number): [number, number][] {
  const result: [number, number][] = []
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx
    const ny = y + dy
    if (inBounds(size, nx, ny))
      result.push([nx, ny])
  }
  return result
}

/** Counts how many points on `chains` carry a given (non-null) chain id. */
export function chainSizes(chains: (number | null)[][]): Map<number, number> {
  const sizes = new Map<number, number>()
  for (const column of chains) {
    for (const id of column) {
      if (id === null)
        continue
      sizes.set(id, (sizes.get(id) ?? 0) + 1)
    }
  }
  return sizes
}

/** Deep-copies a board and applies a single stone placement — no capture removal, see `applyMoveWithCaptures` for that. */
export function withMoveApplied(board: string[], x: number, y: number, stone: 'X' | 'O'): string[] {
  const next = [...board]
  const column = next[x].split('')
  column[y] = stone
  next[x] = column.join('')
  return next
}

/**
 * Places `stone` at (x,y) and removes any adjacent enemy chain whose
 * liberty count — read from the passed-in `chains`/`liberties`, i.e. the
 * board's state *before* this move — was exactly 1. `withMoveApplied`
 * alone (a bare placement, captures left on the board) is fine for a
 * single what-if liberty check; use this instead whenever the resulting
 * board needs to reflect real captures, not just the new stone sitting
 * next to stones that would actually already be gone.
 */
export function applyMoveWithCaptures(
  board: string[],
  chains: (number | null)[][],
  liberties: number[][],
  x: number,
  y: number,
  stone: 'X' | 'O',
): string[] {
  const enemy = stone === 'X' ? 'O' : 'X'
  const size = board.length
  const removeChainIds = new Set<number>()
  for (const [nx, ny] of neighborsOf(size, x, y)) {
    if (board[nx][ny] !== enemy)
      continue
    const chainId = chains[nx][ny]
    if (chainId !== null && liberties[nx][ny] === 1)
      removeChainIds.add(chainId)
  }

  const next = withMoveApplied(board, x, y, stone)
  if (removeChainIds.size === 0)
    return next

  const columns = next.map(column => column.split(''))
  for (let cx = 0; cx < size; cx++) {
    for (let cy = 0; cy < size; cy++) {
      const chainId = chains[cx][cy]
      if (chainId !== null && removeChainIds.has(chainId))
        columns[cx][cy] = '.'
    }
  }
  return columns.map(column => column.join(''))
}

/**
 * Finds one empty point adjacent to any `stone`-colored member of
 * `chainId` on `board`, other than `exclude` — used to locate a chain's
 * one remaining liberty once a candidate move has filled its other one.
 * Only ever called for a chain measured at exactly 2 liberties pre-move,
 * so there's exactly one such point left to find (order doesn't matter).
 */
export function findLibertyPoint(
  board: string[],
  chains: (number | null)[][],
  size: number,
  chainId: number,
  stone: 'X' | 'O',
  exclude: readonly [number, number],
): [number, number] | null {
  for (let cx = 0; cx < size; cx++) {
    for (let cy = 0; cy < size; cy++) {
      if (board[cx][cy] !== stone || chains[cx][cy] !== chainId)
        continue
      for (const [nx, ny] of neighborsOf(size, cx, cy)) {
        if (board[nx][ny] === '.' && (nx !== exclude[0] || ny !== exclude[1]))
          return [nx, ny]
      }
    }
  }
  return null
}

/**
 * Cheap, zero-`ns.go.analysis`-call proxy for "if this 2-liberty chain gets
 * extended to its one remaining liberty, does it end up safe again (2+
 * fresh liberties)?" — pure lookups on already-fetched `board`/`chains`
 * data, so it's affordable to run for every candidate a caller considers,
 * not just a shortlisted few (see `heuristic-engine.ts`'s own history with
 * this: a `ns.go.analysis`-based re-simulation done only on a shortlist
 * let a bad candidate crowd a genuinely good one off that shortlist before
 * it was ever corrected).
 *
 * Color-agnostic on purpose: "can the *enemy* chain I'm attacking step to
 * safety" and "is *my own* chain actually savable" are the same question
 * with the color swapped.
 *
 * Approximates rather than fully simulates: the escape point's own open
 * neighbors (excluding the point being played) become the merged chain's
 * only liberties post-extension, since the chain's original 2 liberties
 * (the move's point and the escape point itself) are both consumed —
 * exact for that one step, but still only one step, so a longer ladder
 * that fails 2-3 moves later isn't caught.
 */
export function chainCanEscape(
  board: string[],
  chains: (number | null)[][],
  size: number,
  chainId: number,
  stone: 'X' | 'O',
  movePoint: readonly [number, number],
): boolean {
  const escape = findLibertyPoint(board, chains, size, chainId, stone, movePoint)
  if (!escape)
    return false
  const freshLiberties = neighborsOf(size, escape[0], escape[1])
    .filter(([nx, ny]) => board[nx][ny] === '.' && (nx !== movePoint[0] || ny !== movePoint[1]))
    .length
  return freshLiberties >= 2
}

/** Counts occurrences of `mark` across a column-strings array — works for both a board and a `getControlledEmptyNodes` result. */
export function countChar(columns: string[], mark: string): number {
  let count = 0
  for (const column of columns) {
    for (const ch of column) {
      if (ch === mark)
        count++
    }
  }
  return count
}
