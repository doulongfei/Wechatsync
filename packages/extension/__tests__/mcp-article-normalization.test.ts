import { describe, expect, it } from 'vitest'
import { normalizeBridgeArticle } from '../src/mcp/article-normalization'

describe('normalizeBridgeArticle', () => {
  it('preserves normalized Hexo metadata for platform adapters', () => {
    const article = normalizeBridgeArticle(
      {
        title: 'Hexo article',
        markdown: 'Markdown body',
        content: '<p>Original HTML</p>',
        cover: 'https://example.com/cover.jpg',
        summary: 'Article summary',
        tags: ['hexo', 'wechat'],
        category: '技术',
        canonical: 'https://example.com/posts/hexo/',
      },
      '<p>Rendered Markdown</p>'
    )

    expect(article).toEqual({
      title: 'Hexo article',
      markdown: 'Markdown body',
      content: '<p>Rendered Markdown</p>',
      html: '<p>Rendered Markdown</p>',
      cover: 'https://example.com/cover.jpg',
      summary: 'Article summary',
      tags: ['hexo', 'wechat'],
      category: '技术',
      source: {
        url: 'https://example.com/posts/hexo/',
        platform: 'hexo',
      },
    })
  })

  it('omits source metadata when canonical is blank', () => {
    const article = normalizeBridgeArticle(
      {
        title: 'Plain Markdown',
        markdown: 'Body',
        canonical: '   ',
      },
      '<p>Body</p>'
    )

    expect(article.source).toBeUndefined()
  })
})
