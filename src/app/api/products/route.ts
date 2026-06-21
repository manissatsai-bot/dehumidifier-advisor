import { NextResponse } from 'next/server'
import { getAllProducts } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const products = getAllProducts()
    return NextResponse.json({ products, total: products.length })
  } catch (err) {
    console.error('[products]', err)
    return NextResponse.json({ error: '無法取得商品資料' }, { status: 500 })
  }
}
