/**
 * Bayesian Campaign Stack Ranking Engine
 * 
 * Uses Bayesian inference to rank campaigns, posts, and quizzes
 * accounting for sample size, platform baselines, and time decay.
 * 
 * Formula: posterior = (prior_mean × prior_weight + observed_mean × sample_size) / (prior_weight + sample_size)
 */

// Platform baseline engagement rates (industry averages)
const PLATFORM_BASELINES: Record<string, number> = {
  instagram: 0.045,  // 4.5% avg engagement
  facebook: 0.025,   // 2.5%
  linkedin: 0.038,   // 3.8%
  tiktok: 0.058,     // 5.8%
  x: 0.015,          // 1.5%
}

const PRIOR_WEIGHT = 10 // How much weight we give to the prior (higher = more conservative)
const TIME_DECAY_HALFLIFE = 30 // Days until a data point has half weight

interface DataPoint {
  value: number        // observed metric (engagement rate, conversion rate, etc.)
  sampleSize: number   // number of observations
  timestamp: Date      // when the observation was made
  platform?: string    // optional platform for baseline adjustment
}

interface RankedItem {
  id: string
  label: string
  posteriorScore: number
  confidence: number    // 0-1, how confident we are (based on sample size)
  trend: 'up' | 'down' | 'stable'
  dataPoints: number
}

/**
 * Calculate time-decayed weight for a data point
 */
function timeDecayWeight(timestamp: Date, now: Date = new Date()): number {
  const daysDiff = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60 * 24)
  return Math.pow(0.5, daysDiff / TIME_DECAY_HALFLIFE)
}

/**
 * Calculate Bayesian posterior score for a single item
 */
export function bayesianScore(dataPoints: DataPoint[]): { score: number; confidence: number } {
  if (dataPoints.length === 0) {
    return { score: 0, confidence: 0 }
  }

  const now = new Date()

  // Calculate weighted observed mean
  let weightedSum = 0
  let totalWeight = 0

  for (const dp of dataPoints) {
    const decay = timeDecayWeight(dp.timestamp, now)
    const weight = dp.sampleSize * decay
    weightedSum += dp.value * weight
    totalWeight += weight
  }

  const observedMean = totalWeight > 0 ? weightedSum / totalWeight : 0

  // Get platform-adjusted prior
  const platform = dataPoints[0]?.platform
  const priorMean = platform ? (PLATFORM_BASELINES[platform] || 0.03) : 0.03

  // Bayesian update
  const effectiveSampleSize = totalWeight
  const posterior = (priorMean * PRIOR_WEIGHT + observedMean * effectiveSampleSize) / (PRIOR_WEIGHT + effectiveSampleSize)

  // Confidence: 0 at n=0, approaching 1 as n grows
  const confidence = Math.min(effectiveSampleSize / (effectiveSampleSize + PRIOR_WEIGHT), 0.99)

  return { score: posterior, confidence }
}

/**
 * Rank a set of items by their Bayesian posterior scores
 */
export function rankItems(
  items: Array<{ id: string; label: string; dataPoints: DataPoint[] }>
): RankedItem[] {
  return items
    .map(item => {
      const { score, confidence } = bayesianScore(item.dataPoints)

      // Calculate trend from last 7 days vs previous 7 days
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

      const recentPoints = item.dataPoints.filter(dp => dp.timestamp >= weekAgo)
      const previousPoints = item.dataPoints.filter(dp => dp.timestamp >= twoWeeksAgo && dp.timestamp < weekAgo)

      const recentAvg = recentPoints.length > 0 ? recentPoints.reduce((s, p) => s + p.value, 0) / recentPoints.length : 0
      const previousAvg = previousPoints.length > 0 ? previousPoints.reduce((s, p) => s + p.value, 0) / previousPoints.length : 0

      let trend: 'up' | 'down' | 'stable' = 'stable'
      if (recentPoints.length > 0 && previousPoints.length > 0) {
        const diff = recentAvg - previousAvg
        if (diff > 0.005) trend = 'up'
        else if (diff < -0.005) trend = 'down'
      }

      return {
        id: item.id,
        label: item.label,
        posteriorScore: score,
        confidence,
        trend,
        dataPoints: item.dataPoints.length,
      }
    })
    .sort((a, b) => b.posteriorScore - a.posteriorScore)
}

/**
 * Score a campaign stack combination
 * (quiz type + post format + platform + ICP)
 */
export function scoreCampaignStack(
  stacks: Array<{
    id: string
    quizType: string
    postFormat: string
    platform: string
    icpTarget: string
    conversions: DataPoint[]
  }>
): RankedItem[] {
  return rankItems(
    stacks.map(s => ({
      id: s.id,
      label: `${s.quizType} → ${s.postFormat} → ${s.platform} → ${s.icpTarget}`,
      dataPoints: s.conversions,
    }))
  )
}

/**
 * A/B test significance calculator
 * Uses Bayesian approach - returns probability that A > B
 */
export function abTestProbability(
  variantA: { successes: number; trials: number },
  variantB: { successes: number; trials: number },
  simulations: number = 10000
): number {
  let aWins = 0

  for (let i = 0; i < simulations; i++) {
    // Beta distribution sampling (using Box-Muller approximation)
    const sampleA = betaSample(variantA.successes + 1, variantA.trials - variantA.successes + 1)
    const sampleB = betaSample(variantB.successes + 1, variantB.trials - variantB.successes + 1)
    if (sampleA > sampleB) aWins++
  }

  return aWins / simulations
}

// Simple beta distribution sampler using gamma distribution approximation
function betaSample(alpha: number, beta: number): number {
  const x = gammaSample(alpha)
  const y = gammaSample(beta)
  return x / (x + y)
}

function gammaSample(shape: number): number {
  if (shape < 1) {
    return gammaSample(shape + 1) * Math.pow(Math.random(), 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  while (true) {
    let x, v
    do {
      x = normalSample()
      v = 1 + c * x
    } while (v <= 0)
    v = v * v * v
    const u = Math.random()
    if (u < 1 - 0.0331 * x * x * x * x) return d * v
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function normalSample(): number {
  const u = 1 - Math.random()
  const v = 1 - Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
