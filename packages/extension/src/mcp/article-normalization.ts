import type { Article } from '@wechatsync/core'

export interface BridgeArticleInput {
  title: string
  content?: string
  markdown?: string
  cover?: string
  summary?: string
  tags?: string[]
  category?: string
  canonical?: string
}

export type NormalizedBridgeArticle = Article & { content: string }

export function normalizeBridgeArticle(
  input: BridgeArticleInput,
  htmlContent: string
): NormalizedBridgeArticle {
  const canonical = input.canonical?.trim()

  return {
    title: input.title,
    content: htmlContent,
    html: htmlContent,
    markdown: input.markdown || '',
    cover: input.cover,
    summary: input.summary,
    tags: input.tags,
    category: input.category,
    source: canonical
      ? {
          url: canonical,
          platform: 'hexo',
        }
      : undefined,
  }
}
