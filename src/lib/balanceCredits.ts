export function formatBalanceCredits(credits: number): string {
  return `${(Math.trunc(credits * 10) / 10).toFixed(1)} 💎`
}
