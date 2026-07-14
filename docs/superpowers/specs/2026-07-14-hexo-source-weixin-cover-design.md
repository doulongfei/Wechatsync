# Hexo Source and WeChat Cover Design

## Objective

Extend Wechatsync so a standard Hexo Markdown post can be synchronized directly from the CLI to a logged-in WeChat Official Account, including the post title, summary, body images, and cover image. The same extension build must also select the page's OpenGraph cover when synchronizing a rendered Hexo page.

The supported primary command is:

```bash
wechatsync sync /path/to/hexo/source/_posts/article.md -p weixin
```

The result is a WeChat draft. Publishing remains a deliberate manual action.

## Selected Architecture

The implementation uses an upstream-compatible source adapter rather than Blog-specific preprocessing or theme-specific DOM rules.

1. The CLI parses Markdown and Hexo Front Matter into a normalized article source object.
2. The CLI resolves local Hexo assets and sends all normalized fields through the existing WebSocket bridge.
3. The extension consumes the normalized article and delegates publishing to platform adapters.
4. The Weixin adapter uploads and crops the cover before creating the draft.
5. Browser-page extraction explicitly prefers standard social metadata before Reader heuristics.

This keeps the Blog responsible only for valid Hexo data and standard OpenGraph output. Wechatsync owns source parsing and platform-specific behavior.

## Alternatives Rejected

### Blog-only preprocessing script

A Blog script could render a temporary Markdown or HTML file for the current repository. It would not make Wechatsync support Hexo and would duplicate parsing rules outside the CLI.

### Theme-specific extractor rules

Hard-coding Solitude selectors would improve one rendered site, but would not support local Markdown or fix the WeChat cover API. Standard OpenGraph metadata is the portable browser contract.

## CLI Source Model

Markdown parsing moves from `packages/cli/src/index.ts` into a focused, testable source module. It uses `gray-matter` for complete YAML parsing.

The normalized source contains:

```ts
interface ParsedArticleSource {
  title: string | null
  content: string
  format: 'markdown' | 'html'
  cover?: string
  summary?: string
  tags?: string[]
  category?: string
  canonical?: string
  sync?: {
    enabled?: boolean
    targets?: string[]
  }
}
```

Supported Hexo fields are `title`, `cover`, `summary`, `description`, `excerpt`, `tags`, `category`, `categories`, `canonical`, and `sync`. A scalar tag/category is normalized to an array; the first category becomes the platform-neutral `category` field.

Command-line fields override Front Matter. Platform selection follows this order:

1. Explicit `--platforms` / `-p`.
2. Non-empty `sync.targets` when `sync.enabled` is not `false`.
3. Existing default `zhihu,juejin`.

An explicit platform selection intentionally overrides `sync.enabled: false`. This allows a user to test or manually synchronize an article that is disabled for automatic workflows.

If Front Matter supplies the title and the first body H1 has the same normalized text, the CLI removes that H1. A different H1 remains part of the article.

Invalid YAML, invalid field types, a missing title, or an empty explicit platform list produces a clear error before the browser bridge starts.

## Hexo Asset Resolution

HTTP(S) URLs and data URIs pass through unchanged.

- A relative cover such as `./cover.png` resolves from the Markdown file's directory.
- A root-relative Hexo cover such as `/img/cover.png` resolves from `<nearest Hexo root>/source/img/cover.png`, where the nearest Hexo root is an ancestor containing `_config.yml` and `source/`.
- If no Hexo root is found, a root-relative path is rejected with a diagnostic instead of accidentally reading the operating system root.
- The resolved local cover becomes a data URI before it crosses the bridge.
- Existing body-image handling continues to resolve relative references from the Markdown file directory and upload them through the selected platform.

## Bridge Contract

The `syncArticle` bridge accepts and forwards `summary`, `tags`, `category`, and canonical source URL in addition to the existing title, Markdown, HTML, and cover. This preserves the normalized article instead of discarding Front Matter after parsing.

For a canonical URL, the extension sets:

```ts
source: { url: canonical, platform: 'hexo' }
```

## Browser Cover Selection

Rendered-page extraction uses this priority:

1. `meta[property="og:image"]`
2. `meta[name="twitter:image"]`
3. `[itemprop="image"]`
4. Reader `leadingImage`
5. Reader `mainImage`

Empty URLs and favicon/icon candidates are ignored. Relative metadata URLs are resolved against `document.baseURI`. The rule is generic and does not depend on the Solitude theme.

## WeChat Cover Pipeline

The Weixin adapter declares the `cover` capability. When `article.cover` is present it performs these steps inside the authenticated browser context:

1. Download the remote URL or data URI as a Blob.
2. Read image dimensions with `createImageBitmap`.
3. Upload the original image through `filetransfer?action=upload_material&scene=8`.
4. Preserve both the returned original `cdn_url` and `content` file identifier.
5. Compute centered crops for 2.35:1 and 1:1.
6. Call `cropimage?action=crop_multi` and collect the cropped CDN URLs and file identifiers.
7. Populate `cdn_url0`, `cdn_235_1_url0`, `cdn_1_1_url0`, `cdn_url_back0`, and `crop_list0` in the draft request.

`show_cover_pic0` remains `0`: the image is the article-card cover but is not automatically duplicated at the beginning of the body.

When no cover is supplied, existing no-cover draft creation remains valid. When a cover is supplied, download, decode, upload, crop, or response failures abort the sync with an actionable error. The adapter never silently drops an explicitly requested cover.

`digest0` uses the normalized summary truncated to WeChat's 120-character limit. Without a summary, WeChat's automatic digest remains enabled.

## Testing

### CLI unit tests

- Parse folded YAML, arrays, scalars, quoted titles, summary, canonical URL, and sync targets.
- Remove only a duplicate leading H1.
- Reject malformed Front Matter field types.
- Resolve relative and Hexo root-relative cover files.
- Verify CLI platform precedence.
- Parse the repository's real Linux article fixture.

### Extension extraction tests

- Prefer `og:image` over Reader's favicon-like main image.
- Fall back through Twitter, itemprop, leading, and main images.
- Resolve relative metadata URLs and ignore icon candidates.

### Weixin adapter tests

- Verify centered crop geometry.
- Verify cover upload and crop responses populate every required draft field.
- Verify summary digest behavior.
- Verify no-cover behavior remains supported.
- Verify an explicit cover failure returns a failed synchronization result rather than saving without a cover.

### Build and packaging checks

- Run CLI, core, and extension tests.
- Run workspace type checks and production builds.
- Execute the built CLI in `--dry-run` mode against the real Hexo article.
- Produce an npm-installable CLI tarball.
- Produce a Chrome MV3 ZIP whose manifest and expected entry files are validated after extraction.

## Versioning and Deliverables

- Extension and manifest version: `2.1.0`.
- CLI version: `1.2.0`.
- Repository: public fork `doulongfei/Wechatsync`, with `origin` pointing to the fork and `upstream` pointing to `wechatsync/Wechatsync`.
- Deliverables remain outside Git tracking under `artifacts/` and include checksums:
  - `wechatsync-extension-v2.1.0-hexo.zip`
  - `wechatsync-cli-1.2.0.tgz`
  - `SHA256SUMS`

## Operational Boundary

The CLI is not headless authentication. It starts the bridge; the replacement extension must be enabled and connected, and Chrome must already be logged in to `mp.weixin.qq.com`. This preserves Wechatsync's local-data and browser-login model.

End-to-end verification creates drafts only. It does not publish a WeChat article publicly.
