import { parseIntent } from './intent-agent'
import { filterProducts } from './filtering-agent'
import { analyzePrices } from './price-agent'
import { scoreProducts } from './scoring-agent'
import { makeDecision } from './decision-agent'
import { generateExplanation } from './explanation-agent'
import { curateReviews } from './review-agent'
import { compareAndDecide } from './comparison-agent'
import { getAllProducts, getPriceHistory } from '@/lib/db'
import { regexExtractIntent } from '@/lib/extract-intent'
import { fetchProductReviews } from '@/lib/review-scraper'
import type {
  SessionState, RecommendationResult, UserIntent,
  CuratedReviews, ConversationStage, Product,
} from '@/lib/types'

export type OrchestratorResponse =
  | { type: 'question'; message: string }
  | { type: 'recommendation'; data: RecommendationResult }
  | { type: 'error'; message: string }

function isComparisonRequest(message: string): boolean {
  return /猶豫|糾結|難選|不知道選哪|哪台好|哪個好|哪台比較|哪個比較|幫我選|幫我決定|比較一下|差在哪|有什麼差|選哪台|選哪個|推薦哪一|到底選/.test(message)
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

  // ── Step 3: Update session ────────────────────────────────────────────────
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

  const scored = scoreProducts(filtered, intent, priceAnalyses)
  const top3 = scored.slice(0, 3)
  const topProduct = top3[0]
  const decision = makeDecision(topProduct, intent)

  const rawReviews = await fetchProductReviews(topProduct)
  const emptyReviews: CuratedReviews = {
    pros: [], cons: [], highlights: [],
    overall_sentiment: 'unknown', review_count: 0,
  }
  const reviews = rawReviews.length > 0
    ? await curateReviews(topProduct, rawReviews)
    : emptyReviews

  const explanation = await generateExplanation(topProduct, decision, intent, top3, reviews)

  const budgetLabel = budget >= 100000 ? '不限' : `$${budget.toLocaleString()}`
  const intentSummary = `${intent.space}坪・預算 ${budgetLabel}・${USAGE_LABEL[intent.usage!] ?? intent.usage}`

  const result: RecommendationResult = {
    top_product: topProduct,
    all_products: top3,
    decision,
    explanation,
    intent_summary: intentSummary,
    reviews,
  }

  updatedSession.history.push({ role: 'assistant', content: explanation })

  return { response: { type: 'recommendation', data: result }, updatedSession }
}
