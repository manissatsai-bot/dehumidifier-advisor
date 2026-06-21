import type { RawReview, Product } from './types'

const reviewCache = new Map<string, { data: RawReview[]; expires: number }>()
const CACHE_TTL = 12 * 60 * 60 * 1000 // 12h

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

async function safeFetch(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...headers,
      },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ── PTT ──────────────────────────────────────────────────────────────────────
async function searchPTT(query: string): Promise<RawReview[]> {
  const url = `https://www.ptt.cc/bbs/Appliance/search?q=${encodeURIComponent(query)}`
  const html = await safeFetch(url, { Cookie: 'over18=1' })
  if (!html) return []

  const reviews: RawReview[] = []
  // Match each article entry block
  const entryRe = /<div class="r-ent">([\s\S]*?)<\/div>\s*<\/div>/g
  let m: RegExpExecArray | null

  while ((m = entryRe.exec(html)) !== null && reviews.length < 5) {
    const block = m[1]
    const linkMatch = block.match(/<a href="([^"]+)">([^<]+)<\/a>/)
    const dateMatch = block.match(/<div class="date">\s*([^<]+)<\/div>/)
    const pushMatch = block.match(/<span class="[^"]*">(\d+)<\/span>/)

    if (!linkMatch) continue
    const path = linkMatch[1]
    const title = stripHtml(linkMatch[2]).trim()
    if (!title || title.startsWith('(本文已被刪除)')) continue

    // Fetch article content for snippet
    const articleHtml = await safeFetch(`https://www.ptt.cc${path}`, { Cookie: 'over18=1' })
    let snippet = ''
    if (articleHtml) {
      const mainMatch = articleHtml.match(/<div id="main-content"[^>]*>([\s\S]*?)(?=<div class="push">|<span class="f2">※ 發信站)/)
      if (mainMatch) {
        // Remove the metadata header (span.article-meta-*)
        const body = mainMatch[1].replace(/<div class="article-metaline[\s\S]*?<\/div>/g, '')
        snippet = stripHtml(body).slice(0, 350)
      }
    }

    reviews.push({
      source: 'PTT',
      title,
      snippet: snippet || title,
      url: `https://www.ptt.cc${path}`,
      date: dateMatch ? dateMatch[1].trim() : '',
    })
  }

  return reviews
}

// ── Dcard ─────────────────────────────────────────────────────────────────────
async function searchDcard(query: string): Promise<RawReview[]> {
  const url = `https://www.dcard.tw/service/api/v2/search/posts?query=${encodeURIComponent(query)}&limit=6`
  const html = await safeFetch(url, {
    Referer: 'https://www.dcard.tw/',
    Accept: 'application/json',
  })
  if (!html) return []

  try {
    const data = JSON.parse(html) as Array<{
      id: number
      title: string
      excerpt: string
      createdAt: string
      forum?: { alias: string; name: string }
      likeCount: number
    }>

    if (!Array.isArray(data)) return []

    return data
      .filter(p => p.excerpt && p.excerpt.length > 20)
      .slice(0, 5)
      .map(p => ({
        source: 'Dcard' as const,
        title: p.title,
        snippet: p.excerpt?.slice(0, 350) ?? '',
        url: `https://www.dcard.tw/f/${p.forum?.alias ?? 'home'}/p/${p.id}`,
        date: p.createdAt?.slice(0, 10) ?? '',
      }))
  } catch {
    return []
  }
}

// ── YouTube ───────────────────────────────────────────────────────────────────
interface YTSearchItem {
  id: { videoId: string }
  snippet: {
    title: string
    channelTitle: string
    publishedAt: string
    description: string
  }
}

interface YTCommentItem {
  snippet: {
    topLevelComment: {
      snippet: {
        textDisplay: string
        likeCount: number
        authorDisplayName: string
        publishedAt: string
      }
    }
  }
}

async function searchYouTube(query: string, apiKey: string): Promise<RawReview[]> {
  // Step 1: Find relevant videos
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search')
  searchUrl.searchParams.set('part', 'snippet')
  searchUrl.searchParams.set('q', query)
  searchUrl.searchParams.set('type', 'video')
  searchUrl.searchParams.set('regionCode', 'TW')
  searchUrl.searchParams.set('relevanceLanguage', 'zh-TW')
  searchUrl.searchParams.set('maxResults', '4')
  searchUrl.searchParams.set('key', apiKey)

  const searchRes = await safeFetch(searchUrl.toString())
  if (!searchRes) return []

  let videos: YTSearchItem[] = []
  try {
    const parsed = JSON.parse(searchRes) as { items?: YTSearchItem[] }
    videos = parsed.items ?? []
  } catch {
    return []
  }

  if (videos.length === 0) return []

  // Step 2: Fetch top comments from each video (parallel)
  const commentResults = await Promise.allSettled(
    videos.slice(0, 3).map(v => fetchYTComments(v, apiKey))
  )

  const reviews: RawReview[] = []
  for (const result of commentResults) {
    if (result.status === 'fulfilled') reviews.push(...result.value)
  }
  return reviews
}

async function fetchYTComments(video: YTSearchItem, apiKey: string): Promise<RawReview[]> {
  const videoId = video.id.videoId
  const commentUrl = new URL('https://www.googleapis.com/youtube/v3/commentThreads')
  commentUrl.searchParams.set('part', 'snippet')
  commentUrl.searchParams.set('videoId', videoId)
  commentUrl.searchParams.set('maxResults', '30')
  commentUrl.searchParams.set('order', 'relevance')
  commentUrl.searchParams.set('key', apiKey)

  const raw = await safeFetch(commentUrl.toString())
  if (!raw) return []

  let items: YTCommentItem[] = []
  try {
    const parsed = JSON.parse(raw) as { items?: YTCommentItem[] }
    items = parsed.items ?? []
  } catch {
    return []
  }

  // Pick top comments with most likes (≥1 like or top 5)
  const sorted = items
    .map(i => i.snippet.topLevelComment.snippet)
    .filter(c => c.textDisplay.length > 10 && c.textDisplay.length < 500)
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 8)

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`

  return sorted.map(c => ({
    source: 'YouTube' as const,
    title: video.snippet.title,
    snippet: stripHtml(c.textDisplay).slice(0, 350),
    url: videoUrl,
    date: c.publishedAt.slice(0, 10),
    extra: {
      likeCount: c.likeCount,
      channelName: video.snippet.channelTitle,
    },
  }))
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function fetchProductReviews(product: Product): Promise<RawReview[]> {
  const cached = reviewCache.get(product.id)
  if (cached && cached.expires > Date.now()) return cached.data

  const brandTW = product.brand === 'Panasonic' ? '國際牌' :
                  product.brand === 'Mitsubishi' ? '三菱' :
                  product.brand === 'Hitachi' ? '日立' : product.brand

  const youtubeKey = process.env.YOUTUBE_API_KEY

  const tasks = [
    searchPTT(product.model_id),
    searchPTT(`${brandTW} 除濕機`),
    searchDcard(`${product.model_id} 除濕機`),
    searchDcard(`${brandTW} 除濕機 推薦`),
    ...(youtubeKey
      ? [
          searchYouTube(`${product.model_id} 除濕機 評測 開箱`, youtubeKey),
          searchYouTube(`${brandTW} ${product.model_id} 推薦`, youtubeKey),
        ]
      : []),
  ]

  const results = await Promise.allSettled(tasks)

  const all: RawReview[] = []
  const seen = new Set<string>()

  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const item of r.value) {
        const key = `${item.source}:${item.title}:${item.snippet.slice(0, 30)}`
        if (!seen.has(key)) {
          seen.add(key)
          all.push(item)
        }
      }
    }
  }

  reviewCache.set(product.id, { data: all, expires: Date.now() + CACHE_TTL })
  return all
}
