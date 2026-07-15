import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeInterface } from '../../../runtime/interface'
import { WeiboAdapter } from '../weibo'

function createRuntime(html: string): RuntimeInterface {
  return {
    type: 'extension',
    fetch: vi.fn(async () => new Response(html, { status: 200 })),
    cookies: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    storage: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    session: {
      get: vi.fn(),
      set: vi.fn(),
    },
    dom: {},
  } as unknown as RuntimeInterface
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WeiboAdapter authentication', () => {
  it('treats a page without user config as logged out without reporting an extension error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const adapter = new WeiboAdapter()
    await adapter.init(createRuntime('<html><body>Login to Weibo</body></html>'))

    const result = await adapter.checkAuth()

    expect(result).toEqual({ isAuthenticated: false })
    expect(errorSpy).not.toHaveBeenCalled()
  })
})
