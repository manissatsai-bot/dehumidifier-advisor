/**
 * 針對 p001–p050 用 model_id 去 momo 搜尋，更新真實售價
 * 用法：npx ts-node scripts/update-prices.ts
 */

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')

function load<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as T
}

interface Product {
  id: string
  model_id: string
  brand: string
  name_tw: string
  capacity_liters: number
  current_price: number
  price_source?: 'momo' | 'estimate'
  [key: string]: unknown
}

interface PricePoint {
  price: number
  recorded_at: string
  platform: string
}

async function searchMomoOnce(page: import('playwright').Page, keyword: string): Promise<{ price: number; url: string } | null> {
  const url = `https://www.momoshop.com.tw/search/searchShop.jsp?keyword=${encodeURIComponent(keyword)}&searchType=1&ctype=1&curPage=1`
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
  } catch { /* continue */ }

  return page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    for (const el of scripts) {
      try {
        const data = JSON.parse(el.textContent ?? '')
        const graph = data['@graph'] ?? [data]
        for (const node of graph) {
          if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
            for (const item of node.itemListElement) {
              const price = Number(item?.offers?.price ?? 0)
              const name: string = item?.name ?? ''
              const url: string = item?.url ?? ''
              if (price >= 3000 && url && (name.includes('除濕') || name.includes('除溼'))) {
                return { price, url }
              }
            }
          }
        }
      } catch { /* ignore */ }
    }
    return null
  })
}

const BRAND_TW: Record<string, string> = {
  Panasonic: '國際牌', SHARP: '夏普', Hitachi: '日立', Mitsubishi: '三菱',
  LG: 'LG', SAMPO: '聲寶', HERAN: '禾聯', Whirlpool: '惠而浦',
  Frigidaire: '富及第', CHIMEI: '奇美', TECO: '東元', Sanlux: '三洋',
}

async function searchMomoPrice(page: import('playwright').Page, product: Product): Promise<{ price: number; url: string } | null> {
  // momo 產品頁是 JS 渲染，JSON-LD 格式不一致，改為統一用搜尋結果頁抓價（格式穩定）
  const brandTw = BRAND_TW[product.brand] ?? (product.brand as string) ?? ''
  const strategies = [
    product.model_id,
    `${brandTw} ${product.model_id}`,
    `${brandTw} ${product.capacity_liters}公升 除濕機`,
    product.name_tw.slice(0, 25),
  ]

  for (const keyword of strategies) {
    console.log(`    搜尋：${keyword}`)
    const result = await searchMomoOnce(page, keyword)
    if (result) return result
    await page.waitForTimeout(800)
  }
  return null
}

async function main() {
  const products = load<Product[]>('products.json')
  const priceHistory = load<Record<string, PricePoint[]>>('price-history.json')
  const today = new Date().toISOString().slice(0, 10)

  // 更新所有商品（有 platform_urls.momo 的直接用，其他用搜尋）
  const targets = products
  console.log(`=== 更新全部 ${targets.length} 台商品價格 ===\n`)

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-TW,zh;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })

  let updated = 0
  let notFound = 0

  for (const p of targets) {
    console.log(`[查詢] ${p.id} ${p.model_id}`)
    const found = await searchMomoPrice(page, p)

    if (found && found.price > 1000) {
      const idx = products.findIndex(x => x.id === p.id)
      const oldPrice = products[idx].current_price
      products[idx] = { ...products[idx], current_price: found.price, price_source: 'momo' }

      // 記錄價格歷史
      if (!priceHistory[p.id]) priceHistory[p.id] = []
      if (!priceHistory[p.id].some(h => h.recorded_at === today)) {
        priceHistory[p.id].push({ price: found.price, recorded_at: today, platform: 'momo' })
      }

      console.log(`  → NT$${oldPrice.toLocaleString()} → NT$${found.price.toLocaleString()}`)
      updated++
    } else {
      console.log(`  → 找不到（保留原價 NT$${p.current_price.toLocaleString()}）`)
      notFound++
    }

    await page.waitForTimeout(1200) // 避免被封
  }

  await browser.close()

  fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(products, null, 2), 'utf-8')
  fs.writeFileSync(path.join(DATA_DIR, 'price-history.json'), JSON.stringify(priceHistory, null, 2), 'utf-8')

  console.log(`\n=== 完成 ===`)
  console.log(`更新：${updated} 台 ｜ 找不到：${notFound} 台`)
}

main().catch(console.error)
