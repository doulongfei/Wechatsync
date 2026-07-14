export interface CropPercentRect {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface CropRect {
  x1: number
  y1: number
  x2: number
  y2: number
  percent: CropPercentRect
}

export type WeixinCoverRatio = '2.35_1' | '1_1'

export interface PreparedWeixinCrop {
  url: string
  fileId: string
  rect: CropRect
}

export interface PreparedWeixinCover {
  originalUrl: string
  originalFileId?: string
  crops: Record<WeixinCoverRatio, PreparedWeixinCrop>
}

export function calculateCenteredCrop(
  width: number,
  height: number,
  targetRatio: number
): CropRect {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Image dimensions must be positive')
  }
  if (!Number.isFinite(targetRatio) || targetRatio <= 0) {
    throw new Error('Target ratio must be positive')
  }

  let x1 = 0
  let y1 = 0
  let x2 = width
  let y2 = height

  if (width / height > targetRatio) {
    const cropWidth = Math.min(width, Math.round(height * targetRatio))
    x1 = Math.floor((width - cropWidth) / 2)
    x2 = x1 + cropWidth
  } else {
    const cropHeight = Math.min(height, Math.round(width / targetRatio))
    y1 = Math.floor((height - cropHeight) / 2)
    y2 = y1 + cropHeight
  }

  return {
    x1,
    y1,
    x2,
    y2,
    percent: {
      x1: x1 / width,
      y1: y1 / height,
      x2: x2 / width,
      y2: y2 / height,
    },
  }
}

function normalizeFileId(fileId: string): string | number {
  return /^\d+$/.test(fileId) ? Number(fileId) : fileId
}

function cropEntry(ratio: WeixinCoverRatio, crop: PreparedWeixinCrop) {
  return {
    ratio,
    x1: crop.rect.x1,
    y1: crop.rect.y1,
    x2: crop.rect.x2,
    y2: crop.rect.y2,
    file_id: normalizeFileId(crop.fileId),
  }
}

function cropPercentEntry(ratio: WeixinCoverRatio, crop: PreparedWeixinCrop) {
  return {
    ratio,
    ...crop.rect.percent,
    file_id: normalizeFileId(crop.fileId),
  }
}

export function buildWeixinCoverFields(
  prepared?: PreparedWeixinCover
): Record<string, string> {
  if (!prepared) {
    return {
      cdn_url0: '',
      cdn_235_1_url0: '',
      cdn_1_1_url0: '',
      cdn_url_back0: '',
      crop_list0: '',
      show_cover_pic0: '0',
    }
  }

  const wide = prepared.crops['2.35_1']
  const square = prepared.crops['1_1']
  const cropList = {
    crop_list: [cropEntry('2.35_1', wide), cropEntry('1_1', square)],
    crop_list_percent: [
      cropPercentEntry('2.35_1', wide),
      cropPercentEntry('1_1', square),
    ],
  }

  return {
    cdn_url0: wide.url,
    cdn_235_1_url0: wide.url,
    cdn_1_1_url0: square.url,
    cdn_url_back0: prepared.originalUrl,
    crop_list0: JSON.stringify(cropList),
    show_cover_pic0: '0',
  }
}

export function buildWeixinDigestFields(summary?: string): Record<string, string> {
  const normalized = summary?.trim()
  if (!normalized) {
    return {
      digest0: '',
      auto_gen_digest0: '1',
    }
  }

  return {
    digest0: Array.from(normalized).slice(0, 120).join(''),
    auto_gen_digest0: '0',
  }
}
