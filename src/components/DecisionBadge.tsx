import type { DecisionSignal } from '@/lib/types'

interface Props {
  signal: DecisionSignal
  label: string
  reasons: string[]
}

const CONFIG = {
  GREEN:  {
    wrapper: 'bg-green-50 border-green-200',
    header:  'bg-green-100',
    icon:    '✓',
    iconCls: 'bg-green-500 text-white',
    label:   'text-green-800',
    dot:     'bg-green-500',
    text:    'text-green-700',
  },
  YELLOW: {
    wrapper: 'bg-amber-50 border-amber-200',
    header:  'bg-amber-100',
    icon:    '~',
    iconCls: 'bg-amber-400 text-white',
    label:   'text-amber-800',
    dot:     'bg-amber-400',
    text:    'text-amber-700',
  },
  RED:    {
    wrapper: 'bg-red-50 border-red-200',
    header:  'bg-red-100',
    icon:    '✕',
    iconCls: 'bg-red-500 text-white',
    label:   'text-red-800',
    dot:     'bg-red-400',
    text:    'text-red-700',
  },
}

export function DecisionBadge({ signal, label, reasons }: Props) {
  const c = CONFIG[signal]
  return (
    <div className={`rounded-2xl border overflow-hidden ${c.wrapper}`}>
      <div className={`${c.header} px-4 py-2.5 flex items-center gap-2.5`}>
        <span className={`w-5 h-5 rounded-full ${c.iconCls} flex items-center justify-center text-xs font-bold shrink-0`}>
          {c.icon}
        </span>
        <span className={`font-bold text-sm ${c.label}`}>{label}</span>
      </div>
      <ul className="px-4 py-3 space-y-1.5">
        {reasons.map((r, i) => (
          <li key={i} className={`text-xs flex gap-2 ${c.text}`}>
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
