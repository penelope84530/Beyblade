import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://go-shoot.github.io/x'

const ENDPOINTS = {
  products: `${SOURCE}/db/prod-beys.json`,
  blade: `${SOURCE}/db/part-blade.json`,
  bladeCollab: `${SOURCE}/db/part-blade-collab.json`,
  bladeDivided: `${SOURCE}/db/part-blade-divided.json`,
  ratchet: `${SOURCE}/db/part-ratchet.json`,
  bit: `${SOURCE}/db/part-bit.json`,
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'public', 'data')
const outFile = path.join(outDir, 'catalog.json')

const fetchJson = async (url) => {
  const resp = await fetch(url)
  if (!resp.ok) {
    throw new Error(`Failed to fetch ${url}: ${resp.status}`)
  }
  return resp.json()
}

const normalizeCode = (value = '') => String(value).replace(/[^a-z0-9]/gi, '').toUpperCase()

const parseStatToken = (token) => {
  if (typeof token === 'number') return token
  if (typeof token !== 'string') return null
  const match = token.match(/(\d+)([+-]?)/)
  if (!match) return null
  const base = Number(match[1])
  if (match[2] === '+') return base + 0.5
  if (match[2] === '-') return base - 0.5
  return base
}

const parseStatArray = (stat) => {
  const arr = Array.isArray(stat) ? stat : []
  return {
    rank: parseStatToken(arr[0]),
    raw: arr.map((value) => (typeof value === 'number' ? value : parseStatToken(value))),
  }
}

const lineFromCode = (code = '') => {
  const prefix = String(code).toUpperCase()
  if (prefix.startsWith('BX')) return 'BX'
  if (prefix.startsWith('UX')) return 'UX'
  if (prefix.startsWith('CX')) return 'CX'
  return 'OTHER'
}

const safeString = (value) => (value == null ? '' : String(value).trim())

const buildImages = ({ bladeCode, ratchetCode, bitCode, cxMainCode }) => ({
  blade: bladeCode ? `${SOURCE}/img/blade/${encodeURIComponent(bladeCode)}.png` : null,
  bladeMain: cxMainCode ? `${SOURCE}/img/blade/CX/main/${encodeURIComponent(cxMainCode)}.png` : null,
  ratchet: ratchetCode ? `${SOURCE}/img/ratchet/${encodeURIComponent(ratchetCode)}.png` : null,
  bit: bitCode ? `${SOURCE}/img/bit/${encodeURIComponent(bitCode)}.png` : null,
})

const CX_CATEGORY_LABEL = {
  chip: '紋章',
  main: '主要戰刃',
  assist: '輔助戰刃',
  over: '超越戰刃',
  metal: '鋼鐵戰刃',
  hasbro: 'Hasbro戰刃',
}

const makeCxImageUrl = (category, code) => {
  if (!category || !code) return null
  if (category === 'hasbro') return null
  return `${SOURCE}/img/blade/CX/${encodeURIComponent(category)}/${encodeURIComponent(code)}.png`
}

const splitCombo = (comboRaw = '') => {
  const cleaned = safeString(comboRaw).replace(/=/g, '').replace(/\s+/g, ' ')
  const [bladeCode = '', ratchetCode = '', bitCode = ''] = cleaned.split(' ')

  const cxPieces = bladeCode.includes('.') ? bladeCode.split('.') : []

  return {
    combo: cleaned,
    bladeCode: safeString(bladeCode),
    ratchetCode: safeString(ratchetCode),
    bitCode: safeString(bitCode),
    cxChipCode: cxPieces[0] || '',
    cxMainCode: cxPieces[1] || '',
    cxSuffixCode: cxPieces[2] || '',
  }
}

const parseCxComponents = (bladeCode, cxCategoryMaps) => {
  const tokens = safeString(bladeCode).split('.').filter(Boolean)
  const componentsByCategory = {
    chip: [],
    main: [],
    assist: [],
    over: [],
    metal: [],
    hasbro: [],
  }

  const tokenDetails = []
  const order = ['chip', 'main', 'assist', 'over', 'metal', 'hasbro']

  tokens.forEach((token) => {
    const category = order.find((cat) => cxCategoryMaps[cat]?.has(token)) || 'unknown'
    const idx = category !== 'unknown' ? componentsByCategory[category].length + 1 : 1
    tokenDetails.push({ token, category, idx, label: CX_CATEGORY_LABEL[category] || '未分類' })
    if (category !== 'unknown') componentsByCategory[category].push(token)
  })

  const isCx = tokenDetails.some(({ category }) => category !== 'unknown')
  const isCxExpansion = componentsByCategory.over.length > 0 || componentsByCategory.metal.length > 0

  const componentByCategory = Object.fromEntries(
    Object.entries(componentsByCategory).map(([category, list]) => [category, list[0] || '']),
  )

  const categoryTotal = tokenDetails.reduce((acc, item) => {
    if (item.category === 'unknown') return acc
    acc[item.category] = (acc[item.category] || 0) + 1
    return acc
  }, {})

  return {
    isCx,
    isCxExpansion,
    tokens,
    tokenDetails,
    componentsByCategory,
    componentByCategory,
    displayComponents: tokenDetails
      .filter((item) => item.category !== 'unknown')
      .map((item) => ({
        category: item.category,
        label:
          (categoryTotal[item.category] || 0) > 1
            ? `${CX_CATEGORY_LABEL[item.category] || item.category} ${item.idx}`
            : CX_CATEGORY_LABEL[item.category] || item.category,
        code: item.token,
        image: makeCxImageUrl(item.category, item.token),
      })),
    unknownTokens: tokenDetails.filter((item) => item.category === 'unknown').map((item) => item.token),
  }
}

const pickNames = (part = {}) => {
  const names = part.names || {}
  return {
    jap: safeString(names.jap),
    eng: safeString(names.eng),
    chi: safeString(names.chi),
  }
}

const pickAttrs = (part = {}) => (Array.isArray(part.attr) ? part.attr.map(String) : [])

const buildPartMaps = ({ blade, bladeCollab, bladeDivided, ratchet, bit }) => {
  const mergedBlade = { ...blade, ...bladeCollab }
  const cx = bladeDivided.CX || {}
  const cxCategoryMaps = Object.fromEntries(
    Object.entries(cx).map(([category, entries]) => [category, new Set(Object.keys(entries || {}))]),
  )

  const bladeMap = {}
  Object.entries(mergedBlade).forEach(([code, data]) => {
    const parsedStat = parseStatArray(data.stat)
    bladeMap[code] = {
      code,
      names: pickNames(data),
      attr: pickAttrs(data),
      stat: parsedStat.rank,
      rawStat: parsedStat.raw,
      desc: safeString(data.desc),
      image: `${SOURCE}/img/blade/${encodeURIComponent(code)}.png`,
    }
  })

  const ratchetMap = {}
  Object.entries(ratchet).forEach(([code, data]) => {
    const parsedStat = parseStatArray(data.stat)
    ratchetMap[code] = {
      code,
      names: { eng: code, jap: code, chi: code },
      attr: pickAttrs(data),
      stat: parsedStat.rank,
      rawStat: parsedStat.raw,
      desc: safeString(data.desc),
      image: `${SOURCE}/img/ratchet/${encodeURIComponent(code)}.png`,
    }
  })

  const bitMap = {}
  Object.entries(bit).forEach(([code, data]) => {
    const parsedStat = parseStatArray(data.stat)
    bitMap[code] = {
      code,
      names: pickNames(data),
      attr: pickAttrs(data),
      stat: parsedStat.rank,
      rawStat: parsedStat.raw,
      desc: safeString(data.desc),
      group: safeString(data.group),
      mobility: typeof data.stat?.[1] === 'number' ? data.stat[1] : null,
      image: `${SOURCE}/img/bit/${encodeURIComponent(code)}.png`,
    }
  })

  const cxMainMap = {}
  Object.entries(cx.main || {}).forEach(([code, data]) => {
    const parsedStat = parseStatArray(data.stat)
    cxMainMap[code] = {
      code,
      names: pickNames(data),
      attr: pickAttrs(data),
      stat: parsedStat.rank,
      rawStat: parsedStat.raw,
      desc: safeString(data.desc),
      image: `${SOURCE}/img/blade/CX/main/${encodeURIComponent(code)}.png`,
    }
  })

  return { bladeMap, ratchetMap, bitMap, cxMainMap, cxCategoryMaps }
}

const buildSearchTokens = ({ code, combo, bladeCode, names }) => {
  const raw = [
    code,
    combo,
    bladeCode,
    names?.eng,
    names?.jap,
    names?.chi,
  ]
  return raw
    .flatMap((x) => (x ? [String(x)] : []))
    .map((x) => x.trim())
    .filter(Boolean)
}

const createProduct = (row, index, partMaps, counters, codeCount) => {
  const [codeRaw, productTypeRaw, comboRaw, videoIdRaw, metaRaw] = row
  const code = safeString(codeRaw)
  const productType = safeString(productTypeRaw)
  const videoId = safeString(videoIdRaw)
  const meta = metaRaw && typeof metaRaw === 'object' ? metaRaw : {}
  const parsed = splitCombo(comboRaw)
  const cxParsed = parseCxComponents(parsed.bladeCode, partMaps.cxCategoryMaps)

  const normalizedBaseCode = normalizeCode(code)
  const currentOrder = (counters.get(code) || 0) + 1
  counters.set(code, currentOrder)
  const totalByCode = codeCount.get(code) || 1
  const hasVariants = totalByCode > 1
  const variantNo = String(currentOrder).padStart(2, '0')
  const variantCode = hasVariants ? `${code}-${variantNo}` : code
  const normalizedVariantCode = hasVariants ? `${normalizedBaseCode}${variantNo}` : normalizedBaseCode

  const bladeInfo = partMaps.bladeMap[parsed.bladeCode] || null
  const mainInfo = partMaps.cxMainMap[parsed.cxMainCode] || null
  const ratchetInfo = partMaps.ratchetMap[parsed.ratchetCode] || null
  const bitInfo = partMaps.bitMap[parsed.bitCode] || null

  const formalName = [
    bladeInfo?.names?.eng || parsed.bladeCode,
    parsed.ratchetCode,
    bitInfo?.names?.eng || parsed.bitCode,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  const formalAlias = [
    bladeInfo?.names?.chi || mainInfo?.names?.chi || parsed.bladeCode,
    parsed.ratchetCode,
    bitInfo?.names?.chi || parsed.bitCode,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()

  const images = {
    ...buildImages({ ...parsed, cxMainCode: cxParsed.componentByCategory.main || parsed.cxMainCode }),
    cx: cxParsed.displayComponents,
  }

  const names = {
    eng: formalName,
    chi: formalAlias,
    jap: bladeInfo?.names?.jap || mainInfo?.names?.jap || '',
  }

  return {
    id: `bey-${index + 1}`,
    code,
    variantCode,
    variantNo,
    hasVariants,
    displayCode: variantCode,
    normalizedVariantCode,
    normalizedCode: normalizeCode(code),
    line: lineFromCode(code),
    productType,
    comboRaw: safeString(comboRaw),
    bladeCode: parsed.bladeCode,
    ratchetCode: parsed.ratchetCode,
    bitCode: parsed.bitCode,
    cxChipCode: cxParsed.componentByCategory.chip || parsed.cxChipCode,
    cxMainCode: cxParsed.componentByCategory.main || parsed.cxMainCode,
    cxSuffixCode: parsed.cxSuffixCode,
    cxComponents: cxParsed.componentByCategory,
    cxComponentsAll: cxParsed.componentsByCategory,
    cxDisplayComponents: cxParsed.displayComponents,
    cxUnknownTokens: cxParsed.unknownTokens,
    isCx: cxParsed.isCx,
    isCxExpansion: cxParsed.isCxExpansion,
    videoId: videoId || null,
    meta,
    names,
    formalName,
    formalAlias,
    searchTokens: [
      ...buildSearchTokens({ code, combo: comboRaw, bladeCode: parsed.bladeCode, names }),
      ...(hasVariants
        ? [
            variantCode,
            `${normalizedBaseCode}${variantNo}`,
            `${normalizedBaseCode}-${variantNo}`,
            `${normalizedBaseCode} ${variantNo}`,
          ]
        : []),
    ],
    images,
    isArMain: parsed.cxMainCode === 'Ar',
    attributes: {
      blade: bladeInfo?.attr || [],
      bladeMain: mainInfo?.attr || [],
      ratchet: ratchetInfo?.attr || [],
      bit: bitInfo?.attr || [],
    },
    stats: {
      blade: bladeInfo?.stat ?? null,
      bladeRaw: bladeInfo?.rawStat ?? [],
      bladeMain: mainInfo?.stat ?? null,
      bladeMainRaw: mainInfo?.rawStat ?? [],
      ratchet: ratchetInfo?.stat ?? null,
      ratchetRaw: ratchetInfo?.rawStat ?? [],
      bit: bitInfo?.stat ?? null,
      bitRaw: bitInfo?.rawStat ?? [],
      bitMobility: bitInfo?.mobility ?? null,
    },
  }
}

const run = async () => {
  const [products, blade, bladeCollab, bladeDivided, ratchet, bit] = await Promise.all([
    fetchJson(ENDPOINTS.products),
    fetchJson(ENDPOINTS.blade),
    fetchJson(ENDPOINTS.bladeCollab),
    fetchJson(ENDPOINTS.bladeDivided),
    fetchJson(ENDPOINTS.ratchet),
    fetchJson(ENDPOINTS.bit),
  ])

  const partMaps = buildPartMaps({ blade, bladeCollab, bladeDivided, ratchet, bit })

  const codeCount = products.reduce((map, row) => {
    const code = safeString(row[0])
    map.set(code, (map.get(code) || 0) + 1)
    return map
  }, new Map())

  const counters = new Map()
  const catalog = products.map((row, idx) => createProduct(row, idx, partMaps, counters, codeCount))

  const data = {
    generatedAt: new Date().toISOString(),
    source: `${SOURCE}/products/?blade.CX.main=Ar`,
    summary: {
      total: catalog.length,
      arMainTotal: catalog.filter((item) => item.isArMain).length,
      lines: catalog.reduce((acc, item) => {
        acc[item.line] = (acc[item.line] || 0) + 1
        return acc
      }, {}),
    },
    arMainCatalog: catalog.filter((item) => item.isArMain),
    catalog,
    parts: {
      blade: Object.values(partMaps.bladeMap),
      bladeMainCX: Object.values(partMaps.cxMainMap),
      ratchet: Object.values(partMaps.ratchetMap),
      bit: Object.values(partMaps.bitMap),
    },
  }

  await mkdir(outDir, { recursive: true })
  await writeFile(outFile, JSON.stringify(data, null, 2), 'utf-8')
  console.log(`Wrote ${outFile} with ${catalog.length} products.`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
