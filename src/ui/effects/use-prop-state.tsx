import React from '@react'

export function usePropState<T>(
  incomingValue: T,
) {
  // Store the previous value in a ref so mutating it doesn't trigger a new render pass
  const [state, setState] = React.useState<T>(incomingValue)
  const prevRef = React.useRef<T>(incomingValue)

  if (incomingValue !== prevRef.current) {
    prevRef.current = incomingValue // Update the ref immediately
    setState(incomingValue) // Schedule the local state adjustment
  }

  return [state, setState] as const
}
