import React from '@react'

export function DonutChart({
  percentage,
  size = 32,
  color = '#336ef3',
  trackColor = '#2c2e35',
}: {
  percentage: number
  size?: number
  color?: string
  trackColor?: string
}) {
  // Clamp percentage between 0 and 100
  const clampedPercentage = Math.max(0, Math.min(100, percentage))

  // SVG Circle math
  const radius = 11 // Gives a balanced thickness inside a 32x32 viewbox
  const circumference = 2 * Math.PI * radius // ~69.12
  const strokeDashoffset = circumference - (clampedPercentage / 100) * circumference

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      {/* Background Donut Track */}
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="transparent"
        stroke={trackColor}
        strokeWidth="4" // Controls the thickness of the donut wall
      />
      {/* Colored Progress Ring */}
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="transparent"
        stroke={color}
        strokeWidth="4"
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round" // Optional: gives smooth rounded ends to the progress segment
        transform="rotate(-90 16 16)" // Rotates the starting point to 12 o'clock
      />
    </svg>
  )
}
