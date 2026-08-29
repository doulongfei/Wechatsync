import { describe, expect, it } from 'vitest'
import { isFootnotableHref } from '../src/lib/content-processor'

// 公众号禁止正文外链跳转，链接会被降级成纯文本。只有真正能打开的绝对地址
// 才值得进文末脚注——页内锚点和 mailto 列出来对读者没有意义。
describe('isFootnotableHref', () => {
  it('accepts absolute http(s) urls', () => {
    expect(isFootnotableHref('https://github.com/chenhg5/cc-connect')).toBe(true)
    expect(isFootnotableHref('http://example.com/a')).toBe(true)
  })

  it('rejects in-page anchors', () => {
    expect(isFootnotableHref('#section')).toBe(false)
  })

  it('rejects non-navigable schemes', () => {
    expect(isFootnotableHref('mailto:a@b.com')).toBe(false)
    expect(isFootnotableHref('javascript:void(0)')).toBe(false)
    expect(isFootnotableHref('tel:10086')).toBe(false)
  })

  it('rejects relative paths, which mean nothing off-site', () => {
    expect(isFootnotableHref('/about')).toBe(false)
    expect(isFootnotableHref('../post.html')).toBe(false)
  })

  it('rejects empty and missing values', () => {
    expect(isFootnotableHref(null)).toBe(false)
    expect(isFootnotableHref('')).toBe(false)
    expect(isFootnotableHref('   ')).toBe(false)
  })

  it('tolerates surrounding whitespace', () => {
    expect(isFootnotableHref('  https://example.com  ')).toBe(true)
  })
})
