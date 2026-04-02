export function getParticipantColor(hue: number) {
  return {
    tier1: `hsl(${hue}, 35%, 78%)`,
    tier2: `hsl(${hue}, 55%, 62%)`,
    tier3: `hsl(${hue}, 70%, 45%)`,
    base: hue,
  }
}

export function hueForIndex(index: number): number {
  return (index * 137.508) % 360
}

export function tierColor(hue: number, tier: 1 | 2 | 3): string {
  const colors = getParticipantColor(hue)
  return tier === 1 ? colors.tier1 : tier === 2 ? colors.tier2 : colors.tier3
}
