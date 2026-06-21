import type { DecisionSignal } from '@/lib/types'

interface Props {
  signal: DecisionSignal
  label: string
  reasons: string[]
}

const CONFIG = {
  GREEN:  { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', dot: 'bg-green-500', icon: '🟢' },
  YELLOW: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-800', dot: 'bg-yellow-500', icon: '🟡' },
  RED:    { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-800', dot: 'bg-red-500', icon: '🔴' },
}

export function DecisionBadge({ signal, label, reasons }: Props) {
  const c = CONFIG[signal]
  return (
    <div className={`rounded-xl border ${c.bg} ${c.border} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{c.icon}</span>
        <span className={`font-bold text-base ${c.text}`}>{label}</span>
      </div>
      <ul className="space-y-1">
        {reasons.map((r, i) => (
          <li key={i} className={`text-sm ${c.text} flex gap-2`}>
            <span className="shrink-0 mt-1.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${c.dot}`} />
            </span>
            {r}
          </li>
        ))}
      </ul>
    </div>
  )
}
