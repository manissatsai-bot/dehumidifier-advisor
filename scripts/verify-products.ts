/**
 * 嚴格驗證：只用 model_id 搜尋 momo，搜不到就從資料庫移除
 * 用法：npx ts-node scripts/verify-products.ts
 */

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), 'data')

interface Product {
  id: string
  model_id: string
  brand: string
  name_tw: string
  current_price: number
  price_source?: 'momo' | 'estimate'
  [key: string]: unknown
}

function load<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as T
}

async function searchByModelId(
  page: import('playwright').Page,
  modelId: string
): Promise<{ price: number; found: boolean }> {
  const url = `https://www.momoshop.com.tw/search/searchShop.jsp?keyword=${encodeURIComponent(modelId)}&searchType=1&ctype=1&curPage=1`
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
  } catch { /* continue */ }

  return page.evaluate((mid) => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
    for (const el of scripts) {
      try {
        const data = JSON.parse(el.textContent ?? '')
        const graph = data['@graph'] ?? [data]
        for (const node of graph) {
          if (node['@type'] === 'ItemList' && Array.isArray(node.itemListElement)) {
            for (const item of node.itemListElement) {
              const name: string = item?.name ?? ''
              const price = Number(item?.offers?.price ?? 0)
              // 商品名稱必須包含型號（確認是同一台）
              if (
                price >= 3000 &&
                (name.includes('除濕') || name.includes('除溼')) &&
                name.toUpperCase().includes(mid.toUpperCase())
              ) {
                return { price, found: true }
              }
            }
          }
        }
      } catch { /* ignore */ }
    }
    return { price: 0, found: false }
  }, modelId)
}

async function main() {
  const products = load<Product[]>('products.json')
  const history = load<Record<string, unknown[]>>('price-history.json')

  // 只驗證 p0xx
  const pProducts = products.filter(p => p.id.startsWith('p'))
  const sProducts = products.filter(p => p.id.startsWith('s'))

  console.log(`=== 嚴格驗證 ${pProducts.length} 台 p0xx 商品 ===\n`)

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-TW,zh;q=0.9',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  })

  const verified: Product[] = []
  const removed: Product[] = []

  for (const p of pProducts) {
    process.stdout.write(`[${p.id}] ${p.model_id} ... `)
    const result = await searchByModelId(page, p.model_id)

    if (result.found) {
      console.log(`✓ 找到 NT$${result.price.toLocaleString()}`)
      verified.push({ ...p, current_price: result.price, price_source: 'momo' })
    } else {
      console.log(`✗ 找不到，移除`)
      removed.push(p)
    }
    await page.waitForTimeout(1000)
  }

  await browser.close()

  // 合併：s0xx 全部保留 + p0xx 通過驗證的
  const final = [...verified, ...sProducts]

  // 清理移除商品的價格歷史
  for (const p of removed) {
    delete history[p.id]
  }

  fs.writeFileSync(path.join(DATA_DIR, 'products.json'), JSON.stringify(final, null, 2), 'utf-8')
  fs.writeFileSync(path.join(DATA_DIR, 'price-history.json'), JSON.stringify(history, null, 2), 'utf-8')

  console.log(`\n=== 完成 ===`)
  console.log(`保留：${verified.length} 台（p0xx 驗證通過）+ ${sProducts.length} 台（s0xx 爬蟲）= ${final.length} 台`)
  console.log(`移除：${removed.length} 台（型號在 momo 找不到）`)
  console.log(`移除清單：${removed.map(p => `${p.id} ${p.model_id}`).join(', ')}`)
}

main().catch(console.error)
