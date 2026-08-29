import { describe, expect, it } from 'vitest'
import { normalizeCsdnTags } from '../csdn'
import { normalizeJuejinBrief } from '../juejin'

describe('normalizeCsdnTags', () => {
  it('joins tags with commas as CSDN expects', () => {
    expect(normalizeCsdnTags(['AI', '软件设计'])).toBe('AI,软件设计')
  })

  it('returns an empty string when there are no tags', () => {
    expect(normalizeCsdnTags(undefined)).toBe('')
    expect(normalizeCsdnTags([])).toBe('')
  })

  it('caps the list at the five tags CSDN keeps', () => {
    const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(normalizeCsdnTags(tags)).toBe('a,b,c,d,e')
  })

  it('drops duplicates and blank entries, preserving order', () => {
    expect(normalizeCsdnTags(['AI', '  ', 'AI', 'Go', ''])).toBe('AI,Go')
  })

  it('trims surrounding whitespace before comparing', () => {
    expect(normalizeCsdnTags([' AI ', 'AI'])).toBe('AI')
  })

  it('skips tags longer than the platform limit instead of truncating them', () => {
    const tooLong = 'x'.repeat(21)
    expect(normalizeCsdnTags([tooLong, 'AI'])).toBe('AI')
  })
})

describe('normalizeJuejinBrief', () => {
  it('passes a short summary through unchanged', () => {
    expect(normalizeJuejinBrief('一句简短的摘要')).toBe('一句简短的摘要')
  })

  it('returns an empty string when there is no summary', () => {
    expect(normalizeJuejinBrief(undefined)).toBe('')
    expect(normalizeJuejinBrief('   ')).toBe('')
  })

  it('flattens newlines and collapses runs of whitespace', () => {
    expect(normalizeJuejinBrief('第一行\n\n第二行\t 第三行')).toBe('第一行 第二行 第三行')
  })

  it('truncates to the 100-character limit with an ellipsis', () => {
    const long = '字'.repeat(150)
    const result = normalizeJuejinBrief(long)
    expect(result).toHaveLength(100)
    expect(result.endsWith('…')).toBe(true)
  })

  it('keeps a summary that is exactly at the limit intact', () => {
    const exact = '字'.repeat(100)
    expect(normalizeJuejinBrief(exact)).toBe(exact)
  })
})
