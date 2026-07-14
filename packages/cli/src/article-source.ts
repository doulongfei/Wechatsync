import fs from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import juice from 'juice'

export interface ParsedArticleSource {
  title: string | null
  content: string
  format: 'markdown' | 'html'
  cover?: string
  summary?: string
  tags?: string[]
  category?: string
  canonical?: string
  sync?: {
    enabled?: boolean
    targets?: string[]
  }
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') {
    throw new Error(`Front matter "${field}" must be a string`)
  }
  return value.trim() || undefined
}

function stringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined

  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized ? [normalized] : undefined
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Front matter "${field}" must be a string or an array of strings`)
  }

  const normalized = value.map((entry) => entry.trim()).filter(Boolean)
  return normalized.length > 0 ? normalized : []
}

function parseSync(value: unknown): ParsedArticleSource['sync'] {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Front matter "sync" must be an object')
  }

  const sync = value as Record<string, unknown>
  if (sync.enabled !== undefined && typeof sync.enabled !== 'boolean') {
    throw new Error('Front matter "sync.enabled" must be a boolean')
  }
  if (
    sync.targets !== undefined &&
    (!Array.isArray(sync.targets) || sync.targets.some((entry) => typeof entry !== 'string'))
  ) {
    throw new Error('Front matter "sync.targets" must be an array of strings')
  }

  return {
    enabled: sync.enabled as boolean | undefined,
    targets: Array.isArray(sync.targets)
      ? sync.targets.map((entry) => (entry as string).trim().toLowerCase()).filter(Boolean)
      : undefined,
  }
}

function normalizeHeading(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function removeDuplicateLeadingH1(body: string, title: string): string {
  const trimmed = body.trimStart()
  const match = trimmed.match(/^#\s+(.+?)\s*(?:\r?\n|$)/)
  if (!match || normalizeHeading(match[1]) !== normalizeHeading(title)) return body

  return trimmed.slice(match[0].length).replace(/^\r?\n/, '')
}

function parseMarkdown(content: string): ParsedArticleSource {
  const parsed = matter(content)
  const data = parsed.data as Record<string, unknown>
  const title = optionalString(data.title, 'title') ?? null
  const tags = stringList(data.tags, 'tags')
  const categories = stringList(data.categories ?? data.category, 'categories')
  const summary =
    optionalString(data.summary, 'summary') ??
    optionalString(data.description, 'description') ??
    optionalString(data.excerpt, 'excerpt')
  const cover = optionalString(data.cover, 'cover')
  const canonical = optionalString(data.canonical, 'canonical')
  const sync = parseSync(data.sync)

  let resolvedTitle = title
  let body = parsed.content
  if (resolvedTitle) {
    body = removeDuplicateLeadingH1(body, resolvedTitle)
  } else {
    const trimmed = body.trimStart()
    const h1 = trimmed.match(/^#\s+(.+?)\s*(?:\r?\n|$)/)
    if (h1) {
      resolvedTitle = normalizeHeading(h1[1])
      body = trimmed.slice(h1[0].length).replace(/^\r?\n/, '')
    }
  }

  return {
    title: resolvedTitle,
    content: body.trim(),
    format: 'markdown',
    cover,
    summary,
    tags,
    category: categories?.[0],
    canonical,
    sync,
  }
}

function parseHtml(content: string, filePath: string): ParsedArticleSource {
  const title =
    content.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ??
    content.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() ??
    null
  const cover =
    content.match(/<meta\s[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] ??
    content.match(/<meta\s[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i)?.[1]
  const summary =
    content.match(/<meta\s[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] ??
    content.match(/<meta\s[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i)?.[1] ??
    content.match(/<meta\s[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1]

  const fileDirectory = path.dirname(filePath)
  content = content.replace(
    /<link\s[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    (original, href: string) => {
      if (/^https?:\/\//i.test(href)) return original
      const cssPath = path.resolve(fileDirectory, href)
      return fs.existsSync(cssPath) ? `<style>${fs.readFileSync(cssPath, 'utf-8')}</style>` : original
    }
  )

  const styles = Array.from(content.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi), (match) => match[0])
  let body = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]?.trim() ?? content
  const bodyStyles = new Set(
    Array.from(body.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi), (match) => match[0])
  )
  const extraStyles = styles.filter((style) => !bodyStyles.has(style))
  if (extraStyles.length > 0) body = `${extraStyles.join('\n')}\n${body}`

  try {
    body = juice(body, {
      removeStyleTags: true,
      preserveImportant: true,
      preserveMediaQueries: false,
      preserveFontFaces: false,
    })
  } catch {
    // Preserve the original HTML when optional style inlining fails.
  }

  return {
    title,
    content: body,
    format: 'html',
    cover: cover?.trim() || undefined,
    summary: summary?.trim() || undefined,
  }
}

export function parseFileContent(filePath: string): ParsedArticleSource {
  const content = fs.readFileSync(filePath, 'utf-8')
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.md' || extension === '.markdown') return parseMarkdown(content)
  if (extension === '.html' || extension === '.htm') return parseHtml(content, filePath)

  return {
    title: path.basename(filePath, extension),
    content,
    format: 'markdown',
  }
}

export function selectPlatforms(
  explicit: string | undefined,
  source: ParsedArticleSource
): string[] {
  if (explicit !== undefined) {
    const platforms = Array.from(
      new Set(explicit.split(',').map((platform) => platform.trim().toLowerCase()).filter(Boolean))
    )
    if (platforms.length === 0) throw new Error('At least one platform must be specified')
    return platforms
  }

  if (source.sync?.enabled !== false && source.sync?.targets?.length) {
    return Array.from(new Set(source.sync.targets))
  }

  return ['zhihu', 'juejin']
}

function findHexoRoot(articlePath: string): string | undefined {
  let current = path.dirname(articlePath)
  while (true) {
    if (
      fs.existsSync(path.join(current, '_config.yml')) &&
      fs.statSync(path.join(current, 'source'), { throwIfNoEntry: false })?.isDirectory()
    ) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function materializeCover(
  cover: string | undefined,
  articlePath: string
): string | undefined {
  if (!cover || /^https?:\/\//i.test(cover) || cover.startsWith('data:')) return cover

  let coverPath: string
  if (path.isAbsolute(cover)) {
    const hexoRoot = findHexoRoot(articlePath)
    if (!hexoRoot) {
      throw new Error(`Cannot resolve Hexo root-relative cover "${cover}" from ${articlePath}`)
    }
    coverPath = path.join(hexoRoot, 'source', cover.replace(/^[/\\]+/, ''))
  } else {
    coverPath = path.resolve(path.dirname(articlePath), cover)
  }

  if (!fs.existsSync(coverPath)) throw new Error(`Cover image does not exist: ${coverPath}`)

  const extension = path.extname(coverPath).toLowerCase()
  const mimeType = MIME_TYPES[extension]
  if (!mimeType) throw new Error(`Unsupported cover image format: ${extension || '(none)'}`)

  return `data:${mimeType};base64,${fs.readFileSync(coverPath).toString('base64')}`
}
