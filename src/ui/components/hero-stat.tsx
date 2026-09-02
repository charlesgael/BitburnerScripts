import React from '@react'

export function HeroStat(props: {
  title: string
  value: any
  icon?: any
  sub?: string
  color?: string
  iconColor?: string
  numSize?: number
  iconSize?: number
} & React.HTMLAttributes<HTMLDivElement>) {
  const {
    title,
    value,
    icon,
    sub,
    color,
    iconColor,
    numSize = 36,
    iconSize = 56,
    ...divProps
  } = props

  return (
    <div
      {...divProps}
      className="bb-card"
      style={{
        ...divProps.style,
        flexDirection: 'row',
        alignItems: 'center',
        fontFamily: 'Segoe UI',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <div style={{ flexShrink: 0 }}>{title}</div>
        <div style={{ fontSize: numSize, color, flex: 1 }}>{value}</div>
        {sub && <div>{sub}</div>}
      </div>
      {icon && <div style={{ flexShrink: 0, fontSize: iconSize, lineHeight: '80px', display: 'flex', color: iconColor || color }}>{icon}</div>}
    </div>
  )
}
