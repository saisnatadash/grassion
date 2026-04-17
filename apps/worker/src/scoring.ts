export function computeReworkScore(signals: {
  wasReverted: boolean
  downstreamFixCount: number
  ciFailureCount: number
  hadHotfix: boolean
}): number {
  let score = 0
  if (signals.wasReverted) score += 60
  score += Math.min(signals.downstreamFixCount * 15, 30)
  score += Math.min(signals.ciFailureCount * 5, 20)
  if (signals.hadHotfix) score += 25
  return Math.min(score, 100)
}
