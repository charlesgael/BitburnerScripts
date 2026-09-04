import { useState } from '@react'

export function useToggle(defValue: boolean) {
  const [value, setValue] = useState(defValue)

  const toggle = () => setValue(!value)

  return [value, toggle] as const
}
