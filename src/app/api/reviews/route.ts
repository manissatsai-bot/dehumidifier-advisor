export const runtime = 'edge'

import { fetchProductReviews } from '@/lib/review-scraper'
import { curateReviews } from '@/agents/review-agent'
import type { ScoredProduct } from '@/lib/types'

export async function POST(req: Request) {
  try {
    const { product } = await req.json() as { product: ScoredProduct }
    if (!product?.id) return Response.json({ reviews: null })

    const rawReviews = await fetchProductReviews(product)
    if (rawReviews.length === 0) return Response.json({ reviews: null })

    const reviews = await curateReviews(product, rawReviews)
    return Response.json({ reviews })
  } catch (e) {
    console.error('[reviews edge]', e)
    return Response.json({ reviews: null })
  }
}
