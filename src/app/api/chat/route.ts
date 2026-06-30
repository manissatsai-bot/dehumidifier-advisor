import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { scoreAndRank } from '@/lib/scoring'
import type { Conditions } from '@/lib/scoring'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { messages: ChatMessage[]; conditions: Conditions }
    const { messages, conditions } = body

    const systemPrompt = `你是一位親切且專業的除濕機顧問。用戶已看到推薦結果，現在可能想微調方向。

當用戶提出新需求時，你需要：
1. 理解他想調整什麼
2. 返回 JSON 格式的 conditionUpdates，包含要改變的欄位
3. 用親切自然的繁體中文回覆

可調整欄位：
- quiet: true → 加入 'quiet' 到 priorities（用戶想要更安靜）
- budget: 'b1'~'b5'|'b0' → 調整預算區間
- tank: true → 加入 'tank' 到 priorities（重視水箱容量）
- cloth: true → 加入 'cloth' 到 purposes（衣物乾燥需求）
- allergy: true → 加入 'allergy' 到 purposes（過敏體質）
- heavy: true → 加入 'heavy' 到 purposes（地下室/高潮濕）
- area: Number → 坪數增減量（例如 +4）
- energy: true → 加入 'energy' 到 priorities（省電優先）
- light: true → 加入 'light' 到 priorities（輕巧好移動）

回覆格式必須包含 JSON 塊（之後接上用戶面向的中文回覆）：
\`\`\`json
{ "changed": true/false, "updates": { ... } }
\`\`\``

    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 600,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''

    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/)
    let parsed: { changed: boolean; updates: Record<string, unknown> } | null = null
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[1]) } catch { parsed = null }
    }

    const reply = text.replace(/```json[\s\S]*?```/g, '').trim()
    const result: Record<string, unknown> = { reply }

    if (parsed?.changed && parsed?.updates) {
      const u = parsed.updates
      const newCond: Conditions = { ...conditions }

      if (u.quiet && !newCond.priorities.includes('quiet')) newCond.priorities.push('quiet')
      if (u.energy && !newCond.priorities.includes('energy')) newCond.priorities.push('energy')
      if (u.tank && !newCond.priorities.includes('tank')) newCond.priorities.push('tank')
      if (u.light && !newCond.priorities.includes('light')) newCond.priorities.push('light')
      if (u.cloth && !newCond.purposes.includes('cloth')) newCond.purposes.push('cloth')
      if (u.allergy && !newCond.purposes.includes('allergy')) newCond.purposes.push('allergy')
      if (u.heavy && !newCond.purposes.includes('heavy')) newCond.purposes.push('heavy')
      if (typeof u.budget === 'string') newCond.budget = u.budget
      if (typeof u.area === 'number') newCond.area = Math.min(30, Math.max(1, newCond.area + u.area))

      result.conditions = newCond
      result.recommendations = scoreAndRank(newCond)
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('chat error:', error)
    return NextResponse.json({ reply: '抱歉，連線好像有點狀況，請稍後再試一次。' }, { status: 500 })
  }
}
