import fs from 'fs'
import path from 'path'
import type { Product, PricePoint } from './types'

function readJSON<T>(filename: string): T {
  const filepath = path.join(process.cwd(), 'data', filename)
  const raw = fs.readFileSync(filepath, 'utf-8')
  return JSON.parse(raw) as T
}

export function getAllProducts(): Product[] {
  return readJSON<Product[]>('products.json')
}

export function getProductById(id: string): Product | undefined {
  return getAllProducts().find(p => p.id === id)
}

export function getPriceHistory(productId: string): PricePoint[] {
  const history = readJSON<Record<string, PricePoint[]>>('price-history.json')
  return history[productId] ?? []
}

/** 產生各平台搜尋 URL（即時價格讓用戶點入查看） */
export function getSearchUrls(product: Product): Record<string, string> {
  const q = encodeURIComponent(product.model_id)
  const qName = encodeURIComponent(product.name_tw.slice(0, 20))
  return {
    momo:   `https://www.momoshop.com.tw/search/${q}`,
    PChome: `https://24h.pchome.com.tw/search/?q=${q}`,
    Shopee: `https://shopee.tw/search?keyword=${qName}`,
    ...product.platform_urls,   // 若爬蟲已抓到真實頁面 URL，優先顯示
  }
}
