import type { ScoredProduct, Decision, UserIntent } from '@/lib/types'

export function makeDecision(
  topProduct: ScoredProduct,
  intent: UserIntent
): Decision {
  const { score, price_analysis, current_price } = topProduct
  const { budget = 20000, urgency } = intent
  const { timing, deviation_pct, confidence } = price_analysis

  const reasons: string[] = []

  // 分數太低：直接不推薦
  if (score < 52) {
    return {
      signal: 'RED',
      label: '不建議購買',
      reasons: ['目前市場上沒有找到符合您需求的機型，建議調整預算或坪數條件'],
    }
  }

  // 超預算
  if (current_price > budget * 1.1) {
    return {
      signal: 'RED',
      label: '超出預算',
      reasons: [`最佳選項售價 $${current_price.toLocaleString()}，超出您的預算 $${budget.toLocaleString()}`],
    }
  }

  // 判斷購買時機
  const isNearLow = timing === 'NEAR_LOW' || timing === 'BELOW_AVERAGE'
  const isNearHigh = timing === 'NEAR_HIGH' || timing === 'ABOVE_AVERAGE'
  const isUrgent = urgency === 'immediate'

  if (isNearLow && score >= 68) {
    reasons.push(`現價比歷史均價低 ${Math.abs(deviation_pct)}%，接近近期低點`)
    if (score >= 80) reasons.push('需求適配度非常高')
    if (confidence === 'LOW') reasons.push('（價格估算基於市場均價，僅供參考）')
    return { signal: 'GREEN', label: '建議現在購買', reasons }
  }

  if (isUrgent && score >= 65) {
    reasons.push('符合您的核心需求')
    if (!isNearHigh) reasons.push('價格在合理範圍內')
    reasons.push('您的需求較急迫，適合現在入手')
    return { signal: 'GREEN', label: '建議現在購買', reasons }
  }

  if (isNearHigh && !isUrgent) {
    reasons.push(`現價比歷史均價高 ${Math.abs(deviation_pct)}%，不是最佳時機`)
    reasons.push('建議等 618、雙11 或年中促銷再購買')
    return { signal: 'YELLOW', label: '建議等促銷', reasons }
  }

  if (score >= 72) {
    reasons.push('商品非常符合您的需求')
    reasons.push('價格接近平均水位，可以入手')
    return { signal: 'GREEN', label: '建議購買', reasons }
  }

  // 中間地帶
  reasons.push('商品基本符合需求')
  reasons.push('若不急用可再觀察一段時間，等價格下修')
  return { signal: 'YELLOW', label: '可以購買，但可再等等', reasons }
}
