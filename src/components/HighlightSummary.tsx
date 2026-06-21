import type { ScoredProduct } from '@/lib/types'

const TIMING_BADGE: Record<string, { label: string; cls: string }> = {
  NEAR_LOW:      { label: '接近低點', cls: 'bg-green-100 text-green-700' },
  BELOW_AVERAGE: { label: '低於均價', cls: 'bg-green-100 text-green-700' },
  AVERAGE:       { label: '價格合理', cls: 'bg-gray-100 text-gray-600' },
  ABOVE_AVERAGE: { label: '略高於均價', cls: 'bg-orange-100 text-orange-600' },
  NEAR_HIGH:     { label: '接近高點', cls: 'bg-red-100 text-red-600' },
  UNKNOWN:       { label: '參考均價', cls: 'bg-gray-100 text-gray-400' },
}

const ENERGY_DOT: Record<string, string> = {
  '一級': 'text-green-500',
  '二級': 'text-yellow-500',
  '三級': 'text-orange-400',
}

interface Props {
  product: ScoredProduct
}

export function HighlightSummary({ product }: Props) {
  const { price_analysis: pa } = product
  const timing = TIMING_BADGE[pa.timing] ?? TIMING_BADGE.UNKNOWN
  const energyDot = ENERGY_DOT[product.energy_label] ?? 'text-gray-400'

  // 亮點：從 score_breakdown 取最高的三項
  const highlights: { label: string; value: number }[] = [
    { label: '空間適配', value: product.score_breakdown.space_fit },
    { label: '預算符合', value: product.score_breakdown.price_fit },
    { label: '能源效率', value: product.score_breakdown.energy_efficiency },
    { label: '耐用度',   value: product.score_breakdown.durability },
    { label: '售後服務', value: product.score_breakdown.after_service },
    { label: '場景符合', value: product.score_breakdown.usage_fit },
  ].sort((a, b) => b.value - a.value).slice(0, 3)

  return (
    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 space-y-3">
      {/* 品牌 + 分數 */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-indigo-400 font-medium uppercase tracking-wide mb-0.5">{product.brand}</div>
          <div className="font-bold text-gray-900 leading-snug">{product.name_tw}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-3xl font-black text-indigo-600 leading-none">{product.score}</div>
          <div className="text-xs text-indigo-300 mt-0.5">適配分數</div>
        </div>
      </div>

      {/* 核心規格 */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-700 font-medium">
          {product.capacity_liters}L／日
        </span>
        <span className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-700 font-medium">
          適用 {product.coverage_ping} 坪
        </span>
        <span className={`text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 font-medium flex items-center gap-1 ${energyDot}`}>
          <span>●</span>
          <span className="text-gray-700">{product.energy_label}能效</span>
        </span>
        {product.noise_db && (
          <span className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-700 font-medium">
            {product.noise_db} dB
          </span>
        )}
      </div>

      {/* 亮點 */}
      <div className="space-y-1">
        {highlights.map(h => (
          <div key={h.label} className="flex items-center gap-2 text-xs">
            <span className="text-indigo-400 shrink-0">✓</span>
            <span className="text-gray-700">
              <span className="font-medium">{h.label}</span>
              <span className="text-gray-400 ml-1">{Math.round(h.value * 100)} 分</span>
            </span>
          </div>
        ))}
      </div>

      {/* 價格 + 時機 */}
      <div className="flex items-center justify-between pt-1 border-t border-indigo-100">
        <div>
          <span className="text-lg font-bold text-gray-900">${product.current_price.toLocaleString()}</span>
          {product.price_source === 'momo'
            ? <span className="ml-1.5 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">momo 即時</span>
            : <span className="ml-1.5 text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">參考估價</span>
          }
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${timing.cls}`}>
          {timing.label}
        </span>
      </div>
    </div>
  )
}
