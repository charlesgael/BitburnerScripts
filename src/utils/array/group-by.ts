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
