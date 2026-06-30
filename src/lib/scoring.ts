import { getAllProducts } from './db'
import type { Product } from './types'

export interface Conditions {
  area: number
  roomType: string
  budget: string
  purposes: string[]
  priorities: string[]
  note: string
}

interface BudgetRange {
  id: string
  lo: number
  hi: number
}

const BUDGETS: BudgetRange[] = [
  { id: 'b1', lo: 0, hi: 5000 },
  { id: 'b2', lo: 5000, hi: 8000 },
  { id: 'b3', lo: 8000, hi: 12000 },
  { id: 'b4', lo: 12000, hi: 20000 },
  { id: 'b5', lo: 20000, hi: 99999 },
  { id: 'b0', lo: 0, hi: 99999 },
]

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function requiredCapacity(area: number, roomType: string): number {
  const dampFactors: Record<string, number> = {
    living: 1.0, bedroom: 0.95, study: 0.9,
    bath: 1.25, basement: 1.45, whole: 1.15, storage: 1.1,
  }
  const damp = dampFactors[roomType] ?? 1.0
  return Math.round(area * 0.62 * damp * 10) / 10
}

function energyScore(label: string): number {
  return label === '一級' ? 94 : label === '二級' ? 76 : 58
}

function quietScore(db: number | null): number {
  if (!db) return 70
  return clamp(Math.round(((52 - db) / (52 - 34)) * 100), 8, 100)
}

function dehumScore(capacity: number): number {
  return clamp(Math.round((capacity / 30) * 100), 10, 100)
}

function buildPros(p: Product): string[] {
  const pros: string[] = []
  if (p.energy_label === '一級') pros.push('一級能效，長時間運轉省電')
  if (p.noise_db !== null && p.noise_db <= 38) pros.push(`${p.noise_db}dB 超靜音，夜間幾乎無感`)
  else if (p.noise_db !== null && p.noise_db <= 42) pros.push(`${p.noise_db}dB 安靜，臥室使用舒適`)
  if (p.capacity_liters >= 25) pros.push(`${p.capacity_liters}L/日高效除濕，梅雨季也壓得住`)
  if (p.tank_liters >= 5) pros.push(`${p.tank_liters}L 大水箱，減少倒水頻率`)
  if (p.has_wheels) pros.push('有輪移動設計，搬移輕鬆')
  if (p.durability_score >= 8) pros.push('品牌耐用度佳，使用壽命長')
  return pros.slice(0, 3)
}

function buildCons(p: Product): string[] {
  const cons: string[] = []
  if (p.energy_label !== '一級') cons.push('非一級能效，長期使用電費稍高')
  if (p.noise_db !== null && p.noise_db > 44) cons.push(`${p.noise_db}dB 運轉聲較明顯，敏感族群留意`)
  if (p.tank_liters < 3) cons.push(`水箱僅 ${p.tank_liters}L，高濕時需較頻繁倒水`)
  if (!p.has_wheels) cons.push('無移動輪，搬移需費力')
  if (p.weight_kg > 12) cons.push(`機身約 ${p.weight_kg}kg，較重`)
  return cons.slice(0, 2)
}

function buildReasons(p: Product, c: Conditions, need: number, inBudget: boolean): string[] {
  const r: string[] = []
  if (p.capacity_liters >= need) {
    r.push(`${p.capacity_liters}L/日對應你約 ${need}L 的需求，${p.coverage_ping} 坪適用範圍涵蓋 ${c.area} 坪空間`)
  } else {
    r.push(`輕巧取向，適合 ${p.coverage_ping} 坪內；若回潮季重度除濕可能略吃力`)
  }
  if (c.priorities.includes('quiet') && p.noise_db !== null && p.noise_db <= 40) {
    r.push(`${p.noise_db}dB 靜音，符合你對安靜的要求`)
  }
  if (c.priorities.includes('energy') && p.energy_label === '一級') {
    r.push('一級能效，長時間運轉電費更省')
  }
  if (c.purposes.includes('heavy') && p.capacity_liters >= 22) {
    r.push('高除濕力，對應地下室、車庫等高潮濕空間')
  }
  if (inBudget) {
    r.push(`NT$ ${p.current_price.toLocaleString()}，落在你的預算範圍內`)
  }
  return r.slice(0, 3)
}

export function scoreAndRank(c: Conditions) {
  const allProducts = getAllProducts()
  const budget = BUDGETS.find(b => b.id === c.budget) ?? BUDGETS.find(b => b.id === 'b0')!
  const need = requiredCapacity(c.area, c.roomType)

  const scored = allProducts.map((p: Product) => {
    const ratio = p.capacity_liters / need
    const fit = ratio >= 1
      ? clamp(1 - (ratio - 1.25) * 0.45, 0.55, 1)
      : clamp(ratio * 0.85, 0.2, 0.9)

    const inBudget = p.current_price <= budget.hi
    const budgetFit = inBudget
      ? clamp(1 - Math.max(0, budget.lo - p.current_price) / 8000, 0.7, 1)
      : 0.4

    let purposeFit = 0.6
    if (c.purposes.includes('heavy') && p.capacity_liters >= 22) purposeFit += 0.25
    if (c.purposes.includes('cloth') && p.capacity_liters >= 18) purposeFit += 0.15
    if (c.purposes.includes('mold') && p.energy_label === '一級') purposeFit += 0.1
    if (c.purposes.includes('allergy')) purposeFit += 0.1
    purposeFit = clamp(purposeFit, 0.5, 1)

    let prioMatch = 0
    if (c.priorities.includes('energy') && p.energy_label === '一級') prioMatch++
    if (c.priorities.includes('quiet') && (p.noise_db === null || p.noise_db <= 40)) prioMatch++
    if (c.priorities.includes('tank') && p.tank_liters >= 5) prioMatch++
    if (c.priorities.includes('light') && p.weight_kg <= 8) prioMatch++
    if (c.priorities.includes('brand') && p.durability_score >= 8) prioMatch++
    const prio = c.priorities.length > 0 ? prioMatch / c.priorities.length : 0.7

    const score10 = clamp((fit * 0.34 + budgetFit * 0.2 + purposeFit * 0.22 + prio * 0.24) * 10, 0, 10)

    const momoUrl = (p.platform_urls as Record<string, string> | undefined)?.momo ?? null

    return {
      id: p.id,
      brand: p.brand,
      model: p.name_tw,
      capacity: p.capacity_liters,
      area: p.coverage_ping,
      tank: p.tank_liters,
      energy: p.energy_label,
      noise: p.noise_db,
      price: p.current_price,
      momoUrl,
      features: [
        ...(p.energy_label === '一級' ? ['energy'] : []),
        ...(p.noise_db !== null && p.noise_db <= 40 ? ['quiet'] : []),
        ...(p.tank_liters >= 5 ? ['tank'] : []),
        ...(p.has_wheels ? ['light'] : []),
      ],
      pros: buildPros(p),
      cons: buildCons(p),
      score: Math.round(score10 * 10) / 10,
      bars: {
        dehumidify: dehumScore(p.capacity_liters),
        efficiency: energyScore(p.energy_label),
        quiet: quietScore(p.noise_db),
      },
      reasons: buildReasons(p, c, need, inBudget),
    }
  })

  return scored.sort((a, b) => b.score - a.score).slice(0, 3)
}
