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
  /**
   * Hexo 已构建好的正文 HTML（来自 public/ 下的产物）。
   * 它和读者在站点上看到的完全一致——表格、代码高亮、脚注都由 Hexo 的
   * 渲染器产出，比 CLI 里那个手写正则转换器保真得多（后者不支持表格）。
   * 只有找得到构建产物时才有值，找不到就沿用正则转换的结果。
   */
  renderedHtml?: string
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

  if (extension === '.md' || extension === '.markdown') {
    const parsed = parseMarkdown(content)
    // Hexo 源文件优先复用已构建的正文：站点上呈现什么，同步过去就是什么。
    const rendered = loadRenderedHtml(filePath, parsed.canonical)
    return rendered ? { ...parsed, renderedHtml: rendered } : parsed
  }
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

/** Hexo 主题渲染出的正文容器 id（Solitude 等主流主题一致沿用这个约定）。 */
const RENDERED_BODY_ANCHOR = /<article[^>]*id="article-container"[^>]*>/i

/**
 * 从 Hexo 构建产物中抽出正文块。
 * 用配对计数而不是找第一个 </article>，因为正文里可能嵌套 article 元素。
 * 返回 undefined 表示这份 HTML 不是预期结构，调用方应回退。
 */
export function extractRenderedBody(html: string): string | undefined {
  const start = html.match(RENDERED_BODY_ANCHOR)
  if (!start || start.index === undefined) return undefined

  let depth = 0
  let cursor = start.index
  const tagPattern = /<(\/?)article\b[^>]*>/gi
  tagPattern.lastIndex = start.index

  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(html)) !== null) {
    depth += match[1] ? -1 : 1
    if (depth === 0) {
      cursor = match.index + match[0].length
      break
    }
  }
  if (depth !== 0) return undefined

  let body = html.slice(start.index + start[0].length, cursor).replace(/<\/article>$/i, '')

  // 目录锚点在站外没有意义，去掉以免正文里散落空链接。
  body = body.replace(/<a[^>]*class="headerlink"[^>]*>\s*<\/a>/gi, '')
  // 构建产物里混入的脚本对目标平台无用，且多半会被过滤掉。
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '')

  return body.trim() || undefined
}

/**
 * 根据 canonical 定位 Hexo 构建产物并读取渲染后的正文。
 *
 * 用 canonical 而不是自己套 permalink 规则推导路径：permalink 可配置，
 * 而 canonical 已经是文章自己声明的最终 URL，两者不一致时应以后者为准。
 */
export function loadRenderedHtml(
  articlePath: string,
  canonical: string | undefined
): string | undefined {
  if (!canonical) return undefined

  const hexoRoot = findHexoRoot(articlePath)
  if (!hexoRoot) return undefined

  let pathname: string
  try {
    pathname = new URL(canonical).pathname
  } catch {
    return undefined
  }

  const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (segments.length === 0) return undefined

  const candidates = [
    path.join(hexoRoot, 'public', ...segments, 'index.html'),
    path.join(hexoRoot, 'public', ...segments) + '.html',
  ]

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    try {
      return extractRenderedBody(fs.readFileSync(candidate, 'utf-8'))
    } catch {
      return undefined
    }
  }
  return undefined
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
