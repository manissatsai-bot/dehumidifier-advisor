import { parseIntent } from './intent-agent'
import { filterProducts } from './filtering-agent'
import { analyzePrices } from './price-agent'
import { scoreProducts } from './scoring-agent'
import { makeDecision } from './decision-agent'
import { generateExplanation } from './explanation-agent'
import { compareAndDecide } from './comparison-agent'
import { getAllProducts, getPriceHistory } from '@/lib/db'
import { regexExtractIntent } from '@/lib/extract-intent'
import type {
  SessionState, RecommendationResult, UserIntent,
  ConversationStage, Product, ScoreBreakdown,
} from '@/lib/types'

export type OrchestratorResponse =
  | { type: 'question'; message: string }
  | { type: 'recommendation'; data: RecommendationResult }
  | { type: 'error'; message: string }

function isComparisonRequest(message: string): boolean {
  return /猶豫|糾結|難選|不知道選哪|哪台好|哪個好|哪台比較|哪個比較|幫我選|幫我決定|比較一下|差在哪|有什麼差|選哪台|選哪個|推薦哪一|到底選/.test(message)
}

const ON_TOPIC_RE = /除濕|除溼|防潮|晾衣|乾燥|坪|公升|預算|日立|國際牌|panasonic|三菱|大金|聲寶|三洋|東芝|能效|噪音|靜音|保固|型號|機型|評價|推薦|比較|買|選購|多少錢|幾坪|幾升|臥室|客廳|地下室|儲藏|梅雨|潮濕/i

function isOffTopic(message: string, session: SessionState): boolean {
  if (session.intent.space || session.intent.usage) return false
  return !ON_TOPIC_RE.test(message)
}

function isIntentUnchanged(prev: Partial<UserIntent>, next: Partial<UserIntent>): boolean {
  return JSON.stringify(prev) === JSON.stringify(next)
}

function isScoreQuestion(message: string): boolean {
  return /分數怎麼算|怎麼計算|適配分|評分方式|分數是怎|怎麼給分|為什麼.*分|分數.*算法|算法/.test(message)
}

const DIMENSION_KEYWORDS: Array<{ re: RegExp; dim: keyof ScoreBreakdown }> = [
  { re: /靜音|噪音|安靜/,         dim: 'noise_level' },
  { re: /省電|能效|節能|耗電/,     dim: 'energy_efficiency' },
  { re: /預算|價格|便宜|價錢/,     dim: 'price_fit' },
  { re: /坪數|空間|大小|坪/,       dim: 'space_fit' },
  { re: /保固|售後|維修|服務/,     dim: 'after_service' },
  { re: /耐用|品質|耐久/,          dim: 'durability' },
  { re: /移動|搬運|輪子|輕便/,     dim: 'portability' },
  { re: /時機|低點|歷史價|買點/,   dim: 'price_intelligence' },
  { re: /晾衣|使用情境|用途|場景/, dim: 'usage_fit' },
]
const DIMENSION_LABEL: Record<keyof ScoreBreakdown, string> = {
  space_fit: '空間適配', price_fit: '預算符合', usage_fit: '場景符合',
  price_intelligence: '價格時機', energy_efficiency: '能源效率',
  noise_level: '靜音', portability: '移動便利', durability: '耐用度', after_service: '售後服務',
}

function parseWeightAdjustment(message: string): Partial<Record<keyof ScoreBreakdown, number>> | null {
  const boost = /比較在乎|很重要|最重要|調高|加重|更重視|優先|注重|最在意/
  const reduce = /不太在乎|不重要|調低|降低|不考慮|次要/
  const matched: Partial<Record<keyof ScoreBreakdown, number>> = {}
  for (const { re, dim } of DIMENSION_KEYWORDS) {
    if (re.test(message)) {
      if (boost.test(message)) matched[dim] = 0.35
      else if (reduce.test(message)) matched[dim] = 0.01
    }
  }
  return Object.keys(matched).length > 0 ? matched : null
}

function scoreExplanation(): string {
  return `適配分數（0–100）由 9 個維度加權合計：

• 空間適配 25%：您的坪數與機型適用坪數是否吻合
• 預算符合 18%：售價佔預算的比例（低於 80% 最高分）
• 場景符合 18%：晾衣重水箱容量、臥室重靜音、地下室重大容量
• 價格時機 12%：當前售價在歷史區間的百分位（越接近低點越高）
• 能源效率 8%：一級能效 100 分，二級 75 分，依序遞減
• 靜音 5%、移動便利 5%、耐用度 5%、售後服務 4%

若有特別在意的維度，例如「靜音很重要」或「我比較在乎省電」，告訴我，我會調整權重重新計算。`
}

const USAGE_LABEL: Record<string, string> = {
  dry_clothes: '室內晾衣', dehumidify: '梅雨除濕',
  basement: '地下室防潮', bedroom: '臥室使用',
}

// ── Message builders ──────────────────────────────────────────────────────────

function msgAskSpace(): string {
  return `您好，歡迎使用除濕機選購顧問服務。

請問您需要除濕的空間大約幾坪？
（例如：8坪套房、15坪客廳、30坪地下室）`
}

function msgAskUsage(space: number, allProducts: Product[]): string {
  const matchCount = allProducts.filter(
    p => p.capacity_liters >= space * 0.6 * 0.8
  ).length
  return `了解，${space} 坪的空間，目前有 ${matchCount} 款機型符合基本規格需求。

請問主要使用情境為何？

① 客廳／書房（梅雨季一般除濕）
② 臥室（長時間運轉，噪音需求較低）
③ 地下室／儲藏室（防潮為主）
④ 晾衣間（室內衣物乾燥）`
}

function msgAskPriorities(space: number, usage: string, allProducts: Product[]): string {
  const requiredCap = space * 0.6
  const candidates = allProducts
    .filter(p => p.capacity_liters >= requiredCap * 0.8)
    .filter(p => {
      if (usage === 'bedroom') return p.noise_db === null || p.noise_db <= 42
      return true
    })

  const previewNames = candidates.slice(0, 3).map(p => {
    const brand = p.brand === 'Panasonic' ? '國際牌' : p.brand
    return `${brand} ${p.capacity_liters}L`
  }).join('、')

  return `依據 ${space} 坪 × ${USAGE_LABEL[usage] ?? usage}，初步篩選出 ${candidates.length} 款候選機型，包含 ${previewNames} 等。

請問您優先考量哪些條件？（可複選）

• 節能省電 → 篩選一級能效機型
• 靜音運轉 → 低噪音規格優先
• 品牌保障 → 日系大廠、三年保固
• 移動便利 → 附輪款式
• 預算控制 → 請告知預算上限

若無特別偏好，直接說「幫我推薦」，將為您綜合評分後給出建議。`
}

// ── Intent merge helper ───────────────────────────────────────────────────────

function mergeIntent(
  existing: Partial<UserIntent>,
  incoming: Partial<UserIntent>
): Partial<UserIntent> {
  const merged = { ...existing }
  for (const key of Object.keys(incoming) as Array<keyof UserIntent>) {
    const val = incoming[key]
    if (val !== undefined && val !== null) {
      // @ts-expect-error dynamic assign
      merged[key] = val
    }
  }
  return merged
}

// ── Stage logic ───────────────────────────────────────────────────────────────

function nextStage(
  intent: Partial<UserIntent>,
  currentStage: ConversationStage
): ConversationStage {
  if (!intent.space) return 'ask_space'
  if (!intent.usage) return 'ask_usage'
  // Have space + usage. If budget is set, or we've already shown priorities → recommend
  if (intent.budget !== undefined || currentStage === 'ask_priorities') return 'recommend'
  return 'ask_priorities'
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function orchestrate(
  userMessage: string,
  session: SessionState
): Promise<{ response: OrchestratorResponse; updatedSession: SessionState }> {

  const allProducts = getAllProducts()

  // ── Step 1: Regex extraction ──────────────────────────────────────────────
  const regexResult = regexExtractIntent(userMessage)
  let updatedIntent = mergeIntent(session.intent, regexResult)

  // ── Step 2: Claude extraction for anything regex missed ───────────────────
  const needsSpace  = !updatedIntent.space
  const needsUsage  = !updatedIntent.usage
  const regexGotSomething = Object.keys(regexResult).length > 0

  if (needsSpace || needsUsage || !regexGotSomething) {
    try {
      const parseResult = await parseIntent(userMessage, session.history, updatedIntent)
      updatedIntent = mergeIntent(parseResult.intent, updatedIntent)
    } catch {
      // continue with regex-only
    }
  }

  // ── Step 3: Off-topic check ───────────────────────────────────────────────
  if (isOffTopic(userMessage, session)) {
    const msg = `不好意思，本服務專門協助您選購除濕機。

請告訴我您的使用情境，例如：
• 空間坪數（客廳15坪、臥室8坪、地下室30坪）
• 主要用途（梅雨除濕、室內晾衣、防潮）
• 預算範圍（選填）

我將為您評估並推薦最適合的機型。`
    const updatedHistory = [...session.history, { role: 'user' as const, content: userMessage }]
    const updatedSession: SessionState = { ...session, history: updatedHistory.slice(-12), turns: session.turns + 1 }
    updatedSession.history.push({ role: 'assistant', content: msg })
    return { response: { type: 'question', message: msg }, updatedSession }
  }

  // ── Step 4: Scoring explanation ──────────────────────────────────────────────
  if (isScoreQuestion(userMessage)) {
    const msg = scoreExplanation()
    const updatedHistory = [...session.history, { role: 'user' as const, content: userMessage }]
    const updatedSession: SessionState = { ...session, history: updatedHistory.slice(-12), turns: session.turns + 1 }
    updatedSession.history.push({ role: 'assistant', content: msg })
    return { response: { type: 'question', message: msg }, updatedSession }
  }

  // ── Step 4b: Weight adjustment ────────────────────────────────────────────────
  const weightAdj = parseWeightAdjustment(userMessage)
  if (weightAdj && session.stage === 'recommend' && session.intent.space && session.intent.usage) {
    const mergedWeights = { ...(session.custom_weights ?? {}), ...weightAdj }
    const dimNames = Object.keys(weightAdj).map(k => DIMENSION_LABEL[k as keyof ScoreBreakdown]).join('、')
    const updatedHistory = [...session.history, { role: 'user' as const, content: userMessage }]
    const updatedSession: SessionState = { ...session, history: updatedHistory.slice(-12), turns: session.turns + 1, custom_weights: mergedWeights }
    // Re-run recommendation with new weights — fall through to recommend stage below
    // (update session.custom_weights so scoring picks it up)
    const rerunMsg = `了解，已調高「${dimNames}」的權重，重新為您計算推薦。`
    updatedSession.stage = 'recommend'
    // We'll let the recommend flow below handle it, but first push the acknowledgment
    // Actually just re-run inline here
    const adjBudget = updatedSession.intent.budget ?? 100000
    const adjIntent: UserIntent = { ...updatedSession.intent, space: updatedSession.intent.space!, usage: updatedSession.intent.usage!, budget: adjBudget }
    const adjFiltered = filterProducts(allProducts, adjIntent)
    if (adjFiltered.length > 0) {
      const adjPriceAnalyses = new Map(adjFiltered.map(p => [p.id, analyzePrices(p.current_price, getPriceHistory(p.id), p.capacity_liters)]))
      const adjScored = scoreProducts(adjFiltered, adjIntent, adjPriceAnalyses, mergedWeights)
      const adjTop3 = adjScored.slice(0, 3)
      const adjTop = adjTop3[0]
      const adjDecision = makeDecision(adjTop, adjIntent)
      const adjExplanation = await generateExplanation(adjTop, adjDecision, adjIntent, adjTop3)
      const adjBudgetLabel = adjBudget >= 100000 ? '不限' : `$${adjBudget.toLocaleString()}`
      const result: RecommendationResult = {
        top_product: adjTop,
        all_products: adjTop3,
        decision: adjDecision,
        explanation: rerunMsg + '\n\n' + adjExplanation,
        intent_summary: `${adjIntent.space}坪・預算 ${adjBudgetLabel}・${USAGE_LABEL[adjIntent.usage!] ?? adjIntent.usage}（已調整：${dimNames}）`,
      }
      updatedSession.history.push({ role: 'assistant', content: result.explanation })
      return { response: { type: 'recommendation', data: result }, updatedSession }
    }
  }

  // ── Step 5: If already recommended and intent unchanged → ask what they need
  if (session.stage === 'recommend' && isIntentUnchanged(session.intent, updatedIntent)) {
    const needsRec = /再推薦|重新推薦|換一台|其他推薦|其他機型|再推|重推|評價|評論|網友|ptt|dcard/.test(userMessage)
    if (!needsRec) {
      const msg = `請問您還有什麼疑問，或是想調整需求（坪數、預算、用途）嗎？

若想重新查詢其他機型，請告訴我新的需求條件。`
      const updatedHistory = [...session.history, { role: 'user' as const, content: userMessage }]
      const updatedSession: SessionState = { ...session, history: updatedHistory.slice(-12), turns: session.turns + 1 }
      updatedSession.history.push({ role: 'assistant', content: msg })
      return { response: { type: 'question', message: msg }, updatedSession }
    }
  }

  // ── Step 5: Update session ────────────────────────────────────────────────
  const updatedHistory = [
    ...session.history,
    { role: 'user' as const, content: userMessage },
  ]

  const stage = nextStage(updatedIntent, session.stage)

  const updatedSession: SessionState = {
    intent: updatedIntent,
    history: updatedHistory.slice(-12),
    turns: session.turns + 1,
    stage,
  }

  // ── Step 4: Comparison shortcut (user is torn between the top 3) ──────────
  if (session.stage === 'recommend' && isComparisonRequest(userMessage) && updatedIntent.space && updatedIntent.usage) {
    const compBudget = updatedIntent.budget ?? 100000
    const compIntent: UserIntent = {
      ...updatedIntent,
      space: updatedIntent.space,
      usage: updatedIntent.usage,
      budget: compBudget,
    }
    const compFiltered = filterProducts(allProducts, compIntent)
    if (compFiltered.length > 0) {
      const compPriceAnalyses = new Map(
        compFiltered.map(p => [p.id, analyzePrices(p.current_price, getPriceHistory(p.id), p.capacity_liters)])
      )
      const compScored = scoreProducts(compFiltered, compIntent, compPriceAnalyses)
      const compTop3 = compScored.slice(0, 3)
      try {
        const comparison = await compareAndDecide(compTop3, userMessage, compIntent)
        updatedSession.history.push({ role: 'assistant', content: comparison })
        return { response: { type: 'question', message: comparison }, updatedSession }
      } catch {
        // fall through to normal flow
      }
    }
  }

  // ── Step 5: Show the right stage response ─────────────────────────────────

  if (stage === 'ask_space') {
    const msg = msgAskSpace()
    updatedSession.history.push({ role: 'assistant', content: msg })
    return { response: { type: 'question', message: msg }, updatedSession }
  }

  if (stage === 'ask_usage') {
    const msg = msgAskUsage(updatedIntent.space!, allProducts)
    updatedSession.history.push({ role: 'assistant', content: msg })
    return { response: { type: 'question', message: msg }, updatedSession }
  }

  if (stage === 'ask_priorities') {
    const msg = msgAskPriorities(updatedIntent.space!, updatedIntent.usage!, allProducts)
    updatedSession.history.push({ role: 'assistant', content: msg })
    return { response: { type: 'question', message: msg }, updatedSession }
  }

  // ── Step 5: Recommend ─────────────────────────────────────────────────────
  const budget = updatedIntent.budget ?? 100000
  const intent: UserIntent = {
    ...updatedIntent,
    space:  updatedIntent.space!,
    usage:  updatedIntent.usage!,
    budget,
  }

  const filtered = filterProducts(allProducts, intent)

  if (filtered.length === 0) {
    const cheapest = allProducts.reduce((min, p) => Math.min(min, p.current_price), Infinity)
    const msg = `您的預算 $${budget.toLocaleString()} 低於所有機型的售價（最低約 $${cheapest.toLocaleString()}）。請問可以調整一下預算嗎？`
    updatedSession.intent = { ...updatedIntent, budget: undefined }
    updatedSession.stage = 'ask_priorities'
    updatedSession.history.push({ role: 'assistant', content: msg })
    return { response: { type: 'question', message: msg }, updatedSession }
  }

  const priceAnalyses = new Map(
    filtered.map(p => [
      p.id,
      analyzePrices(p.current_price, getPriceHistory(p.id), p.capacity_liters),
    ])
  )

  const scored = scoreProducts(filtered, intent, priceAnalyses, session.custom_weights)
  const top3 = scored.slice(0, 3)
  const topProduct = top3[0]
  const decision = makeDecision(topProduct, intent)

  const explanation = await generateExplanation(topProduct, decision, intent, top3)

  const budgetLabel = budget >= 100000 ? '不限' : `$${budget.toLocaleString()}`
  const intentSummary = `${intent.space}坪・預算 ${budgetLabel}・${USAGE_LABEL[intent.usage!] ?? intent.usage}`

  const result: RecommendationResult = {
    top_product: topProduct,
    all_products: top3,
    decision,
    explanation,
    intent_summary: intentSummary,
  }

  updatedSession.history.push({ role: 'assistant', content: explanation })

  return { response: { type: 'recommendation', data: result }, updatedSession }
}
