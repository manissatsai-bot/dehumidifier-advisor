import type { CuratedReviews } from '@/lib/types'

interface Props {
  reviews: CuratedReviews
}

const SENTIMENT_CONFIG = {
  positive: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', label: '整體好評' },
  mixed:    { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', label: '評價褒貶不一' },
  negative: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', label: '負評居多' },
  unknown:  { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600', label: '評價不足' },
}

const SOURCE_BADGE: Record<string, string> = {
  PTT:     'bg-orange-100 text-orange-700',
  Dcard:   'bg-blue-100 text-blue-700',
  YouTube: 'bg-red-100 text-red-700',
}

const QUOTE_SENTIMENT_ICON: Record<string, string> = {
  positive: '✅',
  negative: '⚠️',
  neutral:  '💬',
}

export function ReviewSection({ reviews }: Props) {
  const { pros, cons, highlights, overall_sentiment, review_count } = reviews
  const hasContent = pros.length > 0 || cons.length > 0 || highlights.length > 0

  if (!hasContent) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
        網友評論資料收集中，稍後再試
      </div>
    )
  }

  const cfg = SENTIMENT_CONFIG[overall_sentiment]

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700">PTT / Dcard 網友評價</h4>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
            {cfg.label}
          </span>
          <span className="text-xs text-gray-400">{review_count} 則討論</span>
        </div>
      </div>

      {/* Pros & Cons */}
      {(pros.length > 0 || cons.length > 0) && (
        <div className="grid grid-cols-2 gap-2">
          {pros.length > 0 && (
            <div className="bg-green-50 border border-green-100 rounded-xl p-3 space-y-1.5">
              <div className="text-xs font-semibold text-green-700 mb-2">網友說讚</div>
              {pros.map((p, i) => (
                <div key={i} className="flex gap-1.5 text-xs text-green-800">
                  <span className="shrink-0">＋</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          )}
          {cons.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 space-y-1.5">
              <div className="text-xs font-semibold text-amber-700 mb-2">網友抱怨</div>
              {cons.map((c, i) => (
                <div key={i} className="flex gap-1.5 text-xs text-amber-800">
                  <span className="shrink-0">－</span>
                  <span>{c}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Highlight quotes */}
      {highlights.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 font-medium">精選評論</div>
          {highlights.map((h, i) => (
            <a
              key={i}
              href={h.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-gray-100 bg-gray-50 hover:bg-gray-100 p-3 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm">{QUOTE_SENTIMENT_ICON[h.sentiment]}</span>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${SOURCE_BADGE[h.source]}`}>
                  {h.source}
                </span>
              </div>
              <p className="text-xs text-gray-700 leading-relaxed">「{h.quote}」</p>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
