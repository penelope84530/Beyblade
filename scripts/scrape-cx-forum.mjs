import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://forum.gamer.com.tw/C.php?bsn=2696&snA=1139'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'public', 'data')
const outFile = path.join(outDir, 'cx-forum-1139.json')

const decodeHtml = (text = '') =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')

const cleanText = (html = '') =>
  decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\n{2,}/g, '\n')
  )

const run = async () => {
  const resp = await fetch(SOURCE_URL)
  if (!resp.ok) throw new Error(`Failed to fetch ${SOURCE_URL}: ${resp.status}`)
  const html = await resp.text()
  const plain = cleanText(html)

  const lines = plain
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => x.length > 1)

  const targets = [
    { key: 'emblem', label: '紋章' },
    { key: 'mainBlade', label: '主要戰刃' },
    { key: 'assistBlade', label: '輔助戰刃' },
    { key: 'overBlade', label: '超越戰刃' },
    { key: 'metalBlade', label: '鋼鐵戰刃' },
    { key: 'cx', label: 'CX' },
    { key: 'cxx', label: 'CX擴張' },
  ]

  const sections = {}

  targets.forEach(({ key, label }) => {
    const hitIndexes = lines
      .map((line, i) => ({ i, line }))
      .filter(({ line }) => line.includes(label))
      .map(({ i }) => i)
      .slice(0, 20)

    const snippets = []
    hitIndexes.forEach((idx) => {
      const start = Math.max(0, idx - 2)
      const end = Math.min(lines.length - 1, idx + 4)
      snippets.push(lines.slice(start, end + 1).join(' / '))
    })

    sections[key] = {
      label,
      hits: snippets.slice(0, 10),
      hitCount: hitIndexes.length,
    }
  })

  const data = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    title: (html.match(/<title>(.*?)<\/title>/i)?.[1] || '').trim(),
    sections,
  }

  await mkdir(outDir, { recursive: true })
  await writeFile(outFile, JSON.stringify(data, null, 2), 'utf-8')
  console.log(`Wrote ${outFile}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
