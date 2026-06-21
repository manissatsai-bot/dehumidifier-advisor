import Anthropic from '@anthropic-ai/sdk'
import type { ScoredProduct, UserIntent } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const USAGE_LABEL: Record<string, string> = {
  dry_clothes: '室內晾衣', dehumidify: '梅雨除濕',
  basement: '地下室防潮', bedroom: '臥室使用',
}

export async function compareAndDecide(
  products: ScoredProduct[],
  userQuestion: string,
  intent: UserIntent
): Promise<string> {
  const budgetLabel = (intent.budget ?? 100000) >= 100000 ? '不限' : `$${intent.budget!.toLocaleString()}`

  const productDetails = products.map((p, i) => {
    const brand = p.brand === 'Panasonic' ? '國際牌' : p.brand
    return `【第${i + 1}選】${brand} ${p.name_tw.replace(/^.*牌\s*|^.*普\s*/, '')}
  現價 $${p.current_price.toLocaleString()} | 適配分 ${p.score}/100
  能效：${p.energy_label} | 噪音：${p.noise_db ?? '未知'}dB
  保固：${p.warranty_years}年 | 服務品質：${p.service_quality} | 耐用度：${p.durability_score}/5
  ${p.warnings.length > 0 ? `注意：${p.warnings.join('；')}` : '無特別警告'}`
  }).join('\n\n')

  const prompt = `你是賣場除濕機專業顧問，語氣專業、客觀、條理清晰。顧客在幾個機型之間猶豫，請給出明確建議。

顧客情況：${intent.space}坪・${USAGE_LABEL[intent.usage!] ?? intent.usage}・預算 ${budgetLabel}
顧客問題：「${userQuestion}」

候選機型：
${productDetails}

請依以下格式回覆（繁體中文）：

**本館建議：[品牌型號]**

**推薦原因**
• （列出 2-3 點為何這台在這個情境最具優勢）

**其他機型比較**
• （針對落選的機型，各一句說明差異或適合哪種顧客）

語氣專業、直接，不使用 emoji，不使用「根據分析」等詞，總長度不超過 200 字。`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 250,
    messages: [{ role: 'user', content: prompt }],
  })

  return response.content[0].type === 'text'
    ? response.content[0].text.trim()
    : `看分數的話選第一台就對了，整體最符合你的需求。`
}
