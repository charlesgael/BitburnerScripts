import React from '@react'

export function Bar(props: {
  segments: ({ pct: number, color?: string })[]
  height?: number
} & React.HTMLAttributes<HTMLDivElement>) {
  const AUTO_COLORS = ['#3366CC', '#DC3912', '#FF9900', '#109618']
  const {
    segments,
    height = 20,
    ...divProps
  } = props
  return (
    <div
      {...divProps}
      style={{
        // Segments are plain block divs, which stack vertically by default —
        // flex row is what actually lays them out side by side as a bar.
        display: 'flex',
        ...divProps.style,
        height,
      }}
    >
      {segments.map((segment, idx) => (
        <div
          key={idx}
          style={{
            width: `${segment.pct * 100}%`,
            background: segment.color || AUTO_COLORS[idx % AUTO_COLORS.length],
            height: '100%',
          }}
        >
        </div>
      ))}
    </div>
  )
}
