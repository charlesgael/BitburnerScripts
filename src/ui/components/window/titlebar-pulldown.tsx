import React, { useRef, useState } from '@react'
import { useOutsideClick } from '../../effects/use-outside-click'

export function TitlebarPulldown(props: {
  children?: any
  width?: number
  height?: number
}) {
  const {
    width = 320,
    height = 320,
    children,
  } = props

  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  const toggleBtn = () => setTimeout(() => setVisible(!visible))

  useOutsideClick(ref, () => {
    if (visible)
      setVisible(false)
  })

  return (
    <>
      <button className="bb-icon-link" onClick={toggleBtn} title="Open menu">☰</button>
      <div
        ref={ref}
        style={{
          position: 'absolute',
          top: 39,
          right: 0,
          width,
          height: visible ? height + 19 : 0,
          overflow: 'hidden',
          transition: 'height 0.3s ease',
          zIndex: 1,
        }}
      >
        <div
          className="bb-card headless"
          style={{
            height,
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            overflowY: 'auto',
          }}
        >
          {children}
        </div>
      </div>
    </>
  )
}
