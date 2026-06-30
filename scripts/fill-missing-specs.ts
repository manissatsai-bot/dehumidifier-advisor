/**
 * 補齊缺漏規格腳本（Claude 知識庫版）
 * 對 products.json 中規格為 null 的產品，
 * 直接讓 Claude 根據型號名稱填入已知或合理估算的規格。
 *
 * 用法：npx ts-node scripts/fill-missing-specs.ts
 */

import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const PRODUCTS_PATH = path.join(process.cwd(), 'data', 'products.json')

type Product = Record<string, unknown>

function loadProducts(): Product[] {
  return JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf-8'))
}

function saveProducts(products: Product[]) {
  fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf-8')
}

function needsFilling(p: Product): boolean {
  return p.coverage_ping === null || p.tank_liters === null
}

async function fillSpecsWithClaude(batch: Product[]): Promise<Record<string, Partial<Product>>> {
  const items = batch.map(p => ({
    id: p.id,
    name: p.name_tw,
    capacity: p.capacity_liters,
    brand: p.brand,
    model_id: p.model_id,
  }))

  const prompt = `你是台灣家電規格資料庫。以下是一批除濕機型號，請根據你對這些機型的知識（或合理估算），補充缺漏的規格。

產品清單：
${JSON.stringify(items, null, 2)}

規格填寫規則：
- coverage_ping：適用坪數（整數）。估算公式：capacity_liters ÷ 0.73，四捨五入到整數。若你知道確切值則用確切值。
- tank_liters：水箱容量（公升）。常見對應：6L機→2-2.5L水箱，9-12L機→3-3.5L，15-18L機→4-4.5L，20-26L機→5-5.5L，28L以上→6L。日本大廠通常比較大。
- noise_db：噪音分貝（整數）。日系大廠（Panasonic/Hitachi/SHARP/Mitsubishi）靜音款38-42dB，其他品牌40-46dB。若是「靜音」型號往低估，「高效」型號往高估。若不確定填 null。
- weight_kg：重量公斤。6L機約6kg，12L約10kg，16L約12kg，20L約15kg，25L約17kg，28L約19kg。
- has_wheels：是否有輪子。一般12L以上多有輪，12L以下多無輪，滾輪型/大型多有輪。

請回傳 JSON，格式：
{
  "<id>": {
    "coverage_ping": 數字,
    "tank_liters": 數字,
    "noise_db": 數字或null,
    "weight_kg": 數字,
    "has_wheels": true/false
  },
  ...
}
只回 JSON，不加其他文字。`

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned) as Record<string, Partial<Product>>
  } catch (e) {
    console.error('[Claude 解析失敗]', (e as Error).message)
    return {}
  }
}

async function main() {
  const products = loadProducts()
  const toFill = products.filter(needsFilling)
  console.log(`=== 補規格腳本（Claude 知識庫版）===`)
  console.log(`需補充：${toFill.length} / ${products.length} 台\n`)

  // 每批 10 筆送給 Claude
  const BATCH = 10
  let filled = 0

  for (let i = 0; i < toFill.length; i += BATCH) {
    const batch = toFill.slice(i, i + BATCH)
    console.log(`[批次 ${Math.floor(i / BATCH) + 1}] 處理 ${batch.length} 台...`)

    const results = await fillSpecsWithClaude(batch)

    for (const [id, specs] of Object.entries(results)) {
      const idx = products.findIndex(p => p.id === id)
      if (idx < 0) continue

      let changed = false
      for (const [key, value] of Object.entries(specs)) {
        if (products[idx][key] === null && value !== null && value !== undefined) {
          products[idx][key] = value
          changed = true
        }
      }
      if (changed) {
        filled++
        console.log(`  ✓ ${String(products[idx].name_tw).slice(0, 40)} → coverage:${products[idx].coverage_ping} tank:${products[idx].tank_liters} noise:${products[idx].noise_db} kg:${products[idx].weight_kg}`)
      }
    }

    saveProducts(products)
  }

  console.log(`\n=== 完成 ===`)
  console.log(`成功補充：${filled} 台`)
}

main().catch(console.error)
