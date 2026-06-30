import { NextRequest, NextResponse } from 'next/server'
import { scoreAndRank } from '@/lib/scoring'
import type { Conditions } from '@/lib/scoring'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Conditions
    const recommendations = scoreAndRank(body)
    return NextResponse.json({ recommendations })
  } catch (error) {
    console.error('recommend error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
