import type { Product, UserIntent, ScoredProduct, ScoreBreakdown, PriceAnalysis } from '@/lib/types'

const WEIGHTS: Record<keyof ScoreBreakdown, number> = {
  space_fit:          0.25,
  price_fit:          0.18,
  usage_fit:          0.18,
  price_intelligence: 0.12,
  energy_efficiency:  0.08,
  noise_level:        0.05,
  portability:        0.05,
  durability:         0.05,
  after_service:      0.04,
}

function scoreSpaceFit(product: Product, space: number): number {
  const ratio = product.coverage_ping / space
  if (ratio >= 1.0 && ratio <= 1.5) return 1.0
  if (ratio >= 0.85 && ratio < 1.0) return 0.75
  if (ratio > 1.5 && ratio <= 2.0) return 0.85
  if (ratio > 2.0) return 0.6
  return Math.max(0, ratio * 0.7)
}

function scorePriceFit(price: number, budget: number): number {
  if (price <= budget * 0.8) return 1.0
  if (price <= budget * 0.9) return 0.9
  if (price <= budget) return 0.75
  if (price <= budget * 1.05) return 0.45
  return 0.0
}

function scoreUsageFit(product: Product, usage: string | undefined): number {
  switch (usage) {
    case 'dry_clothes':
      // 晾衣需要大風量、大容量、大水箱
      const capacityScore = Math.min(product.capacity_liters / 12, 1.0)
      const tankScore = product.tank_liters >= 4 ? 1.0 : product.tank_liters >= 3 ? 0.8 : 0.6
      return capacityScore * 0.6 + tankScore * 0.4

    case 'bedroom':
      // 臥室最重視靜音
      if (product.noise_db === null) return 0.6
      if (product.noise_db <= 38) return 1.0
      if (product.noise_db <= 42) return 0.75
      return 0.4

    case 'basement':
      // 地下室需要大容量 + 有輪子（空間大）
      const capScore = Math.min(product.capacity_liters / 16, 1.0)
      const wheelScore = product.has_wheels ? 1.0 : 0.7
      return capScore * 0.7 + wheelScore * 0.3

    case 'dehumidify':
    default:
      // 梅雨季除濕：容量足夠最重要
      return Math.min(product.capacity_liters / 10, 1.0)
  }
}

function scoreEnergyEfficiency(label: string): number {
  const map: Record<string, number> = {
    '一級': 1.0, '二級': 0.75, '三級': 0.5, '四級': 0.3, '五級': 0.2, '無': 0.4,
  }
  return map[label] ?? 0.4
}

function scoreNoise(noiseDb: number | null, noiseSensitive: boolean | undefined): number {
  if (noiseDb === null) return noiseSensitive ? 0.4 : 0.6
  if (noiseDb <= 36) return 1.0
  if (noiseDb <= 40) return 0.85
  if (noiseDb <= 44) return 0.65
  if (noiseDb <= 48) return 0.4
  return 0.2
}

function scorePortability(product: Product, mobility: string | undefined): number {
  if (mobility !== 'high') return 0.8
  if (product.has_wheels) return 1.0
  if (product.weight_kg <= 10) return 0.85
  if (product.weight_kg <= 12) return 0.65
  return 0.4
}

function scoreDurability(score: number): number {
  return score / 5.0
}

function scoreAfterService(quality: string, warrantyYears: number): number {
  const qualityBase: Record<string, number> = { '優': 1.0, '良': 0.65, '普': 0.35 }
  const base = qualityBase[quality] ?? 0.35
  const warrantyBonus = warrantyYears >= 3 ? 0.0 : warrantyYears === 2 ? -0.1 : -0.25
  return Math.max(0, Math.min(1, base + warrantyBonus))
}

export function scoreProducts(
  products: Array<Product & { warnings: string[] }>,
  intent: UserIntent,
  priceAnalyses: Map<string, PriceAnalysis>,
  customWeights?: Partial<Record<keyof ScoreBreakdown, number>>
): ScoredProduct[] {
  const { space = 10, budget = 20000, usage, mobility, noise_sensitive } = intent

  // Merge and re-normalize weights
  let weights = { ...WEIGHTS }
  if (customWeights && Object.keys(customWeights).length > 0) {
    weights = { ...weights, ...customWeights }
    const total = Object.values(weights).reduce((a, b) => a + b, 0)
    for (const k of Object.keys(weights) as Array<keyof ScoreBreakdown>) {
      weights[k] = weights[k] / total
    }
  }

  return products.map(product => {
    const priceAnalysis = priceAnalyses.get(product.id)!

    const breakdown: ScoreBreakdown = {
      space_fit:          scoreSpaceFit(product, space),
      price_fit:          scorePriceFit(product.current_price, budget),
      usage_fit:          scoreUsageFit(product, usage),
      price_intelligence: priceAnalysis.percentile_score,
      energy_efficiency:  scoreEnergyEfficiency(product.energy_label),
      noise_level:        scoreNoise(product.noise_db, noise_sensitive),
      portability:        scorePortability(product, mobility),
      durability:         scoreDurability(product.durability_score),
      after_service:      scoreAfterService(product.service_quality, product.warranty_years),
    }

    const totalScore = Object.entries(breakdown).reduce(
      (sum, [key, val]) => sum + val * weights[key as keyof ScoreBreakdown],
      0
    )

    return {
      ...product,
      score: Math.round(totalScore * 100),
      score_breakdown: breakdown,
      price_analysis: priceAnalysis,
    }
  }).sort((a, b) => b.score - a.score)
}
