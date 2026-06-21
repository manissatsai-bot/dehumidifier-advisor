import Anthropic from '@anthropic-ai/sdk'
import type { ScoredProduct, RawReview, CuratedReviews, ReviewHighlight } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function curateReviews(
  product: ScoredProduct,
  rawReviews: RawReview[]
): Promise<CuratedReviews> {
  const empty: CuratedReviews = {
    pros: [],
    cons: [],
    highlights: [],
    overall_sentiment: 'unknown',
    review_count: 0,
  }

  if (rawReviews.length === 0) return empty

  const reviewBlock = rawReviews
    .map((r, i) => {
      const likeLine = r.extra?.likeCount ? `（${r.extra.likeCount} 個讚）` : ''
      const channelLine = r.extra?.channelName ? ` | 頻道: ${r.extra.channelName}` : ''
      return [
        `[${i + 1}][${r.source}] ${r.source === 'YouTube' ? '影片留言' : '文章'}`,
        r.source === 'YouTube'
          ? `影片標題: ${r.title}${channelLine}`
          : `標題: ${r.title}`,
        `內容: ${r.snippet}${likeLine}`,
        `來源: ${r.url}`,
      ].join('\n')
    })
    .join('\n\n---\n\n')

  const prompt = `你是一個幫消費者分析產品評價的助手。

以下是網友在 PTT、Dcard 及 YouTube 討論「${product.name_tw}」或同品牌除濕機的標題與內容：

${reviewBlock}

請從以上資料中萃取有用資訊，回傳以下 JSON（只回 JSON，不加其他文字）：

{
  "pros": ["優點1（10-25字，標注來源如 PTT/Dcard/YouTube）", "優點2", "優點3"],
  "cons": ["缺點1（同上）", "缺點2"],
  "highlights": [
    {
      "source": "PTT" 或 "Dcard" 或 "YouTube",
      "quote": "引用原文或標題中最有參考價值的一段話（10-50字）",
      "sentiment": "positive" 或 "negative" 或 "neutral",
      "url": "對應的來源 URL"
    }
  ],
  "overall_sentiment": "positive" 或 "mixed" 或 "negative"
}

規則：
- pros/cons 最多各 3 項，沒有就空陣列
- highlights 最多 3 則，盡量涵蓋不同來源
- PTT 資料若只有標題，可以標題作為 quote
- Dcard 有摘要的話優先引用摘要原文
- 若評論內容與除濕機完全無關則忽略
- overall_sentiment 根據整體傾向判斷，資料不足時用 "mixed"`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}'
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(cleaned) as {
      pros: string[]
      cons: string[]
      highlights: Array<{ source: string; quote: string; sentiment: string; url: string }>
      overall_sentiment: string
    }

    const highlights: ReviewHighlight[] = (parsed.highlights ?? [])
      .filter(h => h.quote && h.source)
      .slice(0, 4)
      .map(h => ({
        source: h.source as ReviewHighlight['source'],
        quote: h.quote,
        sentiment: (h.sentiment as ReviewHighlight['sentiment']) ?? 'neutral',
        url: h.url ?? rawReviews.find(r => r.source === h.source)?.url ?? '',
      }))

    return {
      pros: (parsed.pros ?? []).slice(0, 3),
      cons: (parsed.cons ?? []).slice(0, 3),
      highlights,
      overall_sentiment: (parsed.overall_sentiment as CuratedReviews['overall_sentiment']) ?? 'mixed',
      review_count: rawReviews.length,
    }
  } catch {
    return { ...empty, review_count: rawReviews.length }
  }
}
