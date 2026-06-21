'use client'

import { useState, useRef, useEffect } from 'react'
import { DecisionBadge } from '@/components/DecisionBadge'
import { ProductCard } from '@/components/ProductCard'
import { ReviewSection } from '@/components/ReviewSection'
import type { RecommendationResult, SessionState } from '@/lib/types'

type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; recommendation?: RecommendationResult }

const QUICK_PROMPTS = [
  '8坪套房，預算一萬五，室內晾衣',
  '15坪客廳，預算兩萬，梅雨季除濕',
  '30坪地下室防潮，預算不限',
  '主臥8坪，需要超安靜，預算兩萬',
]

const WELCOME: Message = {
  role: 'assistant',
  content: '您好，歡迎使用除濕機選購顧問服務。\n\n請告訴我您的空間坪數與使用需求，我將為您進行專業評估與推薦。',
}

function AssistantIcon() {
  return (
    <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 1 0 10 10" />
        <path d="M12 6v6l4 2" />
        <circle cx="19" cy="5" r="3" fill="white" stroke="none" />
      </svg>
    </div>
  )
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [session, setSession] = useState<SessionState | undefined>()
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  async function sendMessage(text: string) {
    if (!text.trim() || isLoading) return

    const userMsg: Message = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setIsLoading(true)
    setExpandedIdx(null)

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session }),
      })

      const data = await res.json() as {
        session: SessionState
        type: 'question' | 'recommendation' | 'error'
        message?: string
        data?: RecommendationResult
      }

      if (data.session) setSession(data.session)

      if (data.type === 'question') {
        setMessages(prev => [...prev, { role: 'assistant', content: data.message! }])
      } else if (data.type === 'recommendation') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.data!.explanation,
          recommendation: data.data,
        }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.message ?? '發生錯誤' }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '網路錯誤，請稍後再試。' }])
    } finally {
      setIsLoading(false)
    }
  }

  function handleReset() {
    setMessages([WELCOME])
    setSession(undefined)
    setInput('')
    setExpandedIdx(null)
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-white shadow-xl">

      {/* Header */}
      <header className="shrink-0 border-b border-gray-100 bg-white px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-gray-900 text-sm leading-tight">除濕機選購顧問</h1>
              <p className="text-xs text-gray-400 leading-tight">專業評估 · 即時比價 · AI 推薦</p>
            </div>
          </div>
          <button
            onClick={handleReset}
            className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 hover:border-gray-300 rounded-lg px-3 py-1.5 transition-colors"
          >
            重新諮詢
          </button>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5 chat-scroll bg-slate-50">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-2.5 msg-enter ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && <AssistantIcon />}

            <div className={`${msg.role === 'user' ? 'max-w-xs' : 'max-w-full flex-1'}`}>
              {msg.role === 'assistant' ? (
                <div className="space-y-3">
                  {msg.recommendation ? (
                    <div className="space-y-3">
                      <div className="text-xs text-gray-400 px-1 flex items-center gap-1.5">
                        <span className="w-4 h-px bg-gray-200 inline-block" />
                        根據您的需求：{msg.recommendation.intent_summary}
                        <span className="w-4 h-px bg-gray-200 inline-block" />
                      </div>

                      {/* 1. 推薦機型 */}
                      <ProductCard product={msg.recommendation.top_product} rank={1} isTop />

                      {/* 2. 推薦理由 */}
                      <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap shadow-sm border border-gray-100">
                        {msg.content}
                      </div>

                      {/* 3. 歷史價格 / 購買時機 */}
                      <DecisionBadge
                        signal={msg.recommendation.decision.signal}
                        label={msg.recommendation.decision.label}
                        reasons={msg.recommendation.decision.reasons}
                      />

                      {msg.recommendation.reviews && (
                        <ReviewSection reviews={msg.recommendation.reviews} />
                      )}

                      {/* 4. 備選方案 */}
                      {msg.recommendation.all_products.length > 1 && (
                        <>
                          <button
                            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                            className="text-xs text-indigo-500 hover:text-indigo-700 flex items-center gap-1.5 font-medium transition-colors"
                          >
                            <span className="w-4 h-px bg-indigo-200 inline-block" />
                            {expandedIdx === idx
                              ? '收起其他選項'
                              : `查看另外 ${msg.recommendation.all_products.length - 1} 個備選方案`}
                            <span>{expandedIdx === idx ? '↑' : '↓'}</span>
                          </button>
                          {expandedIdx === idx && msg.recommendation.all_products.slice(1).map((p, i) => (
                            <ProductCard key={p.id} product={p} rank={i + 2} />
                          ))}
                        </>
                      )}
                    </div>
                  ) : (
                    /* 一般對話文字泡泡 */
                    <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap shadow-sm border border-gray-100">
                      {msg.content}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm shadow-sm leading-relaxed">
                  {msg.content}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading */}
        {isLoading && (
          <div className="flex gap-2.5 justify-start msg-enter">
            <AssistantIcon />
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm">
              <div className="flex gap-1.5 items-center">
                <div className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-indigo-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length <= 1 && (
        <div className="shrink-0 px-4 pt-3 pb-1 flex gap-2 overflow-x-auto bg-white border-t border-gray-100">
          {QUICK_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => sendMessage(p)}
              className="shrink-0 text-xs bg-slate-50 border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors whitespace-nowrap"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3">
        <form
          onSubmit={e => { e.preventDefault(); sendMessage(input) }}
          className="flex gap-2 items-end"
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="輸入坪數、用途、預算..."
            disabled={isLoading}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-gray-50 disabled:text-gray-400 transition-all bg-slate-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-indigo-600 text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
          >
            送出
          </button>
        </form>
      </div>
    </div>
  )
}
