import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeInterface } from '../../../runtime/interface'
import { WeixinAdapter } from '../weixin'

interface RuntimeOptions {
  uploadError?: boolean
  cropError?: boolean
}

interface FakeRuntimeResult {
  runtime: RuntimeInterface
  fetchMock: ReturnType<typeof vi.fn>
  getDraftBody(): URLSearchParams | undefined
  getCropRequest(): RequestInit | undefined
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function createRuntime(options: RuntimeOptions = {}): FakeRuntimeResult {
  let draftBody: URLSearchParams | undefined
  let cropRequest: RequestInit | undefined
  const fetchMock = vi.fn(async (url: string, request?: RequestInit) => {
    if (url === 'https://mp.weixin.qq.com/') {
      return new Response(
        '<script>window.wx = { commonData: { data: { t: "TOKEN", ticket: "TICKET", ' +
          'user_name: "USER", nick_name: "Nick", time: "123" } } };</script>',
        { status: 200 }
      )
    }

    if (url.includes('/cgi-bin/filetransfer')) {
      return jsonResponse(
        options.uploadError
          ? { base_resp: { err_msg: 'upload failed', ret: 1 } }
          : {
              cdn_url: 'https://mmbiz.qpic.cn/original.jpg',
              content: '9001',
              base_resp: { err_msg: 'ok', ret: 0 },
            }
      )
    }

    if (url.includes('/cgi-bin/cropimage?action=crop_multi')) {
      cropRequest = request
      return jsonResponse(
        options.cropError
          ? { base_resp: { err_msg: 'crop failed', ret: 1 } }
          : {
              base_resp: { err_msg: 'ok', ret: 0 },
              result: [
                {
                  cdnurl: 'https://mmbiz.qpic.cn/235.jpg',
                  file_id: '23501',
                  width: 1200,
                  height: 511,
                },
                {
                  cdnurl: 'https://mmbiz.qpic.cn/square.jpg',
                  file_id: '10001',
                  width: 630,
                  height: 630,
                },
              ],
            }
      )
    }

    if (url.includes('/cgi-bin/operate_appmsg')) {
      draftBody = request?.body as URLSearchParams
      return jsonResponse({ appMsgId: 'DRAFT_ID', base_resp: { ret: 0, err_msg: 'ok' } })
    }

    throw new Error(`Unexpected URL: ${url}`)
  })

  const runtime = {
    type: 'extension',
    fetch: fetchMock,
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

  return {
    runtime,
    fetchMock,
    getDraftBody: () => draftBody,
    getCropRequest: () => cropRequest,
  }
}

function installImageMocks(): ReturnType<typeof vi.fn> {
  const imageFetch = vi.fn(async () =>
    new Response(new Blob(['jpeg-data'], { type: 'image/jpeg' }), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })
  )
  vi.stubGlobal('fetch', imageFetch)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 1200, height: 630, close: vi.fn() }))
  )
  return imageFetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WeixinAdapter cover publishing', () => {
  it('uses the current URL-encoded crop contract with normalized coordinates', async () => {
    installImageMocks()
    const fake = createRuntime()
    const adapter = new WeixinAdapter()
    await adapter.init(fake.runtime)

    const result = await adapter.publish({
      title: 'Crop contract',
      markdown: 'Body',
      html: '<p>Body</p>',
      cover: 'https://cdn.example.com/cover.jpg',
    })

    expect(result.success).toBe(true)
    const request = fake.getCropRequest()
    expect(request?.body).toBeInstanceOf(URLSearchParams)

    const body = request?.body as URLSearchParams
    expect(body.get('format0')).toBe('2.35_1')
    expect(body.get('format1')).toBe('1_1')
    expect(body.get('fingerprint')).toBe('TOKEN')
    expect(Number(body.get('size0_y1'))).toBeGreaterThan(0)
    expect(Number(body.get('size0_y2'))).toBeLessThanOrEqual(1)
    expect(Number(body.get('size1_x1'))).toBeGreaterThan(0)
    expect(Number(body.get('size1_x2'))).toBeLessThanOrEqual(1)

    const headers = new Headers(request?.headers)
    expect(headers.get('Content-Type')).toBe(
      'application/x-www-form-urlencoded; charset=UTF-8'
    )
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest')
  })

  it('uploads, crops, and writes an explicit cover into the draft form', async () => {
    const imageFetch = installImageMocks()
    const fake = createRuntime()
    const adapter = new WeixinAdapter()
    await adapter.init(fake.runtime)

    const result = await adapter.publish({
      title: 'Hexo article',
      markdown: 'Body',
      html: '<p>Body</p>',
      summary: 'Hexo summary',
      cover: 'https://cdn.example.com/cover.jpg',
    })

    expect(result.success).toBe(true)
    expect(imageFetch).toHaveBeenCalledWith('https://cdn.example.com/cover.jpg')
    const urls = fake.fetchMock.mock.calls.map(([url]) => String(url))
    expect(urls).toEqual([
      'https://mp.weixin.qq.com/',
      expect.stringContaining('/cgi-bin/filetransfer'),
      expect.stringContaining('/cgi-bin/cropimage?action=crop_multi'),
      expect.stringContaining('/cgi-bin/operate_appmsg'),
    ])

    const body = fake.getDraftBody()
    expect(body?.get('cdn_url0')).toBe('https://mmbiz.qpic.cn/235.jpg')
    expect(body?.get('cdn_235_1_url0')).toBe('https://mmbiz.qpic.cn/235.jpg')
    expect(body?.get('cdn_1_1_url0')).toBe('https://mmbiz.qpic.cn/square.jpg')
    expect(body?.get('cdn_url_back0')).toBe('https://mmbiz.qpic.cn/original.jpg')
    expect(body?.get('crop_list0')).not.toBe('')
    expect(body?.get('digest0')).toBe('Hexo summary')
    expect(body?.get('auto_gen_digest0')).toBe('0')
  })

  it('fails instead of silently dropping a cover when upload fails', async () => {
    installImageMocks()
    const fake = createRuntime({ uploadError: true })
    const adapter = new WeixinAdapter()
    await adapter.init(fake.runtime)

    const result = await adapter.publish({
      title: 'Upload failure',
      markdown: 'Body',
      html: '<p>Body</p>',
      cover: 'https://cdn.example.com/cover.jpg',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('封面图上传失败')
    expect(fake.getDraftBody()).toBeUndefined()
  })

  it('fails instead of silently dropping a cover when cropping fails', async () => {
    installImageMocks()
    const fake = createRuntime({ cropError: true })
    const adapter = new WeixinAdapter()
    await adapter.init(fake.runtime)

    const result = await adapter.publish({
      title: 'Crop failure',
      markdown: 'Body',
      html: '<p>Body</p>',
      cover: 'https://cdn.example.com/cover.jpg',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('封面图裁剪失败')
    expect(fake.getDraftBody()).toBeUndefined()
  })

  it('preserves no-cover draft creation and automatic digest', async () => {
    const imageFetch = installImageMocks()
    const fake = createRuntime()
    const adapter = new WeixinAdapter()
    await adapter.init(fake.runtime)

    const result = await adapter.publish({
      title: 'No cover',
      markdown: 'Body',
      html: '<p>Body</p>',
    })

    expect(result.success).toBe(true)
    expect(imageFetch).not.toHaveBeenCalled()
    expect(fake.getDraftBody()?.get('cdn_url0')).toBe('')
    expect(fake.getDraftBody()?.get('crop_list0')).toBe('')
    expect(fake.getDraftBody()?.get('auto_gen_digest0')).toBe('1')
  })
})
