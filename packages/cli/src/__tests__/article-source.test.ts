import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  materializeCover,
  parseFileContent,
  selectPlatforms,
} from '../article-source'

const tempDirectories: string[] = []

function createTempDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wechatsync-hexo-'))
  tempDirectories.push(directory)
  return directory
}

function writeFile(filePath: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function findBlogFixture(): string | undefined {
  let current = process.cwd()
  while (true) {
    const candidate = path.join(
      current,
      'blog/source/_posts/linux/Linux命令行table格式的输出转json通用函数.md'
    )
    if (fs.existsSync(candidate)) return candidate

    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('parseFileContent', () => {
  it('parses Hexo front matter and removes a duplicate leading H1', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'article.md')
    writeFile(
      articlePath,
      `---
title: "Hexo 标题"
tags:
  - linux
  - shell
categories: 技术
cover: ./cover.png
summary: >-
  第一行摘要，
  第二行继续。
canonical: https://example.com/posts/hexo/
sync:
  enabled: true
  targets: [weixin, zhihu]
---

# Hexo 标题

正文内容
`
    )

    const parsed = parseFileContent(articlePath)

    expect(parsed).toMatchObject({
      title: 'Hexo 标题',
      content: '正文内容',
      format: 'markdown',
      cover: './cover.png',
      summary: '第一行摘要， 第二行继续。',
      tags: ['linux', 'shell'],
      category: '技术',
      canonical: 'https://example.com/posts/hexo/',
      sync: { enabled: true, targets: ['weixin', 'zhihu'] },
    })
  })

  it('normalizes scalar tags and category arrays', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'article.md')
    writeFile(
      articlePath,
      `---
title: Scalar metadata
tags: hexo
categories: [技术, 工具]
description: Description fallback
---
Body
`
    )

    expect(parseFileContent(articlePath)).toMatchObject({
      tags: ['hexo'],
      category: '技术',
      summary: 'Description fallback',
    })
  })

  it('keeps a leading H1 when it differs from the front matter title', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'article.md')
    writeFile(articlePath, '---\ntitle: Page title\n---\n\n# Section title\n\nBody')

    expect(parseFileContent(articlePath).content).toBe('# Section title\n\nBody')
  })

  it('uses and removes the leading H1 when front matter has no title', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'article.md')
    writeFile(articlePath, '# Markdown title\n\nBody')

    expect(parseFileContent(articlePath)).toMatchObject({
      title: 'Markdown title',
      content: 'Body',
    })
  })

  it('rejects non-scalar tag metadata', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'article.md')
    writeFile(articlePath, '---\ntitle: Invalid\ntags:\n  nested: value\n---\nBody')

    expect(() => parseFileContent(articlePath)).toThrow(
      'Front matter "tags" must be a string or an array of strings'
    )
  })

  it('rejects invalid sync targets', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'article.md')
    writeFile(
      articlePath,
      '---\ntitle: Invalid\nsync:\n  targets:\n    nested: value\n---\nBody'
    )

    expect(() => parseFileContent(articlePath)).toThrow(
      'Front matter "sync.targets" must be an array of strings'
    )
  })

  it('preserves HTML title, OpenGraph cover, and description extraction', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'article.html')
    writeFile(
      articlePath,
      '<html><head><title>HTML title</title>' +
        '<meta property="og:image" content="https://example.com/cover.jpg">' +
        '<meta name="description" content="HTML summary"></head>' +
        '<body><style>p { color: red; }</style><p>Body</p></body></html>'
    )

    expect(parseFileContent(articlePath)).toMatchObject({
      title: 'HTML title',
      cover: 'https://example.com/cover.jpg',
      summary: 'HTML summary',
      format: 'html',
    })
  })

  it('parses the real Blog article when the mounted fixture is available', () => {
    const fixture = findBlogFixture()
    if (!fixture) return

    const parsed = parseFileContent(fixture)

    expect(parsed.title).toBe('Linux命令行table格式的输出转json通用函数')
    expect(parsed.cover).toBe(
      'https://cdn.pixabay.com/photo/2022/10/24/07/11/window-7542846_640.jpg'
    )
    expect(parsed.tags).toEqual(['linux', 'shell'])
    expect(parsed.category).toBe('技术')
    expect(parsed.content.startsWith('# Linux命令行')).toBe(false)
  })
})

describe('selectPlatforms', () => {
  const source = {
    title: 'Title',
    content: 'Body',
    format: 'markdown' as const,
    sync: { enabled: true, targets: ['weixin', 'zhihu'] },
  }

  it('prefers explicit platforms even when automatic sync is disabled', () => {
    expect(
      selectPlatforms('weixin, csdn', {
        ...source,
        sync: { enabled: false, targets: [] },
      })
    ).toEqual(['weixin', 'csdn'])
  })

  it('uses enabled Hexo sync targets when no platforms are explicit', () => {
    expect(selectPlatforms(undefined, source)).toEqual(['weixin', 'zhihu'])
  })

  it('keeps the existing defaults when Hexo targets are disabled', () => {
    expect(
      selectPlatforms(undefined, {
        ...source,
        sync: { enabled: false, targets: ['weixin'] },
      })
    ).toEqual(['zhihu', 'juejin'])
  })

  it('rejects an explicitly empty platform list', () => {
    expect(() => selectPlatforms(' , ', source)).toThrow(
      'At least one platform must be specified'
    )
  })
})

describe('materializeCover', () => {
  it('keeps HTTP URLs and data URIs unchanged', () => {
    expect(materializeCover('https://example.com/cover.jpg', '/tmp/article.md')).toBe(
      'https://example.com/cover.jpg'
    )
    expect(materializeCover('data:image/png;base64,AAAA', '/tmp/article.md')).toBe(
      'data:image/png;base64,AAAA'
    )
  })

  it('resolves a relative cover from the article directory', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'posts/article.md')
    writeFile(articlePath, 'Body')
    writeFile(path.join(directory, 'posts/cover.png'), Buffer.from('png-data'))

    expect(materializeCover('./cover.png', articlePath)).toBe(
      `data:image/png;base64,${Buffer.from('png-data').toString('base64')}`
    )
  })

  it('resolves a root-relative cover from the nearest Hexo source directory', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'source/_posts/article.md')
    writeFile(path.join(directory, '_config.yml'), 'title: test')
    writeFile(articlePath, 'Body')
    writeFile(path.join(directory, 'source/img/cover.jpg'), Buffer.from('jpg-data'))

    expect(materializeCover('/img/cover.jpg', articlePath)).toBe(
      `data:image/jpeg;base64,${Buffer.from('jpg-data').toString('base64')}`
    )
  })

  it('rejects a root-relative path when no Hexo root can be found', () => {
    const directory = createTempDirectory()
    const articlePath = path.join(directory, 'article.md')
    writeFile(articlePath, 'Body')

    expect(() => materializeCover('/img/cover.jpg', articlePath)).toThrow(
      'Cannot resolve Hexo root-relative cover'
    )
  })
})
