export function floorMoney(n: number): string {
  return `$${Math.floor(n).toLocaleString()}`
}
