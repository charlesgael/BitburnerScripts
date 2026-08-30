export function formatMoney(amount: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    currencySign: 'accounting',
    maximumFractionDigits: 3,
  }).format(amount)
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e12)
    return `${(n / 1e12).toFixed(2)}t`
  if (abs >= 1e9)
    return `${(n / 1e9).toFixed(2)}b`
  if (abs >= 1e6)
    return `${(n / 1e6).toFixed(2)}m`
  if (abs >= 1e3)
    return `${(n / 1e3).toFixed(2)}k`
  return n.toFixed(0)
}
