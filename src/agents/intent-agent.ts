import Anthropic from '@anthropic-ai/sdk'
import type { UserIntent, IntentParseResult } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `你是幫用戶買除濕機的助手，從對話中萃取購買需求。

【已知資訊】會在每則訊息前標示，這些欄位已確認，絕對不要再詢問。

只萃取這些欄位（都是選填，有就萃取，沒有就不要放）：
- space: 坪數（數字），"二十坪"→20，"八坪"→8
- budget: 預算上限（數字，新台幣），"一萬五"→15000，"兩萬"→20000，"15k"→15000，"不限/隨便/無上限"→100000
- usage: 只能是 "dehumidify"（梅雨除濕）、"dry_clothes"（晾衣）、"basement"（地下室防潮）、"bedroom"（臥室）其中一個
- mobility: "low"/"medium"/"high"（可選）
- noise_sensitive: true/false（可選，說「安靜」「噪音小」→true）
- urgency: "immediate"/"flexible"（可選）

用途對應：① 客廳梅雨除濕→dehumidify ② 晾衣→dry_clothes ③ 地下室防潮→basement ④ 臥室→bedroom

中文數字對照：一=1 二=2 三=3 四=4 五=5 六=6 七=7 八=8 九=9 十=10 百=100 千=1000 萬=10000 兩=2

回傳 JSON（只回 JSON，不加其他文字）：
{
  "intent": { 本次訊息新萃取到的欄位，沒有的就不要包含 },
  "is_complete": space和usage都有了則true,
  "missing_fields": ["space或usage中還缺的"],
  "next_question": "下一個要問的問題（如果is_complete是true則省略此欄）"
}`

export async function parseIntent(
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  currentIntent: Partial<UserIntent>
): Promise<IntentParseResult> {
  const contextMessage = `【已知資訊】${JSON.stringify(currentIntent)}\n【用戶這次說】${userMessage}`

  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-4).map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    })),
    { role: 'user', content: contextMessage },
  ]

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages,
  })

  const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

  try {
    return JSON.parse(cleaned) as IntentParseResult
  } catch {
    return {
      intent: {} as UserIntent,
      is_complete: false,
      missing_fields: [],
      next_question: undefined,
    }
  }
}
