import type { PricePoint, PriceAnalysis } from '@/lib/types'

const MARKET_BENCHMARKS: Record<string, { avg: number; low: number; high: number }> = {
  '6':  { avg: 10000, low: 7500,  high: 13000 },
  '7.5':{ avg: 11000, low: 8000,  high: 14000 },
  '10': { avg: 13000, low: 10000, high: 17000 },
  '12': { avg: 14000, low: 10500, high: 18000 },
  '14': { avg: 15000, low: 11000, high: 19000 },
  '16': { avg: 16000, low: 12000, high: 21000 },
  '22': { avg: 21000, low: 17000, high: 26000 },
  '25': { avg: 24000, low: 19000, high: 30000 },
}

function getBenchmark(capacityLiters: number) {
  const key = String(capacityLiters)
  if (MARKET_BENCHMARKS[key]) return MARKET_BENCHMARKS[key]
  // 找最近的等級
  const keys = Object.keys(MARKET_BENCHMARKS).map(Number).sort((a, b) => a - b)
  const closest = keys.reduce((prev, curr) =>
    Math.abs(curr - capacityLiters) < Math.abs(prev - capacityLiters) ? curr : prev
  )
  return MARKET_BENCHMARKS[String(closest)]
}

function percentileRank(value: number, data: number[]): number {
  const below = data.filter(x => x < value).length
  return Math.round((below / data.length) * 100)
}

function mean(data: number[]): number {
  return Math.round(data.reduce((a, b) => a + b, 0) / data.length)
}

export function analyzePrices(
  currentPrice: number,
  history: PricePoint[],
  capacityLiters: number
): PriceAnalysis {
  if (history.length >= 8) {
    const prices = history.map(h => h.price)
    const avg = mean(prices)
    const low = Math.min(...prices)
    const high = Math.max(...prices)
    const percentile = percentileRank(currentPrice, prices)
    const deviationPct = Math.round(((currentPrice - avg) / avg) * 100 * 10) / 10

    let timing: PriceAnalysis['timing']
    if (percentile <= 20) timing = 'NEAR_LOW'
    else if (percentile <= 40) timing = 'BELOW_AVERAGE'
    else if (percentile <= 60) timing = 'AVERAGE'
    else if (percentile <= 80) timing = 'ABOVE_AVERAGE'
    else timing = 'NEAR_HIGH'

    return {
      current_price: currentPrice,
      avg_price: avg,
      low_price: low,
      high_price: high,
      percentile,
      deviation_pct: deviationPct,
      timing,
      confidence: history.length >= 12 ? 'HIGH' : 'MEDIUM',
      data_points: history.length,
      percentile_score: 1 - percentile / 100,
    }
  }

  // Cold start：用市場基準
  const benchmark = getBenchmark(capacityLiters)
  const syntheticPrices = [benchmark.low, benchmark.avg, benchmark.high]
  const percentile = percentileRank(currentPrice, syntheticPrices)
  const deviationPct = Math.round(((currentPrice - benchmark.avg) / benchmark.avg) * 100 * 10) / 10

  let timing: PriceAnalysis['timing'] = 'UNKNOWN'
  if (currentPrice <= benchmark.low * 1.05) timing = 'NEAR_LOW'
  else if (currentPrice <= benchmark.avg * 0.95) timing = 'BELOW_AVERAGE'
  else if (currentPrice <= benchmark.avg * 1.05) timing = 'AVERAGE'
  else if (currentPrice <= benchmark.high * 0.9) timing = 'ABOVE_AVERAGE'
  else timing = 'NEAR_HIGH'

  return {
    current_price: currentPrice,
    avg_price: benchmark.avg,
    low_price: benchmark.low,
    high_price: benchmark.high,
    percentile,
    deviation_pct: deviationPct,
    timing,
    confidence: 'LOW',
    data_points: history.length,
    percentile_score: 1 - percentile / 100,
    cold_start_note: '歷史資料不足，以市場同級均價估算',
  }
}
