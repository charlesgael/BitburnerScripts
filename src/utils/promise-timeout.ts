/**
 * Resolves after `ms` milliseconds — or, if `throwOnTimeout` is true,
 * rejects instead with `reason`. Plain `setTimeout`-based, no `ns.sleep`, so
 * it costs no RAM and works from code that doesn't have an `ns` at all.
 */
export function promiseTimeout(
  ms: number,
  throwOnTimeout = false,
  reason = 'Timeout',
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (throwOnTimeout)
      setTimeout(reject, ms, reason)
    else
      setTimeout(resolve, ms)
  })
}
