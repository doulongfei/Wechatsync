import { describe, expect, it } from 'vitest'
import { selectArticleCover } from '../src/content/cover-selector'

interface FakeElement {
  content?: string
  src?: string
}

function fakeDocument(
  elements: Record<string, FakeElement>,
  baseURI = 'https://blog.example.com/posts/article/'
) {
  return {
    baseURI,
    querySelector(selector: string) {
      const value = elements[selector]
      if (!value) return null
      return {
        getAttribute(name: string) {
          return name === 'content' ? value.content ?? null : value.src ?? null
        },
      }
    },
  }
}

describe('selectArticleCover', () => {
  it('prefers OpenGraph over a Reader favicon candidate', () => {
    const cover = selectArticleCover(
      fakeDocument({
        'meta[property="og:image"]': { content: '/images/window.jpg' },
      }),
      {
        leadingImage: 'https://blog.example.com/img/pwa/favicon.png',
        mainImage: 'https://blog.example.com/avatar.jpg',
      }
    )

    expect(cover).toBe('https://blog.example.com/images/window.jpg')
  })

  it('falls back from an icon-like OpenGraph value to Twitter metadata', () => {
    const cover = selectArticleCover(
      fakeDocument({
        'meta[property="og:image"]': { content: '/favicon.ico' },
        'meta[name="twitter:image"]': { content: 'https://cdn.example.com/twitter.jpg' },
      }),
      {}
    )

    expect(cover).toBe('https://cdn.example.com/twitter.jpg')
  })

  it('uses an itemprop image src after social metadata', () => {
    const cover = selectArticleCover(
      fakeDocument({
        '[itemprop="image"]': { src: '../covers/itemprop.png' },
      }),
      {}
    )

    expect(cover).toBe('https://blog.example.com/posts/covers/itemprop.png')
  })

  it('falls back to Reader leading and main images in that order', () => {
    expect(
      selectArticleCover(fakeDocument({}), {
        leadingImage: 'https://cdn.example.com/leading.jpg',
        mainImage: 'https://cdn.example.com/main.jpg',
      })
    ).toBe('https://cdn.example.com/leading.jpg')

    expect(
      selectArticleCover(fakeDocument({}), {
        leadingImage: 'https://cdn.example.com/apple-touch-icon.png',
        mainImage: 'https://cdn.example.com/main.jpg',
      })
    ).toBe('https://cdn.example.com/main.jpg')
  })

  it('returns undefined when every candidate is empty or icon-like', () => {
    expect(
      selectArticleCover(
        fakeDocument({
          'meta[property="og:image"]': { content: ' ' },
        }),
        { mainImage: '/assets/icon-128.png' }
      )
    ).toBeUndefined()
  })
})
