export interface Product {
  id: string
  model_id: string
  brand: string
  name_tw: string
  capacity_liters: number
  coverage_ping: number
  tank_liters: number
  noise_db: number | null
  power_watts: number | null
  energy_label: string
  weight_kg: number
  has_wheels: boolean
  current_price: number
  warranty_years: number
  service_quality: '優' | '良' | '普'
  durability_score: number
  platform_urls?: Record<string, string>
  price_source?: 'momo' | 'estimate'
}

export interface PricePoint {
  price: number
  recorded_at: string
  platform: string
}

export type UsageType = 'dehumidify' | 'dry_clothes' | 'basement' | 'bedroom'
export type MobilityType = 'low' | 'medium' | 'high'
export type UrgencyType = 'immediate' | 'flexible'

export interface UserIntent {
  space?: number
  budget?: number
  usage?: UsageType
  mobility?: MobilityType
  priority?: string[]
  noise_sensitive?: boolean
  urgency?: UrgencyType
}

export interface IntentParseResult {
  intent: UserIntent
  is_complete: boolean
  next_question?: string
  missing_fields: string[]
}

export interface ScoreBreakdown {
  space_fit: number
  price_fit: number
  usage_fit: number
  price_intelligence: number
  energy_efficiency: number
  noise_level: number
  portability: number
  durability: number
  after_service: number
}

export type PriceTiming =
  | 'NEAR_LOW'
  | 'BELOW_AVERAGE'
  | 'AVERAGE'
  | 'ABOVE_AVERAGE'
  | 'NEAR_HIGH'
  | 'UNKNOWN'

export interface PriceAnalysis {
  current_price: number
  avg_price: number
  low_price: number
  high_price: number
  percentile: number
  deviation_pct: number
  timing: PriceTiming
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  data_points: number
  percentile_score: number
  cold_start_note?: string
  date_range?: { start: string; end: string }
}

export interface ScoredProduct extends Product {
  score: number
  score_breakdown: ScoreBreakdown
  warnings: string[]
  price_analysis: PriceAnalysis
}

export type DecisionSignal = 'GREEN' | 'YELLOW' | 'RED'

export interface Decision {
  signal: DecisionSignal
  label: string
  reasons: string[]
}

export type ReviewSource = 'PTT' | 'Dcard' | 'YouTube' | 'Mobile01' | 'momo' | 'PChome' | 'Yahoo'

export interface RawReview {
  source: ReviewSource
  title: string
  snippet: string
  url: string
  date: string
  extra?: {
    likeCount?: number
    channelName?: string
  }
}

export interface ReviewHighlight {
  source: ReviewSource
  quote: string
  sentiment: 'positive' | 'negative' | 'neutral'
  url: string
}

export interface CuratedReviews {
  pros: string[]
  cons: string[]
  highlights: ReviewHighlight[]
  overall_sentiment: 'positive' | 'mixed' | 'negative' | 'unknown'
  review_count: number
}

export interface RecommendationResult {
  top_product: ScoredProduct
  all_products: ScoredProduct[]
  decision: Decision
  explanation: string
  intent_summary: string
  reviews?: CuratedReviews
}

export type MessageRole = 'user' | 'assistant'

export interface ChatMessage {
  role: MessageRole
  content: string
  recommendation?: RecommendationResult
  timestamp: number
}

export type ConversationStage = 'ask_space' | 'ask_usage' | 'ask_priorities' | 'recommend'

export interface SessionState {
  intent: Partial<UserIntent>
  history: Array<{ role: MessageRole; content: string }>
  turns: number
  stage: ConversationStage
  custom_weights?: Partial<Record<keyof ScoreBreakdown, number>>
}
