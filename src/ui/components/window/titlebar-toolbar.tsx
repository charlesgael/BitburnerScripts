import React from '@react'

export function TitlebarToolbar(props: {
  children: any
}) {
  const { children } = props
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 40,
        height: 37,
        display: 'flex',
        alignItems: 'center',
        zIndex: 1000,
      }}
    >
      {children}
    </div>
  )
}
