import React from '@react'
import { promiseTimeout } from '../../utils/promise-timeout'

export interface UseAsyncStateReturnBase<
  Data,
  Params extends any[],
> {
  state: Data
  isReady: boolean
  isLoading: boolean
  error: unknown
  execute: (delay?: number, ...args: Params) => Promise<Data | undefined>
  executeImmediate: (...args: Params) => Promise<Data | undefined>
}
export type UseAsyncStateReturn<
  Data,
  Params extends any[],
> = UseAsyncStateReturnBase<Data, Params>
export interface UseAsyncStateOptions<D = any> {
  /**
   * Delay for the first execution of the promise when "immediate" is true. In milliseconds.
   *
   * @default 0
   */
  delay?: number
  /**
   * Execute the promise right after the function is invoked.
   * Will apply the delay if any.
   *
   * When set to false, you will need to execute it manually.
   *
   * @default true
   */
  immediate?: boolean
  /**
   * Callback when error is caught.
   */
  onError?: (e: unknown) => void
  /**
   * Callback when success is caught.
   * @param {D} data
   */
  onSuccess?: (data: D) => void
  /**
   * Sets the state to initialState before executing the promise.
   *
   * This can be useful when calling the execute function more than once (for
   * example, to refresh data). When set to false, the current state remains
   * unchanged until the promise resolves.
   *
   * @default true
   */
  resetOnExecute?: boolean
  /**
   *
   * An error is thrown when executing the execute function
   *
   * @default false
   */
  throwError?: boolean
}

export function useAsyncState<Data, Params extends any[] = any[]>(
  promise: Promise<Data> | ((...args: Params) => Promise<Data>),
  initialState: Data,
  options: UseAsyncStateOptions<Data> = {},
): UseAsyncStateReturn<Data, Params> {
  const {
    immediate = true,
    delay = 0,
    onError = () => {},
    onSuccess = () => {},
    resetOnExecute = true,
    throwError,
  } = options
  const [state, setState] = React.useState<Data>(initialState)
  const [isReady, setIsReady] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<unknown | undefined>(undefined)

  let executionsCount = 0
  async function execute(delay: number = 0, ...args: Params) {
    const executionId = (executionsCount += 1)

    if (resetOnExecute)
      setState(initialState)
    setError(undefined)
    setIsReady(false)
    setIsLoading(true)

    if (delay > 0)
      await promiseTimeout(delay)

    const _promise = typeof promise === 'function'
      ? promise(...args as Params)
      : promise

    try {
      const data = await _promise
      if (executionId === executionsCount) {
        setState(data)
        setIsReady(true)
      }
      onSuccess(data)
      return data
    }
    catch (e) {
      if (executionId === executionsCount)
        setError(e)
      onError(e)
      console.error('Error during useAsyncState', e)
      if (throwError)
        throw e
    }
    finally {
      if (executionId === executionsCount)
        setIsLoading(false)
    }
  }

  React.useEffect(() => {
    if (immediate) {
      (execute as any)(delay)
    }
  }, [])

  const shell: UseAsyncStateReturnBase<Data, Params> = {
    state,
    isReady,
    isLoading,
    error,
    execute,
    executeImmediate: (...args: Params) => execute(0, ...args),
  }

  return {
    ...shell,
  }
}
