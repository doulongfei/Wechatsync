import { describe, expect, it } from 'vitest'
import {
  buildWeixinCoverFields,
  buildWeixinDigestFields,
  calculateCenteredCrop,
  type PreparedWeixinCover,
} from '../weixin-cover'

describe('calculateCenteredCrop', () => {
  it('centers a 2.35:1 crop inside a wider-than-tall source', () => {
    const crop = calculateCenteredCrop(1200, 630, 2.35)

    expect(crop).toEqual({
      x1: 0,
      y1: 59,
      x2: 1200,
      y2: 570,
      percent: {
        x1: 0,
        y1: 59 / 630,
        x2: 1,
        y2: 570 / 630,
      },
    })
  })

  it('centers a square crop inside a portrait source', () => {
    const crop = calculateCenteredCrop(800, 1200, 1)

    expect(crop).toEqual({
      x1: 0,
      y1: 200,
      x2: 800,
      y2: 1000,
      percent: {
        x1: 0,
        y1: 1 / 6,
        x2: 1,
        y2: 5 / 6,
      },
    })
  })

  it('rejects invalid dimensions and ratios', () => {
    expect(() => calculateCenteredCrop(0, 100, 1)).toThrow('Image dimensions must be positive')
    expect(() => calculateCenteredCrop(100, 100, 0)).toThrow('Target ratio must be positive')
  })
})

describe('buildWeixinCoverFields', () => {
  const prepared: PreparedWeixinCover = {
    originalUrl: 'https://mmbiz.qpic.cn/original.jpg',
    crops: {
      '2.35_1': {
        url: 'https://mmbiz.qpic.cn/235.jpg',
        fileId: '23501',
        rect: calculateCenteredCrop(1200, 630, 2.35),
      },
      '1_1': {
        url: 'https://mmbiz.qpic.cn/square.jpg',
        fileId: '10001',
        rect: calculateCenteredCrop(1200, 630, 1),
      },
    },
  }

  it('maps uploaded crops to every required draft field', () => {
    const fields = buildWeixinCoverFields(prepared)

    expect(fields).toMatchObject({
      cdn_url0: 'https://mmbiz.qpic.cn/235.jpg',
      cdn_235_1_url0: 'https://mmbiz.qpic.cn/235.jpg',
      cdn_1_1_url0: 'https://mmbiz.qpic.cn/square.jpg',
      cdn_url_back0: 'https://mmbiz.qpic.cn/original.jpg',
      show_cover_pic0: '0',
    })

    expect(JSON.parse(fields.crop_list0)).toEqual({
      crop_list: [
        {
          ratio: '2.35_1',
          x1: 0,
          y1: 59,
          x2: 1200,
          y2: 570,
          file_id: 23501,
        },
        {
          ratio: '1_1',
          x1: 285,
          y1: 0,
          x2: 915,
          y2: 630,
          file_id: 10001,
        },
      ],
      crop_list_percent: [
        {
          ratio: '2.35_1',
          x1: 0,
          y1: 59 / 630,
          x2: 1,
          y2: 570 / 630,
          file_id: 23501,
        },
        {
          ratio: '1_1',
          x1: 285 / 1200,
          y1: 0,
          x2: 915 / 1200,
          y2: 1,
          file_id: 10001,
        },
      ],
    })
  })

  it('produces the existing empty fields when no cover is supplied', () => {
    expect(buildWeixinCoverFields()).toEqual({
      cdn_url0: '',
      cdn_235_1_url0: '',
      cdn_1_1_url0: '',
      cdn_url_back0: '',
      crop_list0: '',
      show_cover_pic0: '0',
    })
  })
})

describe('buildWeixinDigestFields', () => {
  it('uses a trimmed summary and limits it to 120 Unicode characters', () => {
    expect(buildWeixinDigestFields(`  ${'摘'.repeat(121)}  `)).toEqual({
      digest0: '摘'.repeat(120),
      auto_gen_digest0: '0',
    })
  })

  it('keeps WeChat automatic digest when summary is absent', () => {
    expect(buildWeixinDigestFields()).toEqual({
      digest0: '',
      auto_gen_digest0: '1',
    })
  })
})
