/**
 * 微信公众号适配器
 */
import { CodeAdapter, type ImageUploadResult } from '../code-adapter'
import type { Article, AuthResult, SyncResult, PlatformMeta } from '../../types'
import type { PublishOptions } from '../types'
import { createLogger } from '../../lib/logger'
import juice from 'juice'
import {
  buildWeixinCoverFields,
  buildWeixinDigestFields,
  calculateCenteredCrop,
  type CropRect,
  type PreparedWeixinCover,
} from './weixin-cover'

const logger = createLogger('Weixin')

interface WeixinMeta {
  token: string
  fingerprint: string
  userName: string
  nickName: string
  ticket: string
  svrTime: number
  avatar: string
}

interface WeixinUploadedImage {
  url: string
  fileId: string
}

interface WeixinCroppedImage {
  url: string
  fileId: string
}

// 微信公众号的默认 CSS 样式
const WEIXIN_CSS = `
p {
  color: rgb(51, 51, 51);
  font-size: 15px;
  line-height: 1.75em;
  margin: 0 0 1em 0;
}
h1, h2, h3, h4, h5, h6 {
  font-weight: bold;
}
h1 { font-size: 1.25em; line-height: 1.4em; margin: 1em 0 0.5em 0; }
h2 { font-size: 1.125em; margin: 1em 0 0.5em 0; }
h3 { font-size: 1.05em; margin: 0.8em 0 0.4em 0; }
h4, h5, h6 { font-size: 1em; margin: 0.8em 0 0.4em 0; }
li p { margin: 0; }
ul, ol { margin: 1em 0; padding-left: 2em; }
li { margin-bottom: 0.4em; }
pre, tt, code, kbd, samp { font-family: monospace; }
pre { white-space: pre; margin: 1em 0; }
blockquote { border-left: 4px solid #ddd; padding-left: 1em; margin: 1em 0; color: #666; }
hr { border: none; border-top: 1px solid #ddd; margin: 1.5em 0; }
i, cite, em, var, address { font-style: italic; }
b, strong { font-weight: bolder; }
`

export class WeixinAdapter extends CodeAdapter {
  readonly meta: PlatformMeta = {
    id: 'weixin',
    name: '微信公众号',
    icon: 'https://mp.weixin.qq.com/favicon.ico',
    homepage: 'https://mp.weixin.qq.com',
    capabilities: ['article', 'draft', 'image_upload', 'cover'],
  }

  /** 预处理配置: 微信公众号使用 HTML 格式，移除非微信域名链接，压缩标签间空白避免 ProseMirror 产生空节点 */
  readonly preprocessConfig = {
    outputFormat: 'html' as const,
    removeLinks: true,
    keepLinkDomains: ['mp.weixin.qq.com', 'weixin.qq.com'],
    // 公众号不允许正文外链跳转，但直接丢掉地址会让引用来源无法查证，
    // 因此降级成文末脚注：正文标 [n]，末尾列出完整 URL 供读者复制。
    linkFootnotes: true,
    compactHtml: true,
  }

  private weixinMeta: WeixinMeta | null = null

  /** 微信公众号 API 需要的 Header 规则 */
  private readonly HEADER_RULES = [
    {
      urlFilter: '*://mp.weixin.qq.com/cgi-bin/*',
      headers: {
        'Origin': 'https://mp.weixin.qq.com',
        'Referer': 'https://mp.weixin.qq.com/',
      },
      resourceTypes: ['xmlhttprequest'],
    },
  ]

  async checkAuth(): Promise<AuthResult> {
    try {
      const response = await this.runtime.fetch(
        'https://mp.weixin.qq.com/',
        {
          method: 'GET',
          credentials: 'include',
        }
      )

      const html = await response.text()

      const tokenMatch = html.match(/data:\s*\{[\s\S]*?t:\s*["']([^"']+)["']/)
      if (!tokenMatch) {
        logger.debug(' No token found')
        return { isAuthenticated: false }
      }

      const ticketMatch = html.match(/ticket:\s*["']([^"']+)["']/)
      const userNameMatch = html.match(/user_name:\s*["']([^"']+)["']/)
      const nickNameMatch = html.match(/nick_name:\s*["']([^"']+)["']/)
      const timeMatch = html.match(/time:\s*["'](\d+)["']/)
      const headImgMatch = html.match(/head_img:\s*['"]([^'"]+)['"]/)
      const fingerprintMatch = html.match(/fingerprint:\s*["']([^"']+)["']/)

      const avatarMatch = html.match(/class="weui-desktop-account__thumb"[^>]*src="([^"]+)"/)
      let avatar = avatarMatch ? avatarMatch[1] : (headImgMatch ? headImgMatch[1] : '')
      if (avatar.startsWith('http://')) {
        avatar = avatar.replace('http://', 'https://')
      }

      this.weixinMeta = {
        token: tokenMatch[1],
        fingerprint: fingerprintMatch?.[1] || tokenMatch[1],
        userName: userNameMatch ? userNameMatch[1] : '',
        nickName: nickNameMatch ? nickNameMatch[1] : '',
        ticket: ticketMatch ? ticketMatch[1] : '',
        svrTime: timeMatch ? Number(timeMatch[1]) : Date.now() / 1000,
        avatar,
      }

      logger.debug(' Auth info:', {
        userName: this.weixinMeta.userName,
        nickName: this.weixinMeta.nickName,
        hasToken: !!this.weixinMeta.token,
      })

      return {
        isAuthenticated: true,
        userId: this.weixinMeta.userName,
        username: this.weixinMeta.nickName,
        avatar: this.weixinMeta.avatar,
      }
    } catch (error) {
      logger.debug('checkAuth: not logged in -', error)
      return { isAuthenticated: false, error: (error as Error).message }
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    return this.withHeaderRules(this.HEADER_RULES, async () => {
      logger.info('Starting publish...')

      if (!this.weixinMeta) {
        const auth = await this.checkAuth()
        if (!auth.isAuthenticated) {
          throw new Error('请先登录微信公众号')
        }
      }

      // 微信到微信：使用原始 HTML，跳过所有处理
      let content = (article.source?.platform === 'weixin' && (article as any).rawHtml)
        ? (article as any).rawHtml
        : (article.html || '')

      if (article.source?.platform === 'weixin') {
        logger.info('Source is WeChat, using raw HTML, skipping content processing')
      } else {
        content = this.processLatex(content)
        content = this.stripExternalLinks(content)
        content = await this.processImages(
          content,
          (src) => this.uploadImageByUrl(src),
          {
            skipPatterns: ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn'],
            onProgress: options?.onImageProgress,
          }
        )
        content = this.processContent(content)
      }

      const preparedCover = article.cover
        ? await this.prepareCover(article.cover)
        : undefined
      const coverFields = buildWeixinCoverFields(preparedCover)
      const digestFields = buildWeixinDigestFields(article.summary)

      const formData = new URLSearchParams({
        token: this.weixinMeta!.token,
        lang: 'zh_CN',
        f: 'json',
        ajax: '1',
        random: String(Math.random()),
        AppMsgId: '',
        count: '1',
        data_seq: '0',
        operate_from: 'Chrome',
        isnew: '0',
        ad_video_transition0: '',
        can_reward0: '0',
        related_video0: '',
        is_video_recommend0: '-1',
        title0: article.title,
        author0: '',
        writerid0: '0',
        fileid0: '',
        ...digestFields,
        content0: content,
        sourceurl0: '',
        need_open_comment0: '1',
        only_fans_can_comment0: '0',
        ...coverFields,
        music_id0: '',
        video_id0: '',
        voteid0: '',
        voteismlt0: '',
        supervoteid0: '',
        cardid0: '',
        cardquantity0: '',
        cardlimit0: '',
        vid_type0: '',
        shortvideofileid0: '',
        copyright_type0: '0',
        releasefirst0: '',
        platform0: '',
        reprint_permit_type0: '',
        allow_reprint0: '',
        allow_reprint_modify0: '',
        original_article_type0: '',
        ori_white_list0: '',
        free_content0: '',
        fee0: '0',
        ad_id0: '',
        guide_words0: '',
        is_share_copyright0: '0',
        share_copyright_url0: '',
        source_article_type0: '',
        reprint_recommend_title0: '',
        reprint_recommend_content0: '',
        share_page_type0: '0',
        share_imageinfo0: '{"list":[]}',
        share_video_id0: '',
        dot0: '{}',
        share_voice_id0: '',
        insert_ad_mode0: '',
        categories_list0: '[]',
      })

      const response = await this.runtime.fetch(
        `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${this.weixinMeta!.token}&lang=zh_CN`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: formData,
        }
      )

      const res = await response.json() as {
        appMsgId?: string
        ret?: number
        base_resp?: { ret: number; err_msg?: string }
      }

      logger.debug(' Save response:', res)

      if (!res.appMsgId) {
        const errMsg = this.formatError(res)
        throw new Error(errMsg)
      }

      const draftUrl = `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${res.appMsgId}&token=${this.weixinMeta!.token}&lang=zh_CN`

      return this.createResult(true, {
        postId: res.appMsgId,
        postUrl: draftUrl,
        draftOnly: options?.draftOnly ?? true,
      })
    }).catch((error) => this.createResult(false, {
      error: (error as Error).message,
    }))
  }

  protected async uploadImageByUrl(src: string): Promise<ImageUploadResult> {
    const imageBlob = await this.downloadImage(src)
    const uploaded = await this.uploadImageBlob(imageBlob, src)
    return { url: uploaded.url }
  }

  private async downloadImage(src: string): Promise<Blob> {
    const imageResponse = await fetch(src)
    if (!imageResponse.ok) {
      throw new Error(`图片下载失败 (${imageResponse.status}): ${src}`)
    }
    return await imageResponse.blob()
  }

  private async uploadImageBlob(
    imageBlob: Blob,
    sourceDescription: string
  ): Promise<WeixinUploadedImage> {
    if (!this.weixinMeta) {
      throw new Error('未登录')
    }

    const formData = new FormData()
    const timestamp = Date.now()
    const extension = imageBlob.type === 'image/png'
      ? 'png'
      : imageBlob.type === 'image/webp'
        ? 'webp'
        : 'jpg'
    const fileName = `${timestamp}.${extension}`

    formData.append('type', imageBlob.type || 'image/jpeg')
    formData.append('id', String(timestamp))
    formData.append('name', fileName)
    formData.append('lastModifiedDate', new Date().toString())
    formData.append('size', String(imageBlob.size))
    formData.append('file', imageBlob, fileName)

    const { token, userName, ticket, svrTime } = this.weixinMeta
    const seq = Date.now()

    const response = await this.runtime.fetch(
      `https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&ticket_id=${userName}&ticket=${ticket}&svr_time=${svrTime}&token=${token}&lang=zh_CN&seq=${seq}&t=${Math.random()}`,
      {
        method: 'POST',
        credentials: 'include',
        body: formData,
      }
    )

    const res = await response.json() as {
      cdn_url?: string
      content?: string
      base_resp?: { err_msg: string; ret: number }
    }

    logger.debug(' Image upload response:', res)

    if (res.base_resp?.err_msg !== 'ok' || !res.cdn_url || !res.content) {
      throw new Error(
        `图片上传失败: ${sourceDescription} (${res.base_resp?.err_msg || 'invalid response'})`
      )
    }

    return {
      url: res.cdn_url,
      fileId: res.content,
    }
  }

  private async prepareCover(src: string): Promise<PreparedWeixinCover> {
    let imageBlob: Blob
    try {
      imageBlob = await this.downloadImage(src)
    } catch (error) {
      throw new Error(`封面图下载失败: ${(error as Error).message}`)
    }

    if (typeof createImageBitmap !== 'function') {
      throw new Error('封面图解析失败: 当前浏览器不支持 createImageBitmap')
    }

    let width: number
    let height: number
    try {
      const bitmap = await createImageBitmap(imageBlob)
      width = bitmap.width
      height = bitmap.height
      bitmap.close()
    } catch (error) {
      throw new Error(`封面图解析失败: ${(error as Error).message}`)
    }

    let uploaded: WeixinUploadedImage
    try {
      uploaded = await this.uploadImageBlob(imageBlob, src)
    } catch (error) {
      throw new Error(`封面图上传失败: ${(error as Error).message}`)
    }

    const wideRect = calculateCenteredCrop(width, height, 2.35)
    const squareRect = calculateCenteredCrop(width, height, 1)
    let cropped: [WeixinCroppedImage, WeixinCroppedImage]
    try {
      cropped = await this.cropCover(uploaded.url, [wideRect, squareRect])
    } catch (error) {
      throw new Error(`封面图裁剪失败: ${(error as Error).message}`)
    }

    return {
      originalUrl: uploaded.url,
      originalFileId: uploaded.fileId,
      crops: {
        '2.35_1': {
          url: cropped[0].url,
          fileId: cropped[0].fileId,
          rect: wideRect,
        },
        '1_1': {
          url: cropped[1].url,
          fileId: cropped[1].fileId,
          rect: squareRect,
        },
      },
    }
  }

  private async cropCover(
    imageUrl: string,
    rectangles: [CropRect, CropRect]
  ): Promise<[WeixinCroppedImage, WeixinCroppedImage]> {
    if (!this.weixinMeta) throw new Error('未登录')

    const formData = new URLSearchParams()
    formData.append('imgurl', imageUrl)
    formData.append('size_count', String(rectangles.length))
    const formats = ['2.35_1', '1_1'] as const
    rectangles.forEach((rect, index) => {
      formData.append(`size${index}_x1`, String(rect.percent.x1))
      formData.append(`size${index}_y1`, String(rect.percent.y1))
      formData.append(`size${index}_x2`, String(rect.percent.x2))
      formData.append(`size${index}_y2`, String(rect.percent.y2))
      formData.append(`format${index}`, formats[index])
    })
    formData.append('fingerprint', this.weixinMeta.fingerprint)
    formData.append('token', this.weixinMeta.token)
    formData.append('lang', 'zh_CN')
    formData.append('f', 'json')
    formData.append('ajax', '1')

    const response = await this.runtime.fetch(
      'https://mp.weixin.qq.com/cgi-bin/cropimage?action=crop_multi',
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: formData,
      }
    )
    const res = await response.json() as {
      base_resp?: { err_msg?: string; ret?: number }
      result?: Array<{ cdnurl?: string; file_id?: string | number }>
    }

    if (res.base_resp?.err_msg !== 'ok' || !res.result || res.result.length < 2) {
      throw new Error(res.base_resp?.err_msg || 'invalid crop response')
    }

    const crops = res.result.slice(0, 2).map((item) => {
      if (!item.cdnurl || item.file_id === undefined || item.file_id === null) {
        throw new Error('crop response is missing cdnurl or file_id')
      }
      return {
        url: item.cdnurl,
        fileId: String(item.file_id),
      }
    })

    return [crops[0], crops[1]]
  }

  private isLatexFormula(text: string): boolean {
    if (/[\\^_{}]/.test(text)) return true
    if (/[α-ωΑ-Ω]/.test(text)) return true
    if (/[∑∏∫∂∇∞≠≤≥±×÷√]/.test(text)) return true
    return false
  }

  private processLatex(content: string): string {
    const LATEX_API = 'https://latex.codecogs.com/png.latex'

    content = content.replace(/\$\$([^$]+)\$\$/g, (match, latex) => {
      if (!this.isLatexFormula(latex)) return match
      const encoded = encodeURIComponent(latex.trim())
      return `<p style="text-align: center;"><img src="${LATEX_API}?\\dpi{150}${encoded}" alt="formula" style="vertical-align: middle; max-width: 100%;"></p>`
    })

    content = content.replace(/\$([^$]+)\$/g, (match, latex) => {
      if (!this.isLatexFormula(latex)) return match
      const encoded = encodeURIComponent(latex.trim())
      return `<img src="${LATEX_API}?\\dpi{120}${encoded}" alt="formula" style="vertical-align: middle;">`
    })

    return content
  }

  private processContent(content: string): string {
    const wrapped = `<section style="margin-left: 6px; margin-right: 6px; line-height: 1.75em;">${content}</section>`
    return juice.inlineContent(wrapped, WEIXIN_CSS)
  }

  /**
   * 移除外部链接（微信不允许非 mp.weixin.qq.com 域名的链接）
   * 将 <a href="外部链接">文字</a> 转换为 文字
   */
  private stripExternalLinks(content: string): string {
    // 匹配 <a> 标签，保留微信域名的链接
    return content.replace(
      /<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (match, href, text) => {
        // 保留微信域名的链接
        if (href && (
          href.includes('mp.weixin.qq.com') ||
          href.includes('weixin.qq.com') ||
          href.startsWith('#') ||  // 锚点链接
          href.startsWith('javascript:')  // JS 链接
        )) {
          return match
        }
        // 外部链接只保留文字
        return text
      }
    )
  }

  private formatError(res: { ret?: number; base_resp?: { ret: number } }): string {
    const ret = res.ret ?? res.base_resp?.ret

    const errorMap: Record<number, string> = {
      [-6]: '请输入验证码',
      [-8]: '请输入验证码',
      [-1]: '系统错误，请注意备份内容后重试',
      [-2]: '参数错误，请注意备份内容后重试',
      [-5]: '服务错误，请注意备份内容后重试',
      [-99]: '内容超出字数，请调整',
      [-206]: '服务负荷过大，请稍后重试',
      [200002]: '参数错误，请注意备份内容后重试',
      [200003]: '登录态超时，请重新登录',
      [412]: '图文中含非法外链',
      [62752]: '可能含有具备安全风险的链接，请检查',
      [64502]: '你输入的微信号不存在',
      [64505]: '发送预览失败，请稍后再试',
      [64506]: '保存失败，链接不合法',
      [64507]: '内容不能包含外部链接',
      [64562]: '请勿插入非微信域名的链接',
      [64509]: '正文中不能包含超过3个视频',
      [64515]: '当前素材非最新内容，请重新打开并编辑',
      [64702]: '标题超出64字长度限制',
      [64703]: '摘要超出120字长度限制',
      [64705]: '内容超出字数，请调整',
      [10806]: '正文不能有违规内容，请重新编辑',
      [10807]: '内容不能违反公众平台协议',
      [220001]: '素材管理中的存储数量已达上限',
      [220002]: '图片库已达到存储上限',
    }

    return errorMap[ret as number] || `同步失败 (错误码: ${ret})`
  }
}
