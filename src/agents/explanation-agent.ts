import Anthropic from '@anthropic-ai/sdk'
import type { ScoredProduct, Decision, UserIntent, CuratedReviews } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const USAGE_LABELS: Record<string, string> = {
  dry_clothes: '室內晾衣',
  dehumidify:  '梅雨季除濕',
  basement:    '地下室防潮',
  bedroom:     '臥室過夜使用',
}

export async function generateExplanation(
  topProduct: ScoredProduct,
  decision: Decision,
  intent: UserIntent,
  allProducts: ScoredProduct[],
  reviews?: CuratedReviews
): Promise<string> {
  const usage = USAGE_LABELS[intent.usage ?? 'dehumidify']
  const second = allProducts[1]

  const reviewContext = reviews && (reviews.pros.length > 0 || reviews.cons.length > 0)
    ? `PTT/Dcard 網友反饋：
優點：${reviews.pros.join('、') || '無'}
缺點：${reviews.cons.join('、') || '無'}
整體評價：${reviews.overall_sentiment === 'positive' ? '好評居多' : reviews.overall_sentiment === 'negative' ? '負評居多' : '褒貶不一'}`
    : ''

  const prompt = `你是賣場除濕機專業顧問，語氣專業、客觀、條理清晰，像百貨公司家電顧問。

顧客情況：${intent.space}坪空間，預算 $${intent.budget?.toLocaleString()}，主要用途是${usage}。

推薦商品：${topProduct.name_tw}
現價：$${topProduct.current_price.toLocaleString()}
適配分數：${topProduct.score}/100
歷史均價：$${topProduct.price_analysis.avg_price.toLocaleString()}
價格判斷：${topProduct.price_analysis.timing === 'NEAR_LOW' ? '接近低點，現在購買時機佳' : topProduct.price_analysis.timing === 'NEAR_HIGH' ? '目前價格偏高' : '價格合理'}
決策：${decision.label}
決策理由：${decision.reasons.join('；')}
${reviewContext}
注意事項：${topProduct.warnings.length > 0 ? topProduct.warnings.join('；') : '無'}

${second ? `備選方案：${second.name_tw}，$${second.current_price.toLocaleString()}，適配分數 ${second.score}/100` : ''}

請依以下格式回覆（繁體中文）：

**推薦理由**
• （列出 2-3 點為什麼這台最適合這位顧客）

**注意事項**
• （列出 1-2 點購買前需留意的地方，若無則寫「本機型無特別注意事項」）

${second ? '**備選方案**\n• （一句話說明備選方案適合什麼樣的顧客）' : ''}

語氣專業但親切，不使用 emoji，不使用「根據分析」「系統顯示」等詞，總長度不超過 200 字。`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  return response.content[0].type === 'text'
    ? response.content[0].text.trim()
    : '推薦這台整體最符合你的需求，價格也在合理範圍。'
}
