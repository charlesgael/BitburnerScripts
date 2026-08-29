import React from '@react'

/**
 * The IPvGO board itself: a CSS grid of stone cells. Genuinely bespoke,
 * non-thematic layout (see CLAUDE.md's styling note on `ui/apps/`), so this
 * stays inline `style` rather than `.bb-*` classes — only the board's own
 * frame (background/border) borrows the shared theme tokens; the stones
 * themselves are plain black/white, same as a real Go board, regardless of
 * which terminal theme is active.
 *
 * Renders top row first (`y = size - 1`) down to `y = 0` at the bottom, and
 * `x = 0` at the left — matching `ns.go.getBoardState()`'s own documented
 * "[0][0] is bottom-left" convention (see `go/heuristic-engine.ts`'s
 * header comment).
 */
export function GoBoard({ board, lastMove }: { board: string[], lastMove: [number, number] | null }) {
  const size = board.length
  if (size === 0)
    return null

  const cellSize = size > 9 ? 20 : size > 7 ? 24 : 28
  const rows: number[] = []
  for (let y = size - 1; y >= 0; y--) rows.push(y)

  const cells: any[] = []
  for (const y of rows) {
    for (let x = 0; x < size; x++) {
      const ch = board[x][y]
      const isLastMove = lastMove !== null && lastMove[0] === x && lastMove[1] === y
      const isStone = ch === 'X' || ch === 'O'
      cells.push(
        <div
          key={`${x},${y}`}
          title={`(${x},${y}) ${ch === 'X' ? 'us' : ch === 'O' ? 'opponent' : ch === '#' ? 'dead node' : 'empty'}`}
          style={{
            width: `${cellSize}px`,
            height: `${cellSize}px`,
            borderRadius: '50%',
            boxSizing: 'border-box',
            background: ch === 'X' ? '#1a1a1a' : ch === 'O' ? '#f0f0f0' : 'transparent',
            border: !isStone
              ? (ch === '#'
                  ? '1px dashed var(--bb-theme-primarydark, #0a0)'
                  : '1px solid var(--bb-theme-primarydark, #0a0)')
              : isLastMove
                ? '2px solid var(--bb-theme-warning, #cc0)'
                : '1px solid #000',
          }}
        />,
      )
    }
  }

  return (
    <div
      style={{
        display: 'inline-grid',
        gridTemplateColumns: `repeat(${size}, ${cellSize}px)`,
        gap: '2px',
        background: 'var(--bb-theme-well, #0b0f0b)',
        border: '1px solid var(--bb-theme-primarydark, #0a0)',
        borderRadius: '4px',
        padding: '6px',
        flexShrink: 0,
      }}
    >
      {cells}
    </div>
  )
}
