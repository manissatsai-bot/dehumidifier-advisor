import type { UserIntent, UsageType, MobilityType } from './types'

function parseChineseNumber(s: string): number {
  const direct = parseInt(s)
  if (!isNaN(direct)) return direct

  const digitMap: Record<string, number> = {
    '零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9,
  }

  let result = 0
  let current = 0

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '萬') { result += (current || 1) * 10000; current = 0 }
    else if (c === '千') { result += (current || 1) * 1000; current = 0 }
    else if (c === '百') { result += (current || 1) * 100; current = 0 }
    else if (c === '十') {
      // 十 at start of string = 10, otherwise N*10
      result += (current === 0 && i === 0 ? 1 : current) * 10
      current = 0
    } else if (digitMap[c] !== undefined) {
      current = digitMap[c]
    }
  }
  result += current
  return result
}

export function regexExtractIntent(message: string): Partial<UserIntent> {
  const intent: Partial<UserIntent> = {}
  const text = message.trim()

  // ── 坪數 ──────────────────────────────────────────────────────────────────
  // Handles: 20坪、二十坪、大概20坪、約20坪
  const spaceMatch = text.match(
    /(?:大概|約|大約|差不多)?([一二三四五六七八九十百兩\d]+)\s*坪/
  )
  if (spaceMatch) {
    const n = parseChineseNumber(spaceMatch[1])
    if (n > 0 && n < 200) intent.space = n
  }

  // ── 預算 ──────────────────────────────────────────────────────────────────
  // Handles: 預算一萬五、15000、一萬五千、兩萬以內、15k、預算不限、沒有預算限制
  if (/預算不限|不限預算|沒有預算|預算隨便|預算無上限|不設預算|預算彈性/.test(text)) {
    intent.budget = 100000
  } else {
    const budgetPatterns = [
      /預算[是為]?([一二三四五六七八九十百兩\d]+[萬千]?[一二三四五六七八九\d]*)/,
      /([一二三四五六七八九十兩\d]+[萬千][一二三四五六七八九\d]*)以?[內下]/,
      /(\d{4,6})\s*(?:元|塊|台幣)?(?:以?[內下預算])?/,
      /(\d+)[kK]/,
    ]
    for (const pat of budgetPatterns) {
      const m = text.match(pat)
      if (m) {
        let n = parseChineseNumber(m[1])
        if (pat.source.includes('[kK]')) n *= 1000
        if (n >= 3000 && n <= 200000) { intent.budget = n; break }
      }
    }
  }

  // ── 用途 ──────────────────────────────────────────────────────────────────
  if (/晾衣|烘衣|衣服/.test(text)) intent.usage = 'dry_clothes'
  else if (/臥室|睡覺|過夜|睡房/.test(text)) intent.usage = 'bedroom'
  else if (/地下室|儲藏|防潮|倉庫/.test(text)) intent.usage = 'basement'
  else if (/除濕|梅雨|潮濕/.test(text)) intent.usage = 'dehumidify'

  // ── 移動性 ────────────────────────────────────────────────────────────────
  if (/移動|搬來搬去|換房間/.test(text)) intent.mobility = 'high'
  else if (/固定|不移動/.test(text)) intent.mobility = 'low'

  // ── 噪音敏感 ──────────────────────────────────────────────────────────────
  if (/安靜|靜音|低噪|噪音/.test(text)) intent.noise_sensitive = true

  // ── 急迫性 ────────────────────────────────────────────────────────────────
  if (/馬上|現在就|急|立刻/.test(text)) intent.urgency = 'immediate'
  else if (/不急|慢慢/.test(text)) intent.urgency = 'flexible'

  return intent
}
