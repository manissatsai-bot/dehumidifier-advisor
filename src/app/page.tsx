'use client'

import { useState, useRef, useEffect } from 'react'
import { DecisionBadge } from '@/components/DecisionBadge'
import { HighlightSummary } from '@/components/HighlightSummary'
import { ProductCard } from '@/components/ProductCard'
import { ReviewSection } from '@/components/ReviewSection'
import type { RecommendationResult, SessionState } from '@/lib/types'

type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; recommendation?: RecommendationResult }

const QUICK_PROMPTS = [
  '我租8坪套房，預算一萬五，主要室內晾衣',
  '15坪客廳，預算兩萬，梅雨季除濕用',
  '30坪地下室防潮，預算不限',
  '主臥室8坪，需要超安靜，預算兩萬',
]

const WELCOME: Message = {
  role: 'assistant',
  content: '你好！我是你的除濕機購買顧問。告訴我你的情況，我幫你分析該買哪台、現在買值不值得。\n\n你可以直接說，例如：「我租8坪套房，預算一萬五，主要室內晾衣」',
}

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [session, setSession] = useState<SessionState | undefined>()
  const [expandedProducts, setExpandedProducts] = useState(false)
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
    setExpandedProducts(false)

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
    setExpandedProducts(false)
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-4 py-3 border-b bg-white">
        <div>
          <h1 className="font-bold text-gray-900">除濕機購買顧問</h1>
          <p className="text-xs text-gray-400">AI 幫你分析：該買哪台、現在買划算嗎</p>
        </div>
        <button
          onClick={handleReset}
          className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5"
        >
          重新開始
        </button>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 chat-scroll">
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' ? (
              <div className="max-w-full space-y-3">
                {/* Assistant bubble */}
                <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap max-w-lg shadow-sm">
                  {msg.content}
                </div>

                {/* Recommendation cards */}
                {msg.recommendation && (
                  <div className="space-y-3">
                    {/* Intent summary */}
                    <div className="text-xs text-gray-400 px-1">
                      根據您的需求：{msg.recommendation.intent_summary}
                    </div>

                    {/* Highlight summary */}
                    <HighlightSummary product={msg.recommendation.top_product} />

                    {/* Decision */}
                    <DecisionBadge
                      signal={msg.recommendation.decision.signal}
                      label={msg.recommendation.decision.label}
                      reasons={msg.recommendation.decision.reasons}
                    />

                    {/* Top product */}
                    <ProductCard
                      product={msg.recommendation.top_product}
                      rank={1}
                      isTop
                    />

                    {/* Community reviews */}
                    {msg.recommendation.reviews && (
                      <ReviewSection reviews={msg.recommendation.reviews} />
                    )}

                    {/* More products toggle */}
                    {msg.recommendation.all_products.length > 1 && (
                      <>
                        <button
                          onClick={() => setExpandedProducts(v => !v)}
                          className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                        >
                          {expandedProducts ? '收起' : `查看其他 ${msg.recommendation.all_products.length - 1} 個選項`}
                          <span>{expandedProducts ? '↑' : '↓'}</span>
                        </button>
                        {expandedProducts && msg.recommendation.all_products.slice(1).map((p, i) => (
                          <ProductCard key={p.id} product={p} rank={i + 2} />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm max-w-xs shadow-sm">
                {msg.content}
              </div>
            )}
          </div>
        ))}

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1.5 items-center">
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {messages.length <= 1 && (
        <div className="shrink-0 px-4 pb-2 flex gap-2 overflow-x-auto">
          {QUICK_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => sendMessage(p)}
              className="shrink-0 text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-700 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t bg-white px-4 py-3">
        <form
          onSubmit={e => { e.preventDefault(); sendMessage(input) }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="說說你的需求..."
            disabled={isLoading}
            className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200 disabled:bg-gray-50"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-indigo-600 text-white rounded-xl px-4 py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            送出
          </button>
        </form>
      </div>
    </div>
  )
}
