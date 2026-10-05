export function computeReworkScore(signals: {
  wasReverted: boolean
  downstreamFixCount: number
  ciFailureCount: number
  hotfixSignals: string[]
}): number {
  let score = 0
  if (signals.wasReverted) score += 60
  score += Math.min(signals.downstreamFixCount * 15, 30)
  score += Math.min(signals.ciFailureCount * 5, 20)
  if (signals.hotfixSignals.length > 0) {
    score += signals.hotfixSignals.length >= 2 ? 35 : 25
  }
  return Math.min(score, 100)
}
