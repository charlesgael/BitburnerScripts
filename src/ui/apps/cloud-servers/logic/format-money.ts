export function formatMoney(n: number): string {
    return `$${Math.floor(n).toLocaleString()}`;
}
