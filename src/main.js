import './style.css'

const STORAGE_KEY = 'beyblade-settings-v1'

const ATTR_SCORE = {
  att: { attack: 18, mobility: 10 },
  def: { defense: 18, balance: 8 },
  sta: { stamina: 18, balance: 6 },
  bal: { balance: 16, attack: 5, defense: 5, stamina: 5 },
}

const STYLE_WEIGHTS = {
  attack: { attack: 0.4, mobility: 0.3, stamina: 0.1, defense: 0.1, balance: 0.1 },
  defense: { defense: 0.4, balance: 0.25, stamina: 0.2, attack: 0.05, mobility: 0.1 },
  stamina: { stamina: 0.45, balance: 0.25, defense: 0.2, attack: 0.05, mobility: 0.05 },
  balanced: { attack: 0.2, defense: 0.2, stamina: 0.2, mobility: 0.2, balance: 0.2 },
}

const TYPE_FACTOR = {
  S: { attack: 2, mobility: 1 },
  B: { attack: 1, stamina: 1 },
  St: { balance: 2, defense: 1 },
  SS: { defense: 3, stamina: 1 },
  RB: { mobility: 2, attack: 1 },
  Lm: { balance: 1 },
}

const BIT_GROUP_FACTOR = {
  flat: { attack: 6, mobility: 7 },
  sharp: { stamina: 7, defense: 2 },
  ball: { defense: 6, balance: 4 },
  point: { balance: 6, stamina: 3 },
}

const DESC_FACTOR_RULES = [
  { re: /離心|突進|衝撞|攻擊|x dash|dash/i, gain: { attack: 5, mobility: 4 } },
  { re: /防禦|抵受|守|guard/i, gain: { defense: 5, balance: 2 } },
  { re: /持久|續航|旋轉|stamina/i, gain: { stamina: 5, balance: 2 } },
  { re: /平衡|balance/i, gain: { balance: 5 } },
]

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n))
const asArray = (x) => (Array.isArray(x) ? x : [])
const normalized = (text = '') => String(text).normalize('NFKC').replace(/[^a-z0-9\u4e00-\u9fff]/gi, '').toUpperCase()

const searchTokensOf = (item) => {
  const cxPieces = asArray(item.cxDisplayComponents).flatMap((comp) => [comp?.label, comp?.code])
  return [
    item.code,
    item.displayCode,
    item.variantCode,
    item.formalAlias,
    item.formalName,
    item.names?.chi,
    item.names?.eng,
    item.names?.jap,
    item.bladeCode,
    item.ratchetCode,
    item.bitCode,
    ...cxPieces,
    ...(item.searchTokens || []),
  ]
    .filter(Boolean)
    .map((x) => String(x).trim())
    .filter(Boolean)
}

const toTag = (line) => {
  if (line === 'BX' || line === 'UX' || line === 'CX') return line
  return 'OTHER'
}

const radarPoints = (profile) => {
  const keys = ['attack', 'defense', 'stamina', 'balance', 'mobility']
  return keys
    .map((key, i) => {
      const angle = (Math.PI * 2 * i) / keys.length - Math.PI / 2
      const value = clamp(profile[key] || 0)
      const radius = 44 * (value / 100)
      const x = 50 + radius * Math.cos(angle)
      const y = 50 + radius * Math.sin(angle)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

const applyGain = (profile, gain) => {
  Object.entries(gain || {}).forEach(([k, v]) => {
    profile[k] = (profile[k] || 0) + v
  })
}

const statVectorBoost = (raw = []) => {
  const numbers = asArray(raw).filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (!numbers.length) return { attack: 0, defense: 0, stamina: 0, mobility: 0, balance: 0 }

  const rank = numbers[0] || 0
  const avg = numbers.reduce((a, b) => a + b, 0) / numbers.length
  const variance = numbers.length > 1 ? Math.max(...numbers) - Math.min(...numbers) : 0

  return {
    attack: rank * 0.8 + variance * 0.015,
    defense: rank * 0.6 + avg * 0.03,
    stamina: rank * 0.7 + avg * 0.02,
    mobility: rank * 0.5 + variance * 0.02,
    balance: rank * 0.6,
  }
}

const profileFromParts = ({ blade, bladeMain, ratchet, bit, productType }) => {
  const p = { attack: 35, defense: 35, stamina: 35, balance: 35, mobility: 35 }

  const addAttr = (attrs) => {
    asArray(attrs).forEach((attr) => {
      const bonus = ATTR_SCORE[attr]
      if (!bonus) return
      Object.entries(bonus).forEach(([k, v]) => {
        p[k] += v
      })
    })
  }

  addAttr(blade?.attr)
  addAttr(bladeMain?.attr)
  addAttr(ratchet?.attr)
  addAttr(bit?.attr)

  applyGain(p, statVectorBoost(blade?.rawStat))
  applyGain(p, statVectorBoost(bladeMain?.rawStat))
  applyGain(p, statVectorBoost(ratchet?.rawStat))
  applyGain(p, statVectorBoost(bit?.rawStat))

  if (typeof blade?.stat === 'number') p.attack += blade.stat * 2
  if (typeof bladeMain?.stat === 'number') p.stamina += bladeMain.stat * 2
  if (typeof ratchet?.stat === 'number') p.defense += ratchet.stat * 2
  if (typeof bit?.stat === 'number') p.mobility += bit.stat * 2
  if (typeof bit?.mobility === 'number') p.mobility += bit.mobility / 4

  const descText = [blade?.desc, bladeMain?.desc, ratchet?.desc, bit?.desc]
    .filter(Boolean)
    .join(' ')
  DESC_FACTOR_RULES.forEach(({ re, gain }) => {
    if (re.test(descText)) applyGain(p, gain)
  })

  const groupGain = BIT_GROUP_FACTOR[(bit?.group || '').toLowerCase()]
  if (groupGain) applyGain(p, groupGain)

  const baseType = String(productType || '').split(' ')[0]
  if (TYPE_FACTOR[baseType]) applyGain(p, TYPE_FACTOR[baseType])

  p.attack = clamp(p.attack)
  p.defense = clamp(p.defense)
  p.stamina = clamp(p.stamina)
  p.balance = clamp((p.attack + p.defense + p.stamina) / 3)
  p.mobility = clamp(p.mobility)

  const strength = clamp((p.attack + p.defense + p.stamina + p.balance + p.mobility) / 5)
  return { ...p, strength }
}

const scoreForStyle = (profile, style) => {
  const weight = STYLE_WEIGHTS[style] || STYLE_WEIGHTS.balanced
  return Object.entries(weight).reduce((acc, [k, w]) => acc + (profile[k] || 0) * w, 0)
}

const createBuildName = (blade, ratchet, bit) => {
  const formalName = [blade?.names?.eng || blade?.code, ratchet?.code, bit?.names?.eng || bit?.code]
    .filter(Boolean)
    .join(' ')
  const formalAlias = [blade?.names?.chi || blade?.code, ratchet?.code, bit?.names?.chi || bit?.code]
    .filter(Boolean)
    .join(' ')
  return { formalName, formalAlias }
}

const formatPartRow = (label, value, img, options = {}) => `
  <li>
    <span>${label}</span>
    <strong>
      ${value || '-'}
      ${options.tier ? `<em class="part-tier">${options.tier}</em>` : ''}
    </strong>
    ${img ? `<img src="${img}" alt="${label}" loading="lazy" onerror="this.style.display='none'" />` : ''}
    ${
      options.canDelete
        ? `<button type="button" class="part-remove" data-action="remove-part" data-code="${options.code}" data-part="${options.part}">刪除</button>`
        : ''
    }
  </li>
`

const formatCxComponentRows = (components = []) =>
  components
    .map(
      (comp) => `
    <li>
      <span>${comp.label}</span>
      <strong>
        ${comp.code || '-'}
        ${comp.tier ? `<em class="part-tier">${comp.tier}</em>` : ''}
      </strong>
      ${comp.image ? `<img src="${comp.image}" alt="${comp.label}" loading="lazy" onerror="this.style.display='none'" />` : ''}
    </li>
  `,
    )
    .join('')

const formatTierScale = (tiers = []) =>
  asArray(tiers)
    .map((tier) => `<span class="community-tier-chip">${tier}</span>`)
    .join('')

const app = document.querySelector('#app')

const normalizeSettings = (raw = {}) => {
  const settings = { ...raw }
  settings.ownedInputs = asArray(settings.ownedInputs)
  settings.partOverrides = settings.partOverrides && typeof settings.partOverrides === 'object' ? settings.partOverrides : {}
  settings.customBuildSlots = asArray(settings.customBuildSlots)
  while (settings.customBuildSlots.length < 3) {
    settings.customBuildSlots.push({ bladeCode: '', ratchetCode: '', bitCode: '' })
  }
  settings.customBuildSlots = settings.customBuildSlots.slice(0, 3).map((slot) => ({
    bladeCode: String(slot?.bladeCode || '').trim(),
    ratchetCode: String(slot?.ratchetCode || '').trim(),
    bitCode: String(slot?.bitCode || '').trim(),
  }))
  return settings
}

const boot = async () => {
  const [settingsResp, dataResp, tierResp, inputResp, communityResp, annotationResp] = await Promise.all([
    fetch('./settings.json'),
    fetch('./data/catalog.json'),
    fetch('./data/tier-1117.json').catch(() => null),
    fetch('./data/input-data.json').catch(() => null),
    fetch('./data/community-intel.json').catch(() => null),
    fetch('./data/community-annotations.json').catch(() => null),
  ])

  const defaults = await settingsResp.json()
  const data = await dataResp.json()
  const tierData = tierResp?.ok ? await tierResp.json() : { entries: [], tierMapByCode: {}, source: '' }
  const inputData = inputResp?.ok ? await inputResp.json() : { inputs: [] }
  const communityData = communityResp?.ok ? await communityResp.json() : { boards: [], sourceSummary: '' }
  const annotationData = annotationResp?.ok ? await annotationResp.json() : { boards: [], entries: [], summary: {} }

  const partTierOrder = new Map()
  asArray(annotationData.boards).forEach((board) => {
    asArray(board.tierScale).forEach((tier, idx) => {
      partTierOrder.set(`${board.id}|${tier}`, idx)
    })
  })

  const partTierMap = {
    blade: new Map(),
    ratchet: new Map(),
    bit: new Map(),
  }

  const partTierQuality = (entry) => {
    const statusWeight = entry.status === 'verified' ? 3 : entry.status === 'mapped' ? 2 : entry.status === 'seeded' ? 1 : 0
    const confidenceWeight = typeof entry.confidence === 'number' ? entry.confidence : 0
    return statusWeight * 10 + confidenceWeight
  }

  asArray(annotationData.entries).forEach((entry) => {
    if (!entry?.code || !partTierMap[entry.partType]) return
    const key = normalized(entry.code)
    if (!key) return

    const next = {
      tier: entry.tier,
      tierOrder: partTierOrder.get(`${entry.boardId}|${entry.tier}`) ?? 999,
      quality: partTierQuality(entry),
    }

    const prev = partTierMap[entry.partType].get(key)
    if (!prev || next.tierOrder < prev.tierOrder || (next.tierOrder === prev.tierOrder && next.quality > prev.quality)) {
      partTierMap[entry.partType].set(key, next)
    }
  })

  const resolvePartTier = (partType, code) => {
    if (!code || !partTierMap[partType]) return ''
    return partTierMap[partType].get(normalized(code))?.tier || ''
  }

  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
  const settings = normalizeSettings(saved && typeof saved === 'object' ? { ...defaults, ...saved } : defaults)

  const parts = {
    blade: Object.fromEntries(asArray(data.parts?.blade).map((p) => [p.code, p])),
    bladeMainCX: Object.fromEntries(asArray(data.parts?.bladeMainCX).map((p) => [p.code, p])),
    ratchet: Object.fromEntries(asArray(data.parts?.ratchet).map((p) => [p.code, p])),
    bit: Object.fromEntries(asArray(data.parts?.bit).map((p) => [p.code, p])),
  }

  const catalog = asArray(data.catalog)
  const byVariantCode = new Map()
  const byBaseCode = new Map()
  const byAnyCode = new Map()

  const addCatalogKey = (key, item) => {
    const norm = normalized(key)
    if (!norm) return
    if (!byAnyCode.has(norm)) byAnyCode.set(norm, item)
  }

  const inputAliasByCode = new Map()
  asArray(inputData.inputs).forEach((entry) => {
    const aliases = asArray(entry.aliases).filter(Boolean)
    const keys = [normalized(entry.code), normalized(entry.displayCode)]
    keys.forEach((key) => {
      if (!key) return
      if (!inputAliasByCode.has(key)) inputAliasByCode.set(key, new Set())
      aliases.forEach((alias) => inputAliasByCode.get(key).add(alias))
    })
  })

  const tierAliasByCode = new Map()
  asArray(tierData.entries).forEach((entry) => {
    const key = normalized(entry.code)
    if (!key) return
    if (!tierAliasByCode.has(key)) tierAliasByCode.set(key, new Set())
    if (entry.name) tierAliasByCode.get(key).add(entry.name)
    if (entry.raw) tierAliasByCode.get(key).add(entry.raw)
  })

  catalog.forEach((item) => {
    const base = normalized(item.code)
    const variant = normalized(item.variantCode || item.code)
    const variantLoose = normalized(item.normalizedVariantCode || '')

    const mergedTokens = new Set(asArray(item.searchTokens))
    ;[base, variant, variantLoose].forEach((key) => {
      ;[inputAliasByCode.get(key), tierAliasByCode.get(key)].forEach((setLike) => {
        if (!setLike) return
        setLike.forEach((value) => mergedTokens.add(value))
      })
    })
    item.searchTokens = [...mergedTokens]

    addCatalogKey(item.code, item)
    addCatalogKey(item.displayCode, item)
    addCatalogKey(item.variantCode, item)
    addCatalogKey(item.normalizedCode, item)
    addCatalogKey(item.normalizedVariantCode, item)

    if (!byBaseCode.has(base)) byBaseCode.set(base, [])
    byBaseCode.get(base).push(item)

    byVariantCode.set(variant, item)
    if (variantLoose) byVariantCode.set(variantLoose, item)

    if (item.hasVariants && item.variantNo) {
      byVariantCode.set(normalized(`${base} ${item.variantNo}`), item)
      byVariantCode.set(normalized(`${base}-${item.variantNo}`), item)
      byVariantCode.set(normalized(`${base}${item.variantNo}`), item)
    }
  })

  const resolveInput = (raw) => {
    const input = String(raw || '').trim()
    if (!input) return null
    const inputNorm = normalized(input)

    const codeHit = byVariantCode.get(inputNorm)
    if (codeHit) return codeHit

    const baseList = byBaseCode.get(inputNorm)
    if (baseList?.length === 1) return baseList[0]

    const exactHit = catalog.find((item) => {
      const tokens = searchTokensOf(item).map(normalized)
      return tokens.some((token) => token && token === inputNorm)
    })
    if (exactHit) return exactHit

    return (
      catalog.find((item) => {
        const tokens = searchTokensOf(item).map(normalized)
        return tokens.some((token) => token && token.includes(inputNorm))
      }) || null
    )
  }

  const resolveCatalogByCode = (rawCode) => {
    const key = normalized(rawCode)
    if (!key) return null
    return byAnyCode.get(key) || null
  }

  const state = {
    settings,
    ownedItems: [],
    unresolvedInputs: [],
    tierQuery: '',
    tierFilter: 'ALL',
  }

  const persist = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings, null, 2))
  }

  const rerenderPreserveView = (focusSelector = '', caretStart = null, caretEnd = null) => {
    const y = window.scrollY
    render()
    window.scrollTo({ top: y, behavior: 'auto' })
    if (!focusSelector) return
    const el = document.querySelector(focusSelector)
    if (!el) return
    el.focus({ preventScroll: true })
    if (typeof caretStart === 'number' && typeof el.setSelectionRange === 'function') {
      el.setSelectionRange(caretStart, typeof caretEnd === 'number' ? caretEnd : caretStart)
    }
  }

  const rebuildOwned = () => {
    const resolved = []
    const unresolved = []
    const seen = new Set()

    asArray(state.settings.ownedInputs).forEach((raw) => {
      const hit = resolveInput(raw)
      if (!hit) {
        unresolved.push(raw)
        return
      }
      if (seen.has(hit.id)) return
      seen.add(hit.id)
      resolved.push(hit)
    })

    state.ownedItems = resolved
    state.unresolvedInputs = unresolved
  }

  const lineSummary = () =>
    state.ownedItems.reduce(
      (acc, item) => {
        const tag = toTag(item.line)
        acc[tag] = (acc[tag] || 0) + 1
        return acc
      },
      { BX: 0, UX: 0, CX: 0, OTHER: 0 },
    )

  const makeBuildFromCatalogItem = (item) => {
    const override = state.settings.partOverrides?.[item.code] || {}
    const bladeCode = Object.prototype.hasOwnProperty.call(override, 'bladeCode') ? override.bladeCode : item.bladeCode
    const ratchetCode = Object.prototype.hasOwnProperty.call(override, 'ratchetCode') ? override.ratchetCode : item.ratchetCode
    const bitCode = Object.prototype.hasOwnProperty.call(override, 'bitCode') ? override.bitCode : item.bitCode

    const blade = bladeCode ? parts.blade[bladeCode] || { code: bladeCode, names: { eng: bladeCode, chi: bladeCode } } : null
    const cxMainFromItem = item?.cxComponents?.main || item.cxMainCode
    const bladeMain = bladeCode?.includes('.') ? parts.bladeMainCX[bladeCode.split('.')[1]] || null : parts.bladeMainCX[cxMainFromItem] || null
    const ratchet = ratchetCode ? parts.ratchet[ratchetCode] || { code: ratchetCode, names: { eng: ratchetCode, chi: ratchetCode } } : null
    const bit = bitCode ? parts.bit[bitCode] || { code: bitCode, names: { eng: bitCode, chi: bitCode } } : null
    const cxPrimary = asArray(item.cxDisplayComponents)
      .map((comp) => comp?.image)
      .find(Boolean)
    const cxDisplayComponents = asArray(item.cxDisplayComponents).map((comp) => ({
      ...comp,
      tier: resolvePartTier('blade', comp.code),
    }))

    const profile = profileFromParts({ blade, bladeMain, ratchet, bit, productType: item.productType })
    const names = createBuildName(blade, ratchet, bit)

    return {
      source: item.code,
      blade,
      bladeMain,
      ratchet,
      bit,
      profile,
      ...names,
      hasOverride: Object.keys(override).length > 0,
      images: {
        primary: blade ? cxPrimary || item.images?.bladeMain || item.images?.blade || blade.image || null : null,
        blade: blade ? cxPrimary || item.images?.blade || blade.image || null : null,
        ratchet: ratchet ? item.images?.ratchet || ratchet.image || null : null,
        bit: bit ? item.images?.bit || bit.image || null : null,
      },
      cxDisplayComponents,
      partTiers: {
        blade: resolvePartTier('blade', bladeCode),
        ratchet: resolvePartTier('ratchet', ratchetCode),
        bit: resolvePartTier('bit', bitCode),
      },
      isCx: Boolean(item.isCx),
      isCxExpansion: Boolean(item.isCxExpansion),
    }
  }

  const buildRecommendations = (style) => {
    const ownedBuilds = state.ownedItems.map(makeBuildFromCatalogItem)

    const bladeMap = new Map()
    const ratchetMap = new Map()
    const bitMap = new Map()

    ownedBuilds.forEach((b) => {
      if (b.blade?.code) bladeMap.set(b.blade.code, b.blade)
      if (b.ratchet?.code) ratchetMap.set(b.ratchet.code, b.ratchet)
      if (b.bit?.code) bitMap.set(b.bit.code, b.bit)
    })

    const blades = [...bladeMap.values()]
    const ratchets = [...ratchetMap.values()]
    const bits = [...bitMap.values()]

    const combos = []
    const maxCombos = 500

    for (let i = 0; i < blades.length; i += 1) {
      for (let j = 0; j < ratchets.length; j += 1) {
        for (let k = 0; k < bits.length; k += 1) {
          const blade = blades[i]
          const ratchet = ratchets[j]
          const bit = bits[k]
          const profile = profileFromParts({ blade, ratchet, bit, productType: 'St' })
          const { formalName, formalAlias } = createBuildName(blade, ratchet, bit)
          const score = scoreForStyle(profile, style)

          combos.push({
            blade,
            ratchet,
            bit,
            profile,
            formalName,
            formalAlias,
            score,
            images: {
              primary: blade.image || null,
              blade: blade.image || null,
              ratchet: ratchet.image || null,
              bit: bit.image || null,
            },
          })
          if (combos.length >= maxCombos) break
        }
        if (combos.length >= maxCombos) break
      }
      if (combos.length >= maxCombos) break
    }

    return combos.sort((a, b) => b.score - a.score).slice(0, 8)
  }

  const render = () => {
    const summary = lineSummary()
    const style = state.settings.preferredStyle || 'balanced'
    const recommendations = buildRecommendations(style)
    const ownedBuilds = state.ownedItems.map(makeBuildFromCatalogItem)

    const partPool = {
      blade: new Map(),
      ratchet: new Map(),
      bit: new Map(),
    }
    const partLookup = {
      blade: new Map(),
      ratchet: new Map(),
      bit: new Map(),
    }

    ownedBuilds.forEach((b) => {
      if (b.blade?.code) {
        partPool.blade.set(b.blade.code, b.blade)
        partLookup.blade.set(normalized(b.blade.code), b.blade)
      }
      if (b.ratchet?.code) {
        partPool.ratchet.set(b.ratchet.code, b.ratchet)
        partLookup.ratchet.set(normalized(b.ratchet.code), b.ratchet)
      }
      if (b.bit?.code) {
        partPool.bit.set(b.bit.code, b.bit)
        partLookup.bit.set(normalized(b.bit.code), b.bit)
      }
    })

    const hasAnyParts = partPool.blade.size > 0 || partPool.ratchet.size > 0 || partPool.bit.size > 0

    const ownedBladeAlias = new Map()
    state.ownedItems.forEach((item, idx) => {
      const build = ownedBuilds[idx]
      if (!build?.blade?.code) return
      ;[item.code, item.displayCode, item.variantCode]
        .filter(Boolean)
        .forEach((alias) => ownedBladeAlias.set(normalized(alias), build.blade))
    })

    const resolveBladeInput = (input) => {
      const key = normalized(input)
      if (!key) return null
      return partLookup.blade.get(key) || ownedBladeAlias.get(key) || null
    }

    const customBuildResults = state.settings.customBuildSlots.map((slot, i) => {
      if (!hasAnyParts) {
        return { slot: i + 1, status: 'no-parts', message: '目前沒有零件' }
      }

      const bladeInput = String(slot.bladeCode || '').trim()
      const ratchetInput = String(slot.ratchetCode || '').trim()
      const bitInput = String(slot.bitCode || '').trim()

      if (!bladeInput && !ratchetInput && !bitInput) {
        return { slot: i + 1, status: 'empty', message: '尚未輸入型號' }
      }

      const blade = resolveBladeInput(bladeInput)
      const ratchet = partLookup.ratchet.get(normalized(ratchetInput)) || null
      const bit = partLookup.bit.get(normalized(bitInput)) || null

      const misses = []
      if (!blade) misses.push('Blade')
      if (!ratchet) misses.push('Ratchet')
      if (!bit) misses.push('Bit')

      if (misses.length) {
        return {
          slot: i + 1,
          status: 'missing',
          message: `目前沒有零件：${misses.join(' / ')}`,
        }
      }

      const profile = profileFromParts({ blade, ratchet, bit, productType: 'St' })
      const names = createBuildName(blade, ratchet, bit)
      return {
        slot: i + 1,
        status: 'ok',
        blade,
        ratchet,
        bit,
        profile,
        ...names,
        images: {
          primary: blade.image || null,
          blade: blade.image || null,
          ratchet: ratchet.image || null,
          bit: bit.image || null,
        },
      }
    })

    const tierEntries = asArray(tierData.entries)
    const communityBoards = asArray(communityData.boards)
    const tierByCode = tierData.tierMapByCode || {}
    const tierClassName = (tier) => (tier === 'T0' ? 'tier-t0' : tier === 'T1' ? 'tier-t1' : tier === 'T2' ? 'tier-t2' : 'tier-na')
    const resolveTier = (item) => {
      const cands = [item.displayCode, item.variantCode, item.code].map((x) => normalized(x || ''))
      for (const key of cands) {
        if (tierByCode[key]) return tierByCode[key]
      }
      return '未分級'
    }

    const tierQuery = String(state.tierQuery || '').trim().toLowerCase()
    const tierFilter = state.tierFilter || 'ALL'
    const tierCount = {
      T0: tierEntries.filter((x) => x.tier === 'T0').length,
      T1: tierEntries.filter((x) => x.tier === 'T1').length,
      T2: tierEntries.filter((x) => x.tier === 'T2').length,
    }
    const filteredTierEntries = tierEntries.filter((entry) => {
      if (tierFilter !== 'ALL' && entry.tier !== tierFilter) return false
      if (!tierQuery) return true
      const pool = [entry.tier, entry.code, entry.name, entry.raw]
        .filter(Boolean)
        .map((x) => String(x).toLowerCase())
      return pool.some((x) => x.includes(tierQuery))
    })

    app.innerHTML = `
      <main class="layout">
        <header class="hero">
          <p class="chip">Beyblade Battle Command</p>
          <h1>陀螺戰士戰術中樞</h1>
          <p class="subtitle">輸入代號或機體名，立刻展開部件解析、戰系統計、智能配裝與五維戰力圖。</p>
          <div class="meta">
            <span>資料鏈結：go-shoot 圖鑑核心庫</span>
            <span>Arc 主刃紀錄：${data.summary?.arMainTotal ?? 0} 筆</span>
          </div>
        </header>

        <section class="panel controls">
          <form id="add-form">
            <label for="bey-input">登入戰士機體庫</label>
            <div class="row">
              <input id="bey-input" type="text" placeholder="例如 UX01 或 魔導至尊" required />
              <button type="submit">加入出戰盤</button>
            </div>
          </form>
          <div class="row tools">
            <label>
              戰術模式
              <select id="style-select">
                <option value="balanced" ${style === 'balanced' ? 'selected' : ''}>平衡</option>
                <option value="attack" ${style === 'attack' ? 'selected' : ''}>攻擊</option>
                <option value="defense" ${style === 'defense' ? 'selected' : ''}>防禦</option>
                <option value="stamina" ${style === 'stamina' ? 'selected' : ''}>持久</option>
              </select>
            </label>
            <button id="export-btn" type="button">導出戰士設定</button>
            <label class="import">
              載入戰士設定
              <input id="import-input" type="file" accept="application/json" />
            </label>
            <button id="reset-btn" type="button" class="ghost">重置戰術資料</button>
          </div>
          ${
            state.unresolvedInputs.length
              ? `<p class="warn">無法鎖定以下機體：${state.unresolvedInputs.join('、')}</p>`
              : ''
          }
        </section>

        <section class="panel stats">
          <h2>戰線統計</h2>
          <div class="stats-grid">
            <article><h3>BX 系列</h3><p>${summary.BX}</p></article>
            <article><h3>UX 系列</h3><p>${summary.UX}</p></article>
            <article><h3>CX 系列</h3><p>${summary.CX}</p></article>
            <article><h3>機體總數</h3><p>${state.ownedItems.length}</p></article>
          </div>
        </section>

        <section class="panel">
          <h2>出戰機體清單</h2>
          <div class="card-grid">
            ${
              state.ownedItems.length
                ? state.ownedItems
                    .map((item, idx) => {
                      const build = makeBuildFromCatalogItem(item)
                      const tier = resolveTier(item)
                      return `
                        <article class="bey-card" style="--i:${idx};" data-code="${item.code}">
                          <div class="cover">
                            ${build.images.primary ? `<img src="${build.images.primary}" alt="${item.code}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg',textContent:'NO SIGNAL'}))" />` : '<span class="noimg">NO SIGNAL</span>'}
                            <span class="badge">${item.line}</span>
                          </div>
                          <div class="content">
                            <h3>${item.code}</h3>
                            <p class="formal">識別代號：${item.displayCode || item.code}</p>
                            <p class="formal">T度分級：<span class="tier-pill ${tierClassName(tier)}">${tier}</span></p>
                            <p class="alias">${build.formalAlias || '-'}</p>
                            <p class="formal">機體正式型號：${build.formalName || '-'}</p>
                            <div class="row quick-actions">
                              <button type="button" class="ghost" data-action="remove-bey" data-code="${item.code}">刪除整顆</button>
                              ${build.hasOverride ? `<button type="button" class="ghost" data-action="restore-bey" data-code="${item.code}">還原原始配置</button>` : ''}
                            </div>
                            <ul class="parts">
                              ${
                                build.isCx
                                  ? formatCxComponentRows(build.cxDisplayComponents)
                                  : formatPartRow('Blade', build.blade?.code || '-', build.images.blade, { canDelete: !!build.blade, code: item.code, part: 'blade' })
                              }
                              ${
                                build.isCx
                                  ? formatPartRow('Blade組合', build.blade?.code || '-', build.images.blade, { canDelete: !!build.blade, code: item.code, part: 'blade', tier: build.partTiers.blade })
                                  : ''
                              }
                              ${formatPartRow('Ratchet', build.ratchet?.code || '-', build.images.ratchet, { canDelete: !!build.ratchet, code: item.code, part: 'ratchet', tier: build.partTiers.ratchet })}
                              ${formatPartRow('Bit', build.bit?.code || '-', build.images.bit, { canDelete: !!build.bit, code: item.code, part: 'bit', tier: build.partTiers.bit })}
                            </ul>
                            <div class="radar-wrap">
                              <svg viewBox="0 0 100 100" aria-label="power radar">
                                <polygon points="50,6 92,36 76,86 24,86 8,36" class="grid" />
                                <polygon points="${radarPoints(build.profile)}" class="data" />
                              </svg>
                              <p>綜合戰力 ${Math.round(build.profile.strength)}</p>
                            </div>
                          </div>
                        </article>
                      `
                    })
                    .join('')
                : '<p class="empty">尚未登錄任何出戰機體。</p>'
            }
          </div>
        </section>

        <section class="panel">
          <h2>三機自組系統</h2>
          <form id="custom-build-form" class="custom-build-form">
            ${state.settings.customBuildSlots
              .map(
                (slot, idx) => `
                <div class="custom-row">
                  <h3>自組機體 ${idx + 1}</h3>
                  <input type="text" name="slot-${idx}-blade" value="${slot.bladeCode || ''}" placeholder="Blade 型號或機體型號，例如 Wz.Ar.R / UX01" />
                  <input type="text" name="slot-${idx}-ratchet" value="${slot.ratchetCode || ''}" placeholder="Ratchet 型號，例如 3-60" />
                  <input type="text" name="slot-${idx}-bit" value="${slot.bitCode || ''}" placeholder="Bit 型號，例如 LF" />
                </div>
              `,
              )
              .join('')}
            <div class="row">
              <button type="submit">建立三機配置</button>
            </div>
            ${!hasAnyParts ? '<p class="warn">目前沒有零件</p>' : ''}
          </form>

          <div class="card-grid">
            ${customBuildResults
              .map((result, idx) => {
                if (result.status !== 'ok') {
                  return `
                    <article class="bey-card assemble-error" style="--i:${idx};">
                      <div class="content">
                        <h3>自組機體 ${result.slot}</h3>
                        <p class="empty">${result.message}</p>
                      </div>
                    </article>
                  `
                }

                return `
                  <article class="bey-card" style="--i:${idx};">
                    <div class="cover">
                      ${result.images.primary ? `<img src="${result.images.primary}" alt="${result.formalName}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg',textContent:'NO SIGNAL'}))" />` : '<span class="noimg">NO SIGNAL</span>'}
                      <span class="badge rec">CUSTOM</span>
                    </div>
                    <div class="content">
                      <h3>${result.formalAlias}</h3>
                      <p class="formal">機體正式型號：${result.formalName}</p>
                      <ul class="parts">
                        ${formatPartRow('Blade', result.blade.code, result.images.blade, { tier: resolvePartTier('blade', result.blade.code) })}
                        ${formatPartRow('Ratchet', result.ratchet.code, result.images.ratchet, { tier: resolvePartTier('ratchet', result.ratchet.code) })}
                        ${formatPartRow('Bit', result.bit.code, result.images.bit, { tier: resolvePartTier('bit', result.bit.code) })}
                      </ul>
                      <div class="radar-wrap">
                        <svg viewBox="0 0 100 100" aria-label="power radar">
                          <polygon points="50,6 92,36 76,86 24,86 8,36" class="grid" />
                          <polygon points="${radarPoints(result.profile)}" class="data" />
                        </svg>
                        <p>綜合戰力 ${Math.round(result.profile.strength)}</p>
                      </div>
                    </div>
                  </article>
                `
              })
              .join('')}
          </div>
        </section>

        <section class="panel">
          <h2>T度對照表</h2>
          <div class="row tier-filters">
            <button type="button" class="tier-filter-btn ${tierFilter === 'ALL' ? 'active' : ''}" data-tier-filter="ALL">全部</button>
            <button type="button" class="tier-filter-btn ${tierFilter === 'T0' ? 'active' : ''}" data-tier-filter="T0">T0 (${tierCount.T0})</button>
            <button type="button" class="tier-filter-btn ${tierFilter === 'T1' ? 'active' : ''}" data-tier-filter="T1">T1 (${tierCount.T1})</button>
            <button type="button" class="tier-filter-btn ${tierFilter === 'T2' ? 'active' : ''}" data-tier-filter="T2">T2 (${tierCount.T2})</button>
          </div>
          <div class="row">
            <input id="tier-query" type="text" value="${state.tierQuery || ''}" placeholder="輸入代號或名稱查 T度，例如 UX-15、鳳凰" />
          </div>
          <p class="formal">資料來源：${tierData.source || 'https://forum.gamer.com.tw/C.php?bsn=2696&snA=1117'}</p>
          <div class="tier-table-wrap">
            <table class="tier-table">
              <thead>
                <tr>
                  <th>T度</th>
                  <th>代號</th>
                  <th>名稱</th>
                  <th>來源文字</th>
                </tr>
              </thead>
              <tbody>
                ${
                  filteredTierEntries.length
                    ? filteredTierEntries
                        .slice(0, 200)
                        .map(
                          (entry) => `
                      <tr>
                        <td><span class="tier-pill ${tierClassName(entry.tier)}">${entry.tier}</span></td>
                        <td>${entry.code || '-'}</td>
                        <td>${entry.name || '-'}</td>
                        <td>${entry.raw || '-'}</td>
                      </tr>
                    `,
                        )
                        .join('')
                    : '<tr><td colspan="4">查無對應 T度資料</td></tr>'
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <h2>社群梯度情報（圖片版）</h2>
          <p class="formal">來源：${communityData.sourceSummary || '使用者提供社群圖片'}</p>
          <div class="community-grid">
            ${
              communityBoards.length
                ? communityBoards
                    .map(
                      (board, idx) => `
                    <article class="community-card" style="--i:${idx};">
                      <h3>${board.title || '-'}</h3>
                      <p class="formal">資料來源：${board.source || '-'}</p>
                      ${asArray(board.tierScale).length ? `<div class="community-tier-row">${formatTierScale(board.tierScale)}</div>` : ''}
                      <div class="community-image-wrap">
                        ${
                          board.image
                            ? `<img src="${board.image}" alt="${board.title || 'community-image'}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'empty',textContent:'找不到圖片，請把檔案放到 public/community 並參考 README.txt 的檔名'}))" />`
                            : '<p class="empty">此項目目前沒有圖片路徑</p>'
                        }
                      </div>
                      <ul class="community-points">
                        ${asArray(board.highlights)
                          .map((point) => `<li>${point}</li>`)
                          .join('')}
                      </ul>
                    </article>
                  `,
                    )
                    .join('')
                : '<p class="empty">目前沒有社群梯度資料</p>'
            }
          </div>
        </section>

        <section class="panel">
          <h2>智能配裝推薦</h2>
          <div class="card-grid recommend">
            ${
              recommendations.length
                ? recommendations
                    .map(
                      (rec, idx) => `
                    <article class="bey-card" style="--i:${idx};">
                      <div class="cover">
                        ${rec.images.primary ? `<img src="${rec.images.primary}" alt="${rec.formalName}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg',textContent:'NO SIGNAL'}))" />` : '<span class="noimg">NO SIGNAL</span>'}
                        <span class="badge rec">SYNC</span>
                      </div>
                      <div class="content">
                        <h3>${rec.formalAlias}</h3>
                        <p class="formal">機體正式型號：${rec.formalName}</p>
                        <ul class="parts">
                          ${formatPartRow('Blade', rec.blade.code, rec.images.blade, { tier: resolvePartTier('blade', rec.blade.code) })}
                          ${formatPartRow('Ratchet', rec.ratchet.code, rec.images.ratchet, { tier: resolvePartTier('ratchet', rec.ratchet.code) })}
                          ${formatPartRow('Bit', rec.bit.code, rec.images.bit, { tier: resolvePartTier('bit', rec.bit.code) })}
                        </ul>
                        <div class="radar-wrap">
                          <svg viewBox="0 0 100 100" aria-label="power radar">
                            <polygon points="50,6 92,36 76,86 24,86 8,36" class="grid" />
                            <polygon points="${radarPoints(rec.profile)}" class="data" />
                          </svg>
                          <p>綜合戰力 ${Math.round(rec.profile.strength)} / 配裝評分 ${Math.round(rec.score)}</p>
                        </div>
                      </div>
                    </article>
                  `,
                    )
                    .join('')
                : '<p class="empty">至少登錄一顆機體後，才可啟動智能配裝。</p>'
            }
          </div>
        </section>
      </main>
    `

    document.querySelector('#add-form').onsubmit = (ev) => {
      ev.preventDefault()
      const input = document.querySelector('#bey-input')
      const value = input.value.trim()
      if (!value) return
      state.settings.ownedInputs = [...asArray(state.settings.ownedInputs), value]
      input.value = ''
      persist()
      rebuildOwned()
      render()
    }

    document.querySelector('#style-select').onchange = (ev) => {
      state.settings.preferredStyle = ev.target.value
      persist()
      app.classList.add('hud-transition')
      setTimeout(() => {
        render()
        setTimeout(() => app.classList.remove('hud-transition'), 460)
      }, 160)
    }

    document.querySelector('#tier-query').oninput = (ev) => {
      state.tierQuery = ev.target.value
      rerenderPreserveView('#tier-query', ev.target.selectionStart, ev.target.selectionEnd)
    }

    document.querySelectorAll('[data-tier-filter]').forEach((btn) => {
      btn.onclick = (ev) => {
        state.tierFilter = ev.currentTarget.dataset.tierFilter || 'ALL'
        render()
      }
    })

    document.querySelector('#export-btn').onclick = () => {
      const blob = new Blob([JSON.stringify(state.settings, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'settings.json'
      a.click()
      URL.revokeObjectURL(url)
    }

    document.querySelector('#import-input').onchange = async (ev) => {
      const file = ev.target.files?.[0]
      if (!file) return
      try {
        const imported = JSON.parse(await file.text())
        if (!Array.isArray(imported.ownedInputs)) throw new Error('Invalid settings format')
        state.settings = normalizeSettings({ ...state.settings, ...imported })
        persist()
        rebuildOwned()
        render()
      }
      catch {
        alert('戰士設定檔格式不正確')
      }
    }

    document.querySelectorAll('[data-action="remove-bey"]').forEach((btn) => {
      btn.onclick = (ev) => {
        const code = ev.currentTarget.dataset.code
        state.settings.ownedInputs = asArray(state.settings.ownedInputs).filter((raw) => {
          const hit = resolveInput(raw)
          return hit?.code !== code
        })
        delete state.settings.partOverrides[code]
        persist()
        rebuildOwned()
        render()
      }
    })

    document.querySelectorAll('[data-action="remove-part"]').forEach((btn) => {
      btn.onclick = (ev) => {
        const { code, part } = ev.currentTarget.dataset
        const key = part === 'blade' ? 'bladeCode' : part === 'ratchet' ? 'ratchetCode' : 'bitCode'
        const current = { ...(state.settings.partOverrides[code] || {}) }
        current[key] = ''
        state.settings.partOverrides[code] = current
        persist()
        rebuildOwned()
        render()
      }
    })

    document.querySelectorAll('[data-action="restore-bey"]').forEach((btn) => {
      btn.onclick = (ev) => {
        const code = ev.currentTarget.dataset.code
        delete state.settings.partOverrides[code]
        persist()
        rebuildOwned()
        render()
      }
    })

    document.querySelector('#reset-btn').onclick = () => {
      state.settings.ownedInputs = []
      state.settings.savedBuilds = []
      state.settings.customBuildSlots = [
        { bladeCode: '', ratchetCode: '', bitCode: '' },
        { bladeCode: '', ratchetCode: '', bitCode: '' },
        { bladeCode: '', ratchetCode: '', bitCode: '' },
      ]
      persist()
      rebuildOwned()
      render()
    }

    document.querySelector('#custom-build-form').onsubmit = (ev) => {
      ev.preventDefault()
      const form = ev.currentTarget
      state.settings.customBuildSlots = [0, 1, 2].map((i) => ({
        bladeCode: String(form.elements[`slot-${i}-blade`]?.value || '').trim(),
        ratchetCode: String(form.elements[`slot-${i}-ratchet`]?.value || '').trim(),
        bitCode: String(form.elements[`slot-${i}-bit`]?.value || '').trim(),
      }))
      persist()
      render()
    }
  }

  rebuildOwned()
  render()
}

boot().catch((error) => {
  app.innerHTML = `<main class="layout"><section class="panel"><h1>載入失敗</h1><p>${error.message}</p></section></main>`
})
