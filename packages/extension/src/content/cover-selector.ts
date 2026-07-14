export interface CoverElementLike {
  getAttribute(name: string): string | null
}

export interface CoverDocumentLike {
  readonly baseURI: string
  querySelector(selector: string): CoverElementLike | null
}

export interface ReaderCoverCandidates {
  leadingImage?: string
  mainImage?: string
}

const META_SELECTORS = [
  'meta[property="og:image"]',
  'meta[name="twitter:image"]',
  'meta[property="twitter:image"]',
] as const

function isIconCandidate(url: URL): boolean {
  if (url.protocol === 'data:') return false

  const pathname = url.pathname.toLowerCase()
  const filename = pathname.split('/').pop() || ''
  return (
    filename.endsWith('.ico') ||
    filename.includes('favicon') ||
    filename.includes('apple-touch-icon') ||
    /^icon(?:[-_.]|\d)/.test(filename) ||
    /\/(?:icons?|favicons?)\//.test(pathname)
  )
}

function normalizeCandidate(candidate: string | null | undefined, baseURI: string): string | undefined {
  const value = candidate?.trim()
  if (!value) return undefined

  try {
    const url = new URL(value, baseURI)
    return isIconCandidate(url) ? undefined : url.href
  } catch {
    return undefined
  }
}

export function selectArticleCover(
  doc: CoverDocumentLike,
  reader: ReaderCoverCandidates
): string | undefined {
  for (const selector of META_SELECTORS) {
    const candidate = normalizeCandidate(
      doc.querySelector(selector)?.getAttribute('content'),
      doc.baseURI
    )
    if (candidate) return candidate
  }

  const itempropImage = doc.querySelector('[itemprop="image"]')
  const itempropCandidate = normalizeCandidate(
    itempropImage?.getAttribute('content') || itempropImage?.getAttribute('src'),
    doc.baseURI
  )
  if (itempropCandidate) return itempropCandidate

  return (
    normalizeCandidate(reader.leadingImage, doc.baseURI) ||
    normalizeCandidate(reader.mainImage, doc.baseURI)
  )
}
