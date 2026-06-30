import type { RawReview } from './types'

interface ReviewInput {
  id: string
  brand: string
  model_id: string
  momo_url?: string
}

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

// ── Mobile01 ─────────────────────────────────────────────────────────────────
function extractMobile01Links(html: string): Array<{ path: string; title: string }> {
  const results: Array<{ path: string; title: string }> = []
  // Mobile01 article links: /topicdetail.php?f=NUMBER&t=NUMBER
  const linkRe = /href="(\/topicdetail\.php\?f=\d+&(?:amp;)?t=\d+[^"]*)"[^>]*>([^<]{5,120})</g
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(html)) !== null && results.length < 6) {
    const path = m[1].replace(/&amp;/g, '&')
    const title = stripHtml(m[2]).trim()
    if (title.length < 4) continue
    results.push({ path, title })
  }
  return results
}

async function fetchMobile01Article(item: { path: string; title: string }): Promise<RawReview | null> {
  const url = `https://www.mobile01.com${item.path}`
  const html = await safeFetch(url)
  if (!html) return null

  // Strip scripts/styles/nav
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')

  // Main article body — first large text block
  const texts: string[] = []
  const paraRe = /<(?:p|div)[^>]*class="[^"]*(?:l-article|articleContent|content)[^"]*"[^>]*>([\s\S]{30,1000}?)<\/(?:p|div)>/gi
  let m: RegExpExecArray | null
  while ((m = paraRe.exec(cleaned)) !== null && texts.length < 3) {
    const t = stripHtml(m[1]).trim()
    if (t.length > 20) texts.push(t.slice(0, 300))
  }

  // Reply/comment blocks
  const replyRe = /<(?:div|p)[^>]*class="[^"]*(?:reply|comment|l-reply)[^"]*"[^>]*>([\s\S]{10,400}?)<\/(?:div|p)>/gi
  while ((m = replyRe.exec(cleaned)) !== null && texts.length < 12) {
    const t = stripHtml(m[1]).trim()
    if (t.length > 10 && t.length < 300) texts.push(t)
  }

  // Fallback: grab all <p> text if nothing matched
  if (texts.length === 0) {
    const pRe = /<p[^>]*>([\s\S]{15,300}?)<\/p>/g
    while ((m = pRe.exec(cleaned)) !== null && texts.length < 8) {
      const t = stripHtml(m[1]).trim()
      if (t.length > 15) texts.push(t)
    }
  }

  const snippet = texts.join(' / ').slice(0, 600)
  if (!snippet || snippet.length < 20) return null

  return {
    source: 'Mobile01',
    title: item.title,
    snippet,
    url,
    date: '',
  }
}

async function searchMobile01(query: string): Promise<RawReview[]> {
  const url = `https://www.mobile01.com/search.php?q=${encodeURIComponent(query)}&s=${encodeURIComponent(query)}`
  const html = await safeFetch(url, {
    Referer: 'https://www.mobile01.com/',
    Origin: 'https://www.mobile01.com',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate',
  })
  if (!html) {
    console.log(`[Mobile01] fetch failed for query="${query}"`)
    return []
  }

  const links = extractMobile01Links(html)
  console.log(`[Mobile01] query="${query}" htmlLen=${html.length} links=${links.length}`)
  if (links.length === 0) return []

  const settled = await Promise.allSettled(links.slice(0, 3).map(fetchMobile01Article))
  const results = settled
    .filter((r): r is PromiseFulfilledResult<RawReview> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
  console.log(`[Mobile01] articles fetched=${results.length}`)
  return results
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
  if (!json) {
    console.log(`[Dcard] fetch failed for query="${query}"`)
    return []
  }
  console.log(`[Dcard] query="${query}" responseLen=${json.length} preview=${json.slice(0, 80)}`)

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

// ── momo 買家評價 ─────────────────────────────────────────────────────────────

function extractICode(momoUrl: string): string | null {
  const m = momoUrl.match(/i_code=(\d+)/)
  return m ? m[1] : null
}

async function fetchMomoReviews(momoUrl: string, modelId: string): Promise<RawReview[]> {
  const iCode = extractICode(momoUrl)
  if (!iCode) return []

  // Fetch product detail page — momo JSP renders some reviews server-side
  const url = `https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=${iCode}&ctype=1`
  const html = await safeFetch(url, {
    Referer: 'https://www.momoshop.com.tw/',
    Cookie: 'isMobile=0; ACK=1',
  })
  if (!html) return []

  const results: RawReview[] = []
  const productUrl = `https://www.momoshop.com.tw/goods/GoodsDetail.jsp?i_code=${iCode}`

  // Pattern 1: review item containers
  const blockRe = /<(?:li|div)[^>]*class="[^"]*(?:reviewItem|review_item|comment)[^"]*"[^>]*>([\s\S]{20,600}?)<\/(?:li|div)>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null && results.length < 5) {
    const text = stripHtml(m[1]).trim()
    if (text.length > 15 && !/登入|javascript|function/i.test(text)) {
      results.push({ source: 'momo', title: 'momo 買家評價', snippet: text.slice(0, 300), url: productUrl, date: '' })
    }
  }

  // Pattern 2: review content spans/paragraphs
  if (results.length === 0) {
    const contentRe = /<(?:p|span)[^>]*class="[^"]*(?:reviewContent|review-content|commentContent)[^"]*"[^>]*>([\s\S]{10,300}?)<\/(?:p|span)>/gi
    while ((m = contentRe.exec(html)) !== null && results.length < 5) {
      const text = stripHtml(m[1]).trim()
      if (text.length > 10) {
        results.push({ source: 'momo', title: 'momo 買家評價', snippet: text.slice(0, 300), url: productUrl, date: '' })
      }
    }
  }

  // Pattern 3: look for overall rating summary
  if (results.length === 0) {
    const ratingRe = /class="[^"]*(?:star|rating|score)[^"]*"[^>]*>[\s\S]{0,60}?([\d.]+)\s*[\/分]/i
    const rm = html.match(ratingRe)
    if (rm) {
      const countMatch = html.match(/共\s*(\d+)\s*則|(\d+)\s*則評[價論]/)
      const count = countMatch ? (countMatch[1] ?? countMatch[2]) : ''
      results.push({
        source: 'momo', title: 'momo 商品評分', url: productUrl, date: '',
        snippet: `momo 商品評分 ${rm[1]} 分${count ? `，共 ${count} 則買家評價` : ''}`,
      })
    }
  }

  console.log(`[momo] i_code=${iCode} reviews=${results.length}`)
  return results
}

// ── PChome 24h ──────────────────────────────────────────────────────────────

async function searchPChomeReviews(modelId: string): Promise<RawReview[]> {
  // PChome public search API (used by their own site)
  const url = `https://ecshweb.pchome.com.tw/search/v4.3/all/results?q=${encodeURIComponent(modelId)}&page=1&sort=sale/dc`
  const json = await safeFetch(url, {
    Referer: 'https://24h.pchome.com.tw/',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://24h.pchome.com.tw',
  })
  if (!json) return []

  try {
    const data = JSON.parse(json) as {
      Prods?: Array<{ Id?: string; Name?: string; Rating?: number; Rtype?: string; Price?: { M?: number } }>
    }
    const prods = data?.Prods ?? []
    const results: RawReview[] = []

    for (const p of prods.slice(0, 6)) {
      const name = p?.Name ?? ''
      const id = p?.Id ?? ''
      const rating = p?.Rating
      if (!name || !id || !rating) continue  // skip entries without rating data
      if (!/除濕/i.test(name)) continue
      results.push({
        source: 'PChome',
        title: name,
        snippet: `PChome 評分 ${rating} 分（5 分滿分）`,
        url: `https://24h.pchome.com.tw/prod/${id}`,
        date: '',
        extra: { likeCount: Math.round(Number(rating)) },
      })
      if (results.length >= 2) break
    }
    console.log(`[PChome] modelId=${modelId} results=${results.length}`)
    return results
  } catch {
    return []
  }
}

// ── Yahoo 購物中心 ─────────────────────────────────────────────────────────────

async function searchYahooShopping(modelId: string, brandTW: string): Promise<RawReview[]> {
  const query = `${modelId} 除濕機`
  const url = `https://tw.buy.yahoo.com/search/product?p=${encodeURIComponent(query)}`
  const html = await safeFetch(url, {
    Referer: 'https://tw.buy.yahoo.com/',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  })
  if (!html) return []

  // Yahoo Shopping (Next.js) embeds page data in __NEXT_DATA__
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]) as Record<string, unknown>
      // Navigate different possible data shapes
      const pageProps = (data?.props as Record<string, unknown>)?.pageProps as Record<string, unknown> | undefined
      const items: unknown[] =
        (pageProps?.searchResult as Record<string, unknown[]> | undefined)?.products ??
        (pageProps?.items as unknown[]) ??
        (pageProps?.productList as unknown[]) ??
        []

      const results: RawReview[] = []
      for (const item of items.slice(0, 6)) {
        const p = item as Record<string, unknown>
        const title = (p?.name ?? p?.title ?? '') as string
        const rating = p?.rating ?? p?.ratingScore ?? p?.avgRating
        const reviewCount = Number(p?.reviewCount ?? p?.commentCount ?? 0)
        const rawUrl = (p?.url ?? p?.pdUrl ?? p?.productUrl ?? '') as string
        if (!title || !/除濕/i.test(title)) continue
        const productUrl = rawUrl.startsWith('http') ? rawUrl : `https://tw.buy.yahoo.com${rawUrl}`
        results.push({
          source: 'Yahoo',
          title,
          snippet: rating
            ? `Yahoo 購物評分 ${rating}/5${reviewCount > 0 ? `，${reviewCount} 則評價` : ''}`
            : 'Yahoo 購物中心有售',
          url: productUrl,
          date: '',
          extra: { likeCount: reviewCount },
        })
        if (results.length >= 2) break
      }
      if (results.length > 0) {
        console.log(`[Yahoo] __NEXT_DATA__ results=${results.length}`)
        return results
      }
    } catch { /* fall through to HTML parse */ }
  }

  // Fallback: parse HTML for product blocks with ratings
  const results: RawReview[] = []
  const blockRe = /<(?:li|div|article)[^>]*class="[^"]*(?:product-item|pditem|item-block)[^"]*"[^>]*>([\s\S]{30,800}?)<\/(?:li|div|article)>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(html)) !== null && results.length < 2) {
    const block = m[1]
    if (!/除濕/.test(block)) continue
    const titleMatch = block.match(/title="([^"]{5,80})"/) ?? block.match(/<[^>]*class="[^"]*(?:name|title)[^"]*"[^>]*>([^<]{5,80})</)
    if (!titleMatch) continue
    const urlMatch = block.match(/href="([^"]+)"/)
    const ratingMatch = block.match(/(\d+(?:\.\d+)?)\s*[\/分]/)
    const countMatch = block.match(/(\d+)\s*則/)
    results.push({
      source: 'Yahoo',
      title: titleMatch[1],
      snippet: ratingMatch
        ? `Yahoo 評分 ${ratingMatch[1]}${countMatch ? `，${countMatch[1]} 則評價` : ''}`
        : 'Yahoo 購物中心有售',
      url: urlMatch ? `https://tw.buy.yahoo.com${urlMatch[1]}` : url,
      date: '',
    })
  }
  console.log(`[Yahoo] HTML fallback results=${results.length}`)
  return results
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function fetchProductReviews(product: ReviewInput): Promise<RawReview[]> {
  const cached = reviewCache.get(product.id)
  if (cached && cached.expires > Date.now()) return cached.data

  const brandTW = product.brand === 'Panasonic' ? '國際牌' :
                  product.brand === 'Mitsubishi' ? '三菱' :
                  product.brand === 'Hitachi' ? '日立' : product.brand

  const youtubeKey = process.env.YOUTUBE_API_KEY

  const tasks = [
    // Mobile01: brand searches + model-specific search
    searchMobile01(`${brandTW} 除濕機 推薦`),
    searchMobile01(`${brandTW} 除濕機 開箱`),
    searchMobile01(`${product.model_id} 除濕機`),
    // Dcard
    searchDcard(`${brandTW} 除濕機 推薦`),
    searchDcard(`${product.model_id} 除濕機`),
    // Shopping platform buyer reviews
    ...(product.momo_url ? [fetchMomoReviews(product.momo_url, product.model_id)] : []),
    searchPChomeReviews(product.model_id),
    searchYahooShopping(product.model_id, brandTW),
    // YouTube (optional)
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

  const counts = ['Mobile01','Dcard','YouTube','momo','PChome','Yahoo']
    .map(s => `${s}=${all.filter(r=>r.source===s).length}`).join(' ')
  console.log(`[reviews] ${product.model_id}: ${counts} total=${all.length}`)
  reviewCache.set(product.id, { data: all, expires: Date.now() + CACHE_TTL })
  return all
}
