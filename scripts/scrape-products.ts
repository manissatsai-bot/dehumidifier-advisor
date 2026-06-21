/**
 * 除濕機資料爬蟲
 *
 * 用法：
 *   npx playwright install chromium   （第一次需要安裝瀏覽器）
 *   npx ts-node scripts/scrape-products.ts
 *
 * 會爬 momo 搜尋結果，提取商品名稱/價格/URL，
 * 再用 Claude 解析規格，最後更新 data/products.json 和 data/price-history.json。
 */

import { chromium, type Browser, type Page } from 'playwright'
import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const DATA_DIR = path.join(process.cwd(), 'data')

// ── 型別 ─────────────────────────────────────────────────────────────────────

interface ScrapedListing {
  name: string
  price: number
  url: string
  platform: 'momo' | 'pchome'
}

interface ParsedSpec {
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
  warranty_years: number
  service_quality: '優' | '良' | '普'
  durability_score: number
}

// ── momo 爬蟲 ────────────────────────────────────────────────────────────────

const MOMO_SEARCH_QUERIES = [
  '除濕機 2024 一級能效',
  '除濕機 2025 節能',
  '大容量除濕機 20公升',
  '除濕機 國際牌 2024',
  '除濕機 日立 2024',
  '除濕機 夏普 2024',
  '除濕機 三菱 2024',
  '除濕機 奇美 東元',
]

async function scrapeMomoSearch(page: Page, query: string): Promise<ScrapedListing[]> {
  const url = `https://www.momoshop.com.tw/search/searchShop.jsp?keyword=${encodeURIComponent(query)}&searchType=1&ctype=1&curPage=1`
  console.log(`[momo] 搜尋：${query}`)

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch {
    console.log(`[momo] 頁面載入逾時，嘗試繼續...`)
  }

  // 直接解析 JSON-LD structured data（momo 把商品資料都嵌在裡面）
  const listings = await page.evaluate(() => {
    const results: Array<{ name: string; price: string; url: string }> = []
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const data = JSON.parse(el.textContent ?? '')
        const graph = data['@graph'] ?? [data]
        for (const node of graph) {
          if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
            for (const item of node.itemListElement) {
              if (item['@type'] === 'Product' && item.offers?.price && item.url) {
                results.push({
                  name: item.name ?? '',
                  price: String(item.offers.price),
                  url: item.url,
                })
              }
            }
          }
        }
      } catch { /* ignore malformed JSON */ }
    })
    return results
  })

  return listings
    .map(l => ({
      name: l.name,
      price: parseInt(l.price) || 0,
      url: l.url,
      platform: 'momo' as const,
    }))
    .filter(l => l.price > 3000 && l.price < 80000)
    .slice(0, 10)
}

// ── 商品詳情頁 ────────────────────────────────────────────────────────────────

async function scrapeProductDetail(page: Page, url: string): Promise<string> {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 })
  } catch {
    // 繼續嘗試讀取已載入的部分
  }

  // 取得規格表和商品描述
  const text = await page.evaluate(() => {
    const specTable = document.querySelector('[class*="spec"], [class*="Spec"], table') as HTMLElement | null
    const desc = document.querySelector('[class*="description"], [class*="Description"], [class*="detail"]') as HTMLElement | null
    return [specTable?.innerText, desc?.innerText].filter(Boolean).join('\n')
  })

  return text.slice(0, 3000) // Claude token 限制
}

// ── Claude 解析規格 ───────────────────────────────────────────────────────────

async function parseSpecWithClaude(
  listing: ScrapedListing,
  pageText: string
): Promise<ParsedSpec | null> {
  const prompt = `從以下台灣電商商品頁面資訊，提取除濕機規格。

商品名稱：${listing.name}
售價：NT$${listing.price}
頁面文字：
${pageText}

請回傳 JSON，欄位如下（找不到則填 null 或合理預設值）：
{
  "model_id": "型號（如 F-YV50MH）",
  "brand": "品牌英文（Panasonic/SHARP/Hitachi/Mitsubishi/LG/SAMPO/HERAN/CHIMEI/TECO/Sanlux/Whirlpool/Frigidaire）",
  "name_tw": "完整中文商品名",
  "capacity_liters": 除濕量數字(公升/日),
  "coverage_ping": 適用坪數數字,
  "tank_liters": 水箱容量數字,
  "noise_db": 噪音dB數字或null,
  "power_watts": 功率瓦數或null,
  "energy_label": "一級/二級/三級",
  "weight_kg": 重量公斤數字,
  "has_wheels": 是否有輪子true/false,
  "warranty_years": 保固年數(Panasonic/Hitachi/Mitsubishi通常3年，其他2年),
  "service_quality": "優/良/普"（日系大廠=優，台灣大牌=良，其他=普）,
  "durability_score": 耐用度1-5（日系大廠4.5，台灣主品牌3.5，其他3.0）
}
只回 JSON，不加其他文字。`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : ''
    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned) as ParsedSpec
  } catch (e) {
    console.error('[Claude] 解析失敗：', (e as Error).message)
    return null
  }
}

// ── 儲存至資料庫 ──────────────────────────────────────────────────────────────

function loadExistingProducts(): Array<Record<string, unknown>> {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'products.json'), 'utf-8'))
  } catch {
    return []
  }
}

function loadPriceHistory(): Record<string, Array<{ price: number; recorded_at: string; platform: string }>> {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'price-history.json'), 'utf-8'))
  } catch {
    return {}
  }
}

function saveResults(
  products: Array<Record<string, unknown>>,
  priceHistory: Record<string, Array<{ price: number; recorded_at: string; platform: string }>>
) {
  fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(products, null, 2), 'utf-8')
  fs.writeFileSync(path.join(DATA_DIR, 'price-history.json'), JSON.stringify(priceHistory, null, 2), 'utf-8')
  console.log(`[儲存] products.json (${products.length} 台), price-history.json 已更新`)
}

// ── 主程式 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== 除濕機資料爬蟲啟動 ===')
  console.log('提示：第一次請先執行 npx playwright install chromium')
  console.log('')

  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const existingProducts = loadExistingProducts()
  const priceHistory = loadPriceHistory()
  const existingModelIds = new Set(existingProducts.map(p => p.model_id as string))
  const newProducts: Array<Record<string, unknown>> = [...existingProducts]
  const today = new Date().toISOString().slice(0, 10)
  let newCount = 0
  let updateCount = 0

  try {
    const page = await browser.newPage()
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })

    const allListings: ScrapedListing[] = []
    const seenUrls = new Set<string>()

    // ── 爬 momo 搜尋頁 ──
    for (const query of MOMO_SEARCH_QUERIES) {
      const listings = await scrapeMomoSearch(page, query)
      for (const l of listings) {
        if (!seenUrls.has(l.url)) {
          seenUrls.add(l.url)
          allListings.push(l)
        }
      }
      await page.waitForTimeout(2000) // 避免被封
    }

    console.log(`\n[搜尋] 共找到 ${allListings.length} 筆不重複商品`)

    // ── 逐一解析規格 ──
    for (const listing of allListings) {
      console.log(`\n[處理] ${listing.name.slice(0, 40)} - NT$${listing.price}`)

      const pageText = await scrapeProductDetail(page, listing.url)
      await page.waitForTimeout(1500)

      const spec = await parseSpecWithClaude(listing, pageText)
      if (!spec || !spec.model_id || !spec.capacity_liters) {
        console.log('  → 規格解析失敗，跳過')
        continue
      }

      // 產品是否已存在
      const existingIdx = newProducts.findIndex(p => p.model_id === spec.model_id)

      if (existingIdx >= 0) {
        // 更新價格
        const existing = newProducts[existingIdx]
        const prevPrice = existing.current_price as number
        if (prevPrice !== listing.price) {
          newProducts[existingIdx] = { ...existing, current_price: listing.price }
          console.log(`  → 更新價格：NT$${prevPrice} → NT$${listing.price}`)
          updateCount++
        }
      } else {
        // 新增商品
        const id = `s${String(newProducts.length + 1).padStart(3, '0')}`
        const newProduct: Record<string, unknown> = {
          id,
          ...spec,
          current_price: listing.price,
          platform_urls: { [listing.platform]: listing.url },
        }
        newProducts.push(newProduct)
        console.log(`  → 新增：${spec.name_tw} (${id})`)
        newCount++
      }

      // 記錄價格歷史
      const productId = existingIdx >= 0
        ? newProducts[existingIdx].id as string
        : `s${String(newProducts.length).padStart(3, '0')}`

      if (!priceHistory[productId]) priceHistory[productId] = []
      // 只記錄今天的（避免重複）
      if (!priceHistory[productId].some(h => h.recorded_at === today)) {
        priceHistory[productId].push({
          price: listing.price,
          recorded_at: today,
          platform: listing.platform,
        })
      }
    }

    await page.close()
  } finally {
    await browser.close()
  }

  saveResults(newProducts, priceHistory)
  console.log(`\n=== 完成 ===`)
  console.log(`新增：${newCount} 台，更新價格：${updateCount} 台，資料庫總計：${newProducts.length} 台`)
}

main().catch(console.error)
