export const runtime = 'edge'

import { fetchProductReviews } from '@/lib/review-scraper'
import { curateReviews } from '@/agents/review-agent'

interface ReviewProduct {
  id: string
  brand: string
  model_id: string
  name_tw: string
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { product?: ReviewProduct & { modelId?: string; model?: string } }
    const raw = body.product
    if (!raw?.id) return Response.json({ reviews: null })
    // Support both scoring.ts output shape (modelId/model) and direct Product shape (model_id/name_tw)
    const product: ReviewProduct = {
      id: raw.id,
      brand: raw.brand,
      model_id: raw.model_id ?? raw.modelId ?? '',
      name_tw: raw.name_tw ?? raw.model ?? '',
    }
    if (!product.id) return Response.json({ reviews: null })

    const rawReviews = await fetchProductReviews(product)
    if (rawReviews.length === 0) return Response.json({ reviews: null })

    const reviews = await curateReviews(product, rawReviews)
    return Response.json({ reviews })
  } catch (e) {
    console.error('[reviews edge]', e)
    return Response.json({ reviews: null })
  }
}
