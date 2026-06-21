import { NextRequest, NextResponse } from 'next/server'
import { orchestrate } from '@/agents/orchestrator'
import type { SessionState } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const EMPTY_SESSION: SessionState = {
  intent: {},
  history: [],
  turns: 0,
  stage: 'ask_space',
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { message: string; session?: SessionState }
    const { message, session } = body

    if (!message?.trim()) {
      return NextResponse.json({ error: '請輸入訊息' }, { status: 400 })
    }

    const currentSession: SessionState = session ?? { ...EMPTY_SESSION, intent: {}, history: [] }
    const { response, updatedSession } = await orchestrate(message, currentSession)

    return NextResponse.json({ session: updatedSession, ...response })
  } catch (err) {
    console.error('[analyze]', err)
    return NextResponse.json(
      { error: '分析時發生錯誤，請稍後再試' },
      { status: 500 }
    )
  }
}
