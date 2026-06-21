import type { RawReview, Product } from './types'

const reviewCache = new Map<string, { data: RawReview[]; expires: number }>()
const CACHE_TTL = 12 * 60 * 60 * 1000 // 12h

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ').trim()
}

async function safeFetch(url: string, headers: Record<string, string> = {}): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        ...headers,
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

// ── PTT ──────────────────────────────────────────────────────────────────────
// Only fetch the search results page — do NOT fetch individual articles (too slow on Vercel)
function extractPTTLinks(html: string): Array<{ path: string; title: string; date: string }> {
  const results: Array<{ path: string; title: string; date: string }> = []
  // Directly match article URLs in the Appliance board (format: /bbs/Appliance/M.xxx.A.yyy.html)
  const linkRe = /<a href="(\/bbs\/Appliance\/M\.[^"]+\.html)"[^>]*>([^<]{3,100})<\/a>/g
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null && results.length < 5) {
    const title = m[2].trim()
    if (!title || title.includes('刪除') || title.length < 3) continue
    results.push({ path: m[1], title, date: '' })
  }
  // Fill in dates (appear in order matching articles)
  const dateRe = /<div class="date">\s*(\d+\/\d+)\s*<\/div>/g
  let di = 0
  while ((m = dateRe.exec(html)) !== null && di < results.length) {
    results[di].date = m[1]
    di++
  }
  return results
}

async function fetchPTTArticle(
  item: { path: string; title: string; date: string }
): Promise<RawReview | null> {
  const html = await safeFetch(`https://www.ptt.cc${item.path}`, { Cookie: 'over18=1' })
  if (!html) return null

  // Extract push comments (推/噓/→)
  const pushRe = /<div class="push">[\s\S]*?<span class="f3 push-content">:?\s*([\s\S]*?)<\/span>[\s\S]*?<\/div>/g
  const pushLines: string[] = []
  let m: RegExpExecArray | null
  while ((m = pushRe.exec(html)) !== null && pushLines.length < 15) {
    const line = stripHtml(m[1]).trim()
    if (line.length > 5 && line.length < 200) pushLines.push(line)
  }

  // Also grab main article body (first 300 chars after metadata)
  let body = ''
  const bodyMatch = html.match(/<div id="main-content"[^>]*>([\s\S]*?)(?:<div class="push">|<span class="f2">※ 發信站)/)
  if (bodyMatch) {
    body = stripHtml(bodyMatch[1].replace(/<div class="article-meta[^"]*"[\s\S]*?<\/div>/g, ''))
      .slice(0, 300)
  }

  const snippet = [body, ...pushLines].filter(Boolean).join(' / ').slice(0, 500)
  if (!snippet) return null

  return {
    source: 'PTT',
    title: item.title,
    snippet,
    url: `https://www.ptt.cc${item.path}`,
    date: item.date,
  }
}

async function searchPTT(query: string): Promise<RawReview[]> {
  const url = `https://www.ptt.cc/bbs/Appliance/search?q=${encodeURIComponent(query)}`
  const html = await safeFetch(url, { Cookie: 'over18=1' })
  if (!html) return []

  const links = extractPTTLinks(html)
  if (links.length === 0) return []

  // Fetch top 3 articles in parallel
  const settled = await Promise.allSettled(links.slice(0, 3).map(fetchPTTArticle))
  return settled
    .filter((r): r is PromiseFulfilledResult<RawReview> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
}

// ── Dcard ─────────────────────────────────────────────────────────────────────
async function searchDcard(query: string): Promise<RawReview[]> {
  const url = `https://www.dcard.tw/service/api/v2/search/posts?query=${encodeURIComponent(query)}&limit=8&sorting=popular`
  const json = await safeFetch(url, {
    Referer: 'https://www.dcard.tw/',
    Origin: 'https://www.dcard.tw',
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
  })
  if (!json) return []

  try {
    const data = JSON.parse(json) as Array<{
      id: number
      title: string
      excerpt: string
      createdAt: string
      forum?: { alias: string; name: string }
      likeCount?: number
    }>

    if (!Array.isArray(data)) return []

    return data
      .filter(p => p.excerpt && p.excerpt.length > 20)
      .slice(0, 5)
      .map(p => ({
        source: 'Dcard' as const,
        title: p.title,
        snippet: p.excerpt?.slice(0, 400) ?? '',
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
  snippet: { title: string; channelTitle: string; publishedAt: string; description: string }
}

interface YTCommentItem {
  snippet: {
    topLevelComment: {
      snippet: { textDisplay: string; likeCount: number; publishedAt: string }
    }
  }
}

async function searchYouTube(query: string, apiKey: string): Promise<RawReview[]> {
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search')
  searchUrl.searchParams.set('part', 'snippet')
  searchUrl.searchParams.set('q', query)
  searchUrl.searchParams.set('type', 'video')
  searchUrl.searchParams.set('regionCode', 'TW')
  searchUrl.searchParams.set('relevanceLanguage', 'zh-TW')
  searchUrl.searchParams.set('maxResults', '3')
  searchUrl.searchParams.set('key', apiKey)

  const searchRes = await safeFetch(searchUrl.toString())
  if (!searchRes) return []

  let videos: YTSearchItem[] = []
  try {
    const parsed = JSON.parse(searchRes) as { items?: YTSearchItem[] }
    videos = parsed.items ?? []
  } catch { return [] }

  if (videos.length === 0) return []

  const commentResults = await Promise.allSettled(
    videos.slice(0, 2).map(v => fetchYTComments(v, apiKey))
  )

  const reviews: RawReview[] = []
  for (const r of commentResults) {
    if (r.status === 'fulfilled') reviews.push(...r.value)
  }
  return reviews
}

async function fetchYTComments(video: YTSearchItem, apiKey: string): Promise<RawReview[]> {
  const videoId = video.id.videoId
  const commentUrl = new URL('https://www.googleapis.com/youtube/v3/commentThreads')
  commentUrl.searchParams.set('part', 'snippet')
  commentUrl.searchParams.set('videoId', videoId)
  commentUrl.searchParams.set('maxResults', '20')
  commentUrl.searchParams.set('order', 'relevance')
  commentUrl.searchParams.set('key', apiKey)

  const raw = await safeFetch(commentUrl.toString())
  if (!raw) return []

  let items: YTCommentItem[] = []
  try {
    const parsed = JSON.parse(raw) as { items?: YTCommentItem[] }
    items = parsed.items ?? []
  } catch { return [] }

  const sorted = items
    .map(i => i.snippet.topLevelComment.snippet)
    .filter(c => c.textDisplay.length > 10 && c.textDisplay.length < 500)
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 6)

  return sorted.map(c => ({
    source: 'YouTube' as const,
    title: video.snippet.title,
    snippet: stripHtml(c.textDisplay).slice(0, 400),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    date: c.publishedAt.slice(0, 10),
    extra: { likeCount: c.likeCount, channelName: video.snippet.channelTitle },
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

  // PTT: search by brand (model IDs rarely discussed on PTT)
  // Dcard: search by model then brand
  const tasks = [
    searchPTT(`${brandTW} 除濕機 推薦`),
    searchPTT(`${brandTW} 除濕機 開箱`),
    searchDcard(`${product.model_id} 除濕機`),
    searchDcard(`${brandTW} 除濕機 推薦`),
    ...(youtubeKey ? [
      searchYouTube(`${product.model_id} 除濕機 開箱評測`, youtubeKey),
      searchYouTube(`${brandTW} 除濕機 推薦 ${new Date().getFullYear()}`, youtubeKey),
    ] : []),
  ]

  const results = await Promise.allSettled(tasks)

  const all: RawReview[] = []
  const seen = new Set<string>()

  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const item of r.value) {
        const key = `${item.source}:${item.title.slice(0, 30)}`
        if (!seen.has(key)) {
          seen.add(key)
          all.push(item)
        }
      }
    }
  }

  console.log(`[reviews] ${product.model_id}: PTT=${all.filter(r=>r.source==='PTT').length} Dcard=${all.filter(r=>r.source==='Dcard').length} YT=${all.filter(r=>r.source==='YouTube').length} total=${all.length}`)
  reviewCache.set(product.id, { data: all, expires: Date.now() + CACHE_TTL })
  return all
}
