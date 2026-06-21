import type { Product, UserIntent } from '@/lib/types'

interface FilteredProduct extends Product {
  warnings: string[]
}

function applyFilters(
  products: Product[],
  intent: UserIntent,
  strict: boolean
): FilteredProduct[] {
  const { space = 10, budget = 20000, usage, noise_sensitive } = intent
  const requiredCapacity = space * 0.6
  const result: FilteredProduct[] = []

  for (const product of products) {
    const warnings: string[] = []

    // 硬過濾：預算
    if (product.current_price > budget * 1.1) continue

    // 硬過濾：除濕能力（嚴格模式允許 20% 彈性；寬鬆模式只加警告）
    if (strict && product.capacity_liters < requiredCapacity * 0.8) continue

    // 硬過濾：噪音（臥室場景下強制過濾，寬鬆模式仍保留）
    if (usage === 'bedroom' && product.noise_db !== null && product.noise_db > 42) continue

    // 軟警告：容量不足（寬鬆 fallback 時產生）
    if (product.capacity_liters < requiredCapacity) {
      const shortfall = Math.round(requiredCapacity - product.capacity_liters)
      warnings.push(`除濕量（${product.capacity_liters}L/日）不足您 ${space} 坪空間需求（建議 ${Math.ceil(requiredCapacity)}L），差距約 ${shortfall}L，效果有限`)
    }

    // 軟警告：移動性
    if (intent.mobility === 'high' && !product.has_wheels && product.weight_kg > 12) {
      warnings.push('此機型較重且無輪子，移動不方便')
    }

    // 軟警告：水箱太小（晾衣場景需要大水箱或連續排水）
    if (usage === 'dry_clothes' && product.tank_liters < 3.0) {
      warnings.push('水箱較小，晾衣時需頻繁倒水')
    }

    // 軟警告：過度規格
    if (product.coverage_ping > space * 2.5) {
      warnings.push(`此機型適用坪數（${product.coverage_ping}坪）遠超您的空間，規格過剩`)
    }

    // 軟警告：噪音敏感
    if (noise_sensitive && product.noise_db !== null && product.noise_db > 44) {
      warnings.push(`噪音 ${product.noise_db}dB，靜音需求下略偏高`)
    }

    // 軟警告：二級能源標章
    if (product.energy_label === '三級' || product.energy_label === '無') {
      warnings.push('能源效率較低，長期使用電費較高')
    }

    result.push({ ...product, warnings })
  }

  return result.sort((a, b) => a.current_price - b.current_price)
}

export function filterProducts(
  products: Product[],
  intent: UserIntent
): FilteredProduct[] {
  const strict = applyFilters(products, intent, true)
  // 若嚴格篩選無結果（坪數超出商品規格上限），放寬容量限制並加警告
  return strict.length > 0 ? strict : applyFilters(products, intent, false)
}
