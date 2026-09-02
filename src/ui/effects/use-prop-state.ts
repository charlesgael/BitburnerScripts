import { useRef, useState } from '@react'

export function usePropState<T>(
  incomingValue: T,
) {
  // Store the previous value in a ref so mutating it doesn't trigger a new render pass
  const [state, setState] = useState<T>(incomingValue)
  const prevRef = useRef<T>(incomingValue)

  // 1. Detect change during render
  const hasChanged = incomingValue !== prevRef.current

  if (hasChanged) {
    prevRef.current = incomingValue // Update the ref immediately
    setState(incomingValue) // Schedule the local state adjustment
  }

  const updatedState = hasChanged ? incomingValue : state

  return [updatedState, setState] as const
}
