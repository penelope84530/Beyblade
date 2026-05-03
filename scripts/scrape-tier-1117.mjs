import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://forum.gamer.com.tw/C.php?bsn=2696&snA=1117'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'public', 'data')
const outFile = path.join(outDir, 'tier-1117.json')

const decodeHtml = (text = '') =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')

const normalizeCode = (value = '') => String(value).replace(/[^a-z0-9]/gi, '').toUpperCase()

const stripHtml = (html = '') =>
  decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '\n')
      .replace(/\n{2,}/g, '\n')
  )

const tierDefs = [
  { key: 'T0', start: '【TIER0必買】', end: '【TIER1優先考慮】' },
  { key: 'T1', start: '【TIER1優先考慮】', end: '【TIER2有閒錢可考慮】' },
  { key: 'T2', start: '【TIER2有閒錢可考慮】', end: '【加分項目組】' },
]

const extractSection = (text, startMark, endMark) => {
  const start = text.indexOf(startMark)
  if (start === -1) return ''
  const end = endMark ? text.indexOf(endMark, start + startMark.length) : -1
  return text.slice(start, end === -1 ? undefined : end)
}

const parseTierItems = (tierKey, sectionText) => {
  const lines = sectionText
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 1)

  const items = []

  lines.forEach((line) => {
    if (/^【TIER|^【加分/.test(line)) return
    if (/^Q:|^A:/.test(line)) return

    const codeMatch = line.match(/\b(?:BX|UX|CX)-?\d{2}(?:-\d{2})?\b/)
    if (!codeMatch && !/戰鬥盤|抽包組|入門戰鬥盤組|對戰組/.test(line)) return

    const code = codeMatch ? codeMatch[0].replace(/\s+/g, '') : ''
    const namePart = line
      .replace(codeMatch?.[0] || '', '')
      .replace(/[（(].*$/, '')
      .replace(/^[-:：\s]+/, '')
      .trim()

    const name = namePart || (code ? code : '未命名項目')

    items.push({
      tier: tierKey,
      code,
      normalizedCode: normalizeCode(code),
      name,
      raw: line,
    })
  })

  return items
}

const run = async () => {
  const resp = await fetch(SOURCE_URL)
  if (!resp.ok) throw new Error(`Failed to fetch ${SOURCE_URL}: ${resp.status}`)
  const html = await resp.text()
  const text = stripHtml(html)

  const entries = tierDefs.flatMap(({ key, start, end }) => {
    const section = extractSection(text, start, end)
    return parseTierItems(key, section)
  })

  const unique = []
  const seen = new Set()
  entries.forEach((entry) => {
    const id = `${entry.tier}|${entry.normalizedCode}|${entry.name}`
    if (seen.has(id)) return
    seen.add(id)
    unique.push(entry)
  })

  const tierMapByCode = unique.reduce((acc, entry) => {
    if (!entry.normalizedCode) return acc
    acc[entry.normalizedCode] = entry.tier
    return acc
  }, {})

  const data = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    title: (html.match(/<title>(.*?)<\/title>/i)?.[1] || '').trim(),
    tiers: {
      T0: unique.filter((x) => x.tier === 'T0'),
      T1: unique.filter((x) => x.tier === 'T1'),
      T2: unique.filter((x) => x.tier === 'T2'),
    },
    entries: unique,
    tierMapByCode,
  }

  await mkdir(outDir, { recursive: true })
  await writeFile(outFile, JSON.stringify(data, null, 2), 'utf-8')
  console.log(`Wrote ${outFile} with ${unique.length} tier entries.`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
