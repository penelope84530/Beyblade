import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE_URL = 'https://forum.gamer.com.tw/B.php?bsn=2696'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'public', 'data')
const outFile = path.join(outDir, 'forum-board-2696.json')

const decodeHtml = (text = '') =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')

const cleanText = (html = '') =>
  decodeHtml(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const parsePosts = (html = '') => {
  const regex = /<a[^>]+href="(?:\/)?C\.php\?bsn=2696(?:&amp;|&)snA=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  const posts = []
  const seen = new Set()

  let m
  while ((m = regex.exec(html)) !== null) {
    const snA = Number(m[1])
    const title = cleanText(m[2])
    if (!snA || !title || seen.has(snA)) continue
    seen.add(snA)
    posts.push({
      snA,
      title,
      url: `https://forum.gamer.com.tw/C.php?bsn=2696&snA=${snA}`,
    })
  }

  return posts
}

const KEYWORDS = ['心得', '入坑', '新手', '零件', '戰鬥陀螺', 'BX', 'UX', 'CX', '梯度', 'TIER']

const run = async () => {
  const resp = await fetch(SOURCE_URL)
  if (!resp.ok) throw new Error(`Failed to fetch ${SOURCE_URL}: ${resp.status}`)
  const html = await resp.text()

  const allPosts = parsePosts(html)
  const featured = allPosts.filter((post) => KEYWORDS.some((kw) => post.title.toUpperCase().includes(kw.toUpperCase())))

  const payload = {
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    title: cleanText(html.match(/<title>(.*?)<\/title>/i)?.[1] || ''),
    summary: {
      totalParsed: allPosts.length,
      featuredCount: featured.length,
    },
    latestPosts: allPosts.slice(0, 80),
    featuredPosts: featured.slice(0, 40),
  }

  await mkdir(outDir, { recursive: true })
  await writeFile(outFile, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`Wrote ${outFile} with ${payload.summary.totalParsed} posts.`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
