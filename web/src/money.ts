// Money is whole cents everywhere. We never use decimals (floats) for amounts.

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100).toLocaleString('en-US')
  const rest = String(abs % 100).padStart(2, '0')
  return `${sign}$${dollars}.${rest}`
}

// Turns what the person typed ("12", "12.5", "12.50") into cents without using floats.
// Returns null if the text is not a positive amount with at most 2 decimals.
export function parseDollarsToCents(input: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input.trim())
  if (!match) return null
  const dollars = Number(match[1])
  const cents = Number((match[2] ?? '').padEnd(2, '0'))
  const total = dollars * 100 + cents
  return total > 0 ? total : null
}
