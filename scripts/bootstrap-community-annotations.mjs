import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const dataDir = path.join(root, 'public', 'data')

const readJson = async (name) => JSON.parse(await readFile(path.join(dataDir, name), 'utf-8'))

const slotCounts = {
  'bit-tier-renli': 8,
  'blade-tier-renli': 8,
  'ratchet-tier-renli': 8,
  'bey-tier-tiermaker': 20,
}

const partTypeOfBoard = (boardId) => {
  if (boardId.includes('bit')) return 'bit'
  if (boardId.includes('blade')) return 'blade'
  if (boardId.includes('ratchet')) return 'ratchet'
  if (boardId.includes('bey')) return 'bey'
  return 'other'
}

const run = async () => {
  const [community, tier] = await Promise.all([
    readJson('community-intel.json'),
    readJson('tier-1117.json'),
  ])

  const boardEntries = (community.boards || [])
    .filter((b) => b.id !== 'vug-etf-analysis')
    .map((b) => ({
      id: b.id,
      title: b.title,
      sourceImage: b.image,
      tierScale: b.tierScale || [],
      slotCountPerTier: slotCounts[b.id] || 8,
      partType: partTypeOfBoard(b.id),
    }))

  const entries = []
  boardEntries.forEach((board) => {
    board.tierScale.forEach((tierName) => {
      for (let slot = 1; slot <= board.slotCountPerTier; slot += 1) {
        entries.push({
          boardId: board.id,
          partType: board.partType,
          tier: tierName,
          slot,
          code: '',
          nameHint: '',
          confidence: 0,
          source: 'manual',
          status: 'unmapped',
          note: '',
        })
      }
    })
  })

  const tierRows = (tier.entries || []).filter((x) => x.code)
  const slotCursor = {}
  tierRows.forEach((item) => {
    const key = `bey-tier-tiermaker|${item.tier}`
    slotCursor[key] = (slotCursor[key] || 0) + 1
    const slot = slotCursor[key]
    const hit = entries.find((entry) => entry.boardId === 'bey-tier-tiermaker' && entry.tier === item.tier && entry.slot === slot)
    if (!hit) return
    hit.code = item.code
    hit.nameHint = item.name || ''
    hit.confidence = 0.56
    hit.source = 'forum1117-seed'
    hit.status = 'seeded'
    hit.note = '由 forum1117 自動帶入，請對照圖片確認格位是否一致'
  })

  const payload = {
    generatedAt: new Date().toISOString(),
    version: 1,
    sourceSummary: '社群圖片單顆對應代碼人工標註檔',
    howToAnnotate: [
      '每格以 boardId + tier + slot 作為定位。',
      '確認圖片中的單顆後填入 code（例如 UX-03 或 BX-48-02）。',
      'nameHint 可填中文名稱便於複查。',
      'confidence 建議 0~1，人工確認後可設 0.9 以上。',
      'status 建議使用 unmapped / seeded / mapped / verified。'
    ],
    boards: boardEntries,
    entries,
    summary: {
      totalSlots: entries.length,
      seededSlots: entries.filter((x) => x.status === 'seeded').length,
      mappedSlots: entries.filter((x) => x.code).length,
      unmappedSlots: entries.filter((x) => !x.code).length,
    },
  }

  const outFile = path.join(dataDir, 'community-annotations.json')
  await writeFile(outFile, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`Wrote ${outFile} with ${payload.summary.totalSlots} slots.`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
