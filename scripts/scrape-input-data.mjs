import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FORUM_URL = 'https://forum.gamer.com.tw/C.php?bsn=2696&snA=1117'
const PRODUCTS_URL = 'https://go-shoot.github.io/x/products/'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const dataDir = path.join(root, 'public', 'data')

const normalize = (value = '') => String(value).replace(/[^a-z0-9\u4e00-\u9fff]/gi, '').toUpperCase()
const asArray = (value) => (Array.isArray(value) ? value : [])

const readJson = async (fileName) => {
  const file = path.join(dataDir, fileName)
  const text = await readFile(file, 'utf-8')
  return JSON.parse(text)
}

const safeString = (v) => (v == null ? '' : String(v).trim())

const htmlTitle = (html = '') => safeString(html.match(/<title>(.*?)<\/title>/i)?.[1] || '')

const extractForumMentions = (html = '') => {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')

  const codeMatches = text.match(/\b(?:BX|UX|CX)-?\d{2}(?:-\d{2})?\b/g) || []
  const unique = [...new Set(codeMatches.map((x) => x.toUpperCase()))]
  return unique.slice(0, 200)
}

const aliasesForItem = (item) => {
  const aliases = new Set()

  const add = (v) => {
    if (!v) return
    aliases.add(String(v))
  }

  const code = safeString(item.code)
  const displayCode = safeString(item.displayCode || item.variantCode)
  const variantNo = safeString(item.variantNo)

  add(code)
  add(displayCode)

  if (code) {
    const compactBase = code.replace(/-/g, '')
    add(compactBase)
    if (variantNo) {
      add(`${compactBase}${variantNo}`)
      add(`${compactBase} ${variantNo}`)
      add(`${compactBase}-${variantNo}`)
    }
  }

  add(item.formalAlias)
  add(item.formalName)
  add(item.names?.chi)
  add(item.names?.eng)
  add(item.names?.jap)
  add(item.bladeCode)
  add(item.ratchetCode)
  add(item.bitCode)

  return [...aliases].filter((x) => x.trim().length > 0)
}

const resolveTier = (item, tierMap) => {
  const keys = [
    normalize(item.displayCode),
    normalize(item.variantCode),
    normalize(item.code),
    normalize(item.normalizedVariantCode),
    normalize(item.normalizedCode),
  ].filter(Boolean)

  for (const key of keys) {
    if (tierMap[key]) return tierMap[key]
  }
  return 'NA'
}

const run = async () => {
  const [catalogData, tierData, forumBoardData, forumHtml, productsHtml] = await Promise.all([
    readJson('catalog.json'),
    readJson('tier-1117.json'),
    readJson('forum-board-2696.json').catch(() => ({ latestPosts: [], featuredPosts: [], source: '' })),
    fetch(FORUM_URL).then((r) => (r.ok ? r.text() : '')),
    fetch(PRODUCTS_URL).then((r) => (r.ok ? r.text() : '')),
  ])

  const tierMap = tierData.tierMapByCode || {}

  const inputs = (catalogData.catalog || []).map((item) => ({
    id: item.id,
    code: item.code,
    displayCode: item.displayCode || item.code,
    variantNo: item.variantNo || null,
    line: item.line,
    names: item.names || {},
    formalName: item.formalName || '',
    formalAlias: item.formalAlias || '',
    parts: {
      blade: item.bladeCode || '',
      ratchet: item.ratchetCode || '',
      bit: item.bitCode || '',
    },
    tier: resolveTier(item, tierMap),
    aliases: aliasesForItem(item),
  }))

  const payload = {
    generatedAt: new Date().toISOString(),
    sources: {
      forum1117: {
        url: FORUM_URL,
        title: htmlTitle(forumHtml),
        mentionCodes: extractForumMentions(forumHtml),
      },
      forumBoard2696: {
        url: forumBoardData.source || 'https://forum.gamer.com.tw/B.php?bsn=2696',
        latestPosts: asArray(forumBoardData.latestPosts).slice(0, 20),
        featuredPosts: asArray(forumBoardData.featuredPosts).slice(0, 20),
      },
      goShootProducts: {
        url: PRODUCTS_URL,
        title: htmlTitle(productsHtml),
      },
    },
    summary: {
      totalInputs: inputs.length,
      tierCounts: inputs.reduce(
        (acc, item) => {
          acc[item.tier] = (acc[item.tier] || 0) + 1
          return acc
        },
        { T0: 0, T1: 0, T2: 0, NA: 0 },
      ),
    },
    inputs,
  }

  const outFile = path.join(dataDir, 'input-data.json')
  await writeFile(outFile, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`Wrote ${outFile} with ${inputs.length} input records.`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
