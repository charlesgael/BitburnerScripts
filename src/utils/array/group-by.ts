/**
 * Buckets `array` into a `Record` keyed by `selector(item)`, preserving each
 * bucket's original relative order. Every key `selector` ever returns gets
 * its own array — there's no pre-declared key set to fill.
 */
export function groupBy<T, K extends PropertyKey>(
  array: T[],
  selector: (item: T) => K,
): Record<K, T[]> {
  return array.reduce((accumulator, currentItem) => {
    const key = selector(currentItem)

    // Initialize the array bucket if it doesn't exist yet
    if (!accumulator[key]) {
      accumulator[key] = []
    }

    accumulator[key].push(currentItem)
    return accumulator
  }, {} as Record<K, T[]>)
}
