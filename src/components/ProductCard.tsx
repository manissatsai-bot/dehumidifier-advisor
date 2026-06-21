import type { ScoredProduct } from '@/lib/types'

interface Props {
  product: ScoredProduct
  rank: number
  isTop?: boolean
}

function getSearchUrls(product: ScoredProduct): Record<string, string> {
  const q = encodeURIComponent(product.model_id)
  const qName = encodeURIComponent(product.name_tw.slice(0, 20))
  return {
    momo:   `https://www.momoshop.com.tw/search/searchShop.jsp?keyword=${q}`,
    PChome: `https://24h.pchome.com.tw/search/?q=${q}`,
    Shopee: `https://shopee.tw/search?keyword=${qName}`,
    ...product.platform_urls,
  }
}

const ENERGY_STYLE: Record<string, { bg: string; text: string; dot: string }> = {
  '一級': { bg: 'bg-green-50', text: 'text-green-700', dot: 'text-green-500' },
  '二級': { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'text-amber-500' },
  '三級': { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'text-orange-400' },
}

const SERVICE_BADGE: Record<string, string> = {
  '優': 'bg-blue-50 text-blue-700 border-blue-100',
  '良': 'bg-gray-50 text-gray-600 border-gray-200',
  '普': 'bg-gray-50 text-gray-400 border-gray-200',
}

const TIMING_LABEL: Record<string, { text: string; color: string }> = {
  NEAR_LOW:      { text: '接近低點', color: 'text-green-600' },
  BELOW_AVERAGE: { text: '低於均價', color: 'text-green-600' },
  AVERAGE:       { text: '價格合理', color: 'text-gray-500' },
  ABOVE_AVERAGE: { text: '略高均價', color: 'text-amber-600' },
  NEAR_HIGH:     { text: '接近高點', color: 'text-red-500' },
  UNKNOWN:       { text: '參考均價', color: 'text-gray-400' },
}

function DurabilityStars({ score }: { score: number }) {
  const full = Math.floor(score)
  const half = score - full >= 0.4
  return (
    <span className="text-amber-400 tracking-tight text-sm">
      {'★'.repeat(full)}{half ? '½' : ''}{'☆'.repeat(5 - full - (half ? 1 : 0))}
    </span>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 75 ? 'bg-indigo-500' : pct >= 50 ? 'bg-indigo-300' : 'bg-gray-200'
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <span className="w-16 text-gray-400 shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-6 text-right text-gray-500 font-medium tabular-nums">{pct}</span>
    </div>
  )
}

export function ProductCard({ product, rank, isTop }: Props) {
  const { price_analysis: pa } = product
  const timing = TIMING_LABEL[pa.timing] ?? TIMING_LABEL.UNKNOWN
  const deviationSign = pa.deviation_pct > 0 ? '+' : ''
  const energyStyle = ENERGY_STYLE[product.energy_label] ?? { bg: 'bg-gray-50', text: 'text-gray-600', dot: 'text-gray-400' }

  return (
    <div className={`rounded-2xl bg-white overflow-hidden transition-shadow ${
      isTop
        ? 'border border-indigo-200 shadow-md ring-1 ring-indigo-100'
        : 'border border-gray-200 shadow-sm'
    }`}>
      {/* Top bar */}
      <div className={`px-5 pt-4 pb-3 ${isTop ? 'bg-gradient-to-r from-indigo-50 to-white' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                isTop ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'
              }`}>#{rank}</span>
              <span className="text-xs text-gray-400 font-medium">{product.brand}</span>
            </div>
            <h3 className="font-semibold text-gray-900 leading-snug text-sm">{product.name_tw}</h3>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-2xl font-black leading-none ${isTop ? 'text-indigo-600' : 'text-gray-700'}`}>
              {product.score}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">適配分</div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* Spec chips */}
        <div className="flex flex-wrap gap-1.5">
          {[
            `${product.capacity_liters}L／日`,
            `適用 ${product.coverage_ping} 坪`,
            `水箱 ${product.tank_liters}L`,
            product.noise_db ? `${product.noise_db} dB` : null,
            product.has_wheels ? '附輪' : null,
          ].filter(Boolean).map((spec, i) => (
            <span key={i} className="text-xs bg-slate-50 border border-gray-200 rounded-full px-2.5 py-1 text-gray-600 font-medium">
              {spec}
            </span>
          ))}
        </div>

        {/* 2×2 info grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* 能效 */}
          <div className={`${energyStyle.bg} rounded-xl p-3`}>
            <div className="text-xs text-gray-400 mb-1">能源效率</div>
            <div className={`text-sm font-bold flex items-center gap-1.5 ${energyStyle.text}`}>
              <span className={`text-base ${energyStyle.dot}`}>●</span>
              {product.energy_label}能效
            </div>
          </div>

          {/* 坪數對應 */}
          <div className="bg-indigo-50 rounded-xl p-3">
            <div className="text-xs text-gray-400 mb-1">除濕量 / 坪數</div>
            <div className="text-sm font-bold text-indigo-700">
              {product.capacity_liters}L ≈ {product.coverage_ping}坪
            </div>
            <div className="mt-1.5 h-1 bg-indigo-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.min(100, (product.capacity_liters / 22) * 100)}%` }} />
            </div>
          </div>

          {/* 保固/售後 */}
          <div className="bg-white border border-gray-100 rounded-xl p-3">
            <div className="text-xs text-gray-400 mb-1.5">保固 / 售後</div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-gray-800">{product.warranty_years}年</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full border font-medium ${SERVICE_BADGE[product.service_quality]}`}>
                服務{product.service_quality}
              </span>
            </div>
          </div>

          {/* 耐用度 */}
          <div className="bg-white border border-gray-100 rounded-xl p-3">
            <div className="text-xs text-gray-400 mb-1">耐用度</div>
            <DurabilityStars score={product.durability_score} />
            <div className="text-xs text-gray-400 mt-0.5">{product.durability_score.toFixed(1)} / 5.0</div>
          </div>
        </div>

        {/* Price */}
        <div className="bg-slate-50 rounded-xl p-3.5 space-y-1.5 border border-gray-100">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <span className="text-lg font-black text-gray-900">${product.current_price.toLocaleString()}</span>
              {product.price_source === 'momo'
                ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">momo 即時</span>
                : <span className="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">參考估價</span>
              }
            </div>
            <span className={`text-xs font-semibold ${timing.color}`}>{timing.text}</span>
          </div>
          <div className="text-xs text-gray-400">
            歷史均價 <span className="font-medium text-gray-600">${pa.avg_price.toLocaleString()}</span>
            <span className={`ml-1 ${pa.deviation_pct <= 0 ? 'text-green-600' : 'text-amber-500'}`}>
              （{deviationSign}{pa.deviation_pct}%）
            </span>
            <span className="mx-1">·</span>
            區間 ${pa.low_price.toLocaleString()}–${pa.high_price.toLocaleString()}
          </div>
          {pa.cold_start_note && (
            <div className="text-xs text-gray-400 italic">{pa.cold_start_note}</div>
          )}
        </div>

        {/* Score breakdown */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide">評分細項</div>
          <ScoreBar label="空間適配" value={product.score_breakdown.space_fit} />
          <ScoreBar label="預算符合" value={product.score_breakdown.price_fit} />
          <ScoreBar label="場景符合" value={product.score_breakdown.usage_fit} />
          <ScoreBar label="價格時機" value={product.score_breakdown.price_intelligence} />
          <ScoreBar label="能源效率" value={product.score_breakdown.energy_efficiency} />
          <ScoreBar label="耐用度"   value={product.score_breakdown.durability} />
          <ScoreBar label="售後服務" value={product.score_breakdown.after_service} />
        </div>

        {/* Warnings */}
        {product.warnings.length > 0 && (
          <div className="space-y-1.5">
            {product.warnings.map((w, i) => (
              <div key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 flex gap-2">
                <span className="shrink-0 font-bold">!</span>
                {w}
              </div>
            ))}
          </div>
        )}

        {/* Purchase links */}
        <div>
          <div className="text-xs text-gray-400 mb-2 font-medium">即時查價</div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(getSearchUrls(product)).map(([platform, url]) => (
              <a
                key={platform}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs bg-white border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-600 hover:text-indigo-700 px-3 py-1.5 rounded-full transition-colors font-medium"
              >
                {platform} ↗
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
