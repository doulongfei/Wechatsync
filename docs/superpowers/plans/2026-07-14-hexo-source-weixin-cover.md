# Hexo Source and WeChat Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize a standard Hexo Markdown post directly through the Wechatsync CLI into a logged-in WeChat Official Account draft with the correct title, summary, body images, and cover, and deliver matching CLI and Chrome extension packages.

**Architecture:** A focused CLI source module normalizes Hexo Front Matter and assets into the existing `Article` contract. The extension bridge preserves those fields, browser extraction prefers standard social metadata, and the Weixin adapter uploads/crops a cover before building the draft form. Pure parsing, selection, crop, and field-building functions provide deterministic unit-test boundaries around browser/network code.

**Tech Stack:** TypeScript, Node.js 20+, `gray-matter`, Commander, Vitest, Chrome MV3, Vite, existing Wechatsync runtime abstraction.

## Global Constraints

- Explicit `--platforms` overrides Hexo `sync.enabled` and `sync.targets`.
- Without explicit platforms, use enabled non-empty `sync.targets`, otherwise `zhihu,juejin`.
- Local paths must never accidentally resolve from the process working directory or operating-system root.
- An explicitly supplied cover must either reach the WeChat draft form or fail the synchronization clearly.
- WeChat synchronization creates a draft only; it never publishes publicly.
- Extension version is `2.1.0`; CLI version is `1.2.0`.
- Final artifacts are `wechatsync-extension-v2.1.0-hexo.zip`, `wechatsync-cli-1.2.0.tgz`, and `SHA256SUMS`.

---

### Task 1: Hexo Article Source Parser

**Files:**
- Create: `packages/cli/src/article-source.ts`
- Create: `packages/cli/src/__tests__/article-source.test.ts`
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/index.ts`
- Modify: `yarn.lock`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `parseFileContent(filePath: string): ParsedArticleSource`
- Produces: `selectPlatforms(explicit: string | undefined, source: ParsedArticleSource): string[]`
- Produces: `materializeCover(cover: string | undefined, articlePath: string): string | undefined`
- Consumes: `gray-matter` YAML parsing and the existing HTML parsing behavior.

- [ ] **Step 1: Add parser tests that fail before implementation**

Cover folded YAML, scalar/array tags, category normalization, canonical and sync metadata, duplicate/non-duplicate H1 behavior, malformed types, relative covers, root-relative Hexo covers, and platform precedence. Include a real-fixture test pointed at `../../../../blog/source/_posts/linux/Linux命令行table格式的输出转json通用函数.md` only when the fixture exists.

- [ ] **Step 2: Run the focused tests and record RED**

Run:

```bash
yarn workspace @wechatsync/cli vitest run src/__tests__/article-source.test.ts
```

Expected: failure because `article-source.ts` and its exports do not exist.

- [ ] **Step 3: Implement normalized parsing and asset resolution**

Implement the following public types and functions:

```ts
export interface ParsedArticleSource {
  title: string | null
  content: string
  format: 'markdown' | 'html'
  cover?: string
  summary?: string
  tags?: string[]
  category?: string
  canonical?: string
  sync?: { enabled?: boolean; targets?: string[] }
}

export function parseFileContent(filePath: string): ParsedArticleSource
export function selectPlatforms(
  explicit: string | undefined,
  source: ParsedArticleSource
): string[]
export function materializeCover(
  cover: string | undefined,
  articlePath: string
): string | undefined
```

Use `gray-matter`; normalize scalars without stringifying objects; strip only a first H1 whose trimmed text equals the Front Matter title; find a Hexo root by walking ancestors for `_config.yml` plus `source/`; convert supported local image formats to data URIs.

- [ ] **Step 4: Integrate the source module into the CLI**

Remove the duplicated parser from `index.ts`. Make `--platforms` optional so precedence can be evaluated after parsing. Forward `summary`, `tags`, `category`, and `canonical` through `syncArticle`. Preserve existing HTML parsing and default behavior.

- [ ] **Step 5: Run focused and CLI-wide tests and record GREEN**

```bash
yarn workspace @wechatsync/cli vitest run
yarn workspace @wechatsync/cli build
```

Expected: all parser tests pass and CLI bundle exits 0.

- [ ] **Step 6: Commit the source adapter**

```bash
git add packages/cli package.json yarn.lock pnpm-lock.yaml
git commit -m "feat(cli): support Hexo article sources"
```

### Task 2: Preserve Normalized Metadata Across the Extension Bridge

**Files:**
- Modify: `packages/extension/src/mcp/client.ts`
- Create: `packages/extension/__tests__/mcp-article-normalization.test.ts`

**Interfaces:**
- Consumes: bridge article fields from Task 1.
- Produces: `Article` with `summary`, `tags`, `category`, `cover`, and optional `{ url: canonical, platform: 'hexo' }` source.

- [ ] **Step 1: Write a failing bridge-normalization test**

Extract a pure helper:

```ts
export function normalizeBridgeArticle(input: BridgeArticleInput): Article
```

The test supplies every Hexo field and asserts none are dropped.

- [ ] **Step 2: Run the test and record RED**

```bash
yarn workspace @wechatsync/extension vitest run __tests__/mcp-article-normalization.test.ts
```

Expected: failure because the helper is missing.

- [ ] **Step 3: Implement and use the helper**

Keep Markdown-to-HTML conversion in the bridge handler, then pass the normalized values to `performSync`. Only create `source` when canonical is a non-empty URL.

- [ ] **Step 4: Run the extension test and typecheck**

```bash
yarn workspace @wechatsync/extension vitest run __tests__/mcp-article-normalization.test.ts
yarn workspace @wechatsync/extension typecheck
```

Expected: both commands exit 0.

### Task 3: Prefer OpenGraph Covers for Rendered Hexo Pages

**Files:**
- Create: `packages/extension/src/content/cover-selector.ts`
- Create: `packages/extension/__tests__/cover-selector.test.ts`
- Modify: `packages/extension/src/content/extractor.ts`

**Interfaces:**
- Produces: `selectArticleCover(doc, reader): string | undefined`
- Consumes: a document-like `querySelector` API plus Reader `leadingImage` and `mainImage` candidates.

- [ ] **Step 1: Write failing cover-priority tests**

Test OG over favicon-like Reader image, Twitter fallback, itemprop fallback, Reader fallback, relative URL resolution, and rejection of favicon/icon paths.

- [ ] **Step 2: Run the test and record RED**

```bash
yarn workspace @wechatsync/extension vitest run __tests__/cover-selector.test.ts
```

Expected: failure because `cover-selector.ts` is missing.

- [ ] **Step 3: Implement and integrate the selector**

Use priority `og:image`, `twitter:image`, itemprop image, leading image, main image. Resolve with `new URL(candidate, baseURI)`. Reject empty values, data-less values, and path names containing `favicon` or ending in common icon filenames.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
yarn workspace @wechatsync/extension vitest run __tests__/cover-selector.test.ts
yarn workspace @wechatsync/extension typecheck
```

Expected: all exit 0.

- [ ] **Step 5: Commit bridge and extractor support**

```bash
git add packages/extension
git commit -m "feat(extension): preserve Hexo metadata and prefer OpenGraph covers"
```

### Task 4: WeChat Cover Geometry and Draft Fields

**Files:**
- Create: `packages/core/src/adapters/platforms/weixin-cover.ts`
- Create: `packages/core/src/adapters/platforms/__tests__/weixin-cover.test.ts`

**Interfaces:**
- Produces: `calculateCenteredCrop(width, height, targetRatio): CropRect`
- Produces: `buildWeixinCoverFields(prepared?: PreparedWeixinCover): Record<string, string>`
- Produces: `buildWeixinDigestFields(summary?: string): Record<string, string>`

- [ ] **Step 1: Write failing pure-function tests**

Assert landscape and portrait centered crop coordinates, percent coordinates, 2.35:1 and 1:1 CDN mapping, crop JSON file IDs, no-cover empty fields, and 120-character digest truncation.

- [ ] **Step 2: Run the tests and record RED**

```bash
yarn workspace @wechatsync/core vitest run src/adapters/platforms/__tests__/weixin-cover.test.ts
```

Expected: failure because the module is missing.

- [ ] **Step 3: Implement the geometry and field builders**

Use integer pixel bounds and normalized 0..1 percentages. Keep `show_cover_pic0: '0'`. Use automatic digest only when summary is missing.

- [ ] **Step 4: Run focused tests and record GREEN**

```bash
yarn workspace @wechatsync/core vitest run src/adapters/platforms/__tests__/weixin-cover.test.ts
```

Expected: all tests pass.

### Task 5: WeChat Cover Upload and Crop Pipeline

**Files:**
- Modify: `packages/core/src/adapters/platforms/weixin.ts`
- Create: `packages/core/src/adapters/platforms/__tests__/weixin.test.ts`

**Interfaces:**
- Consumes: helpers and `PreparedWeixinCover` from Task 4.
- Produces: an authenticated upload/crop/save sequence whose captured draft form contains the prepared cover fields.

- [ ] **Step 1: Write a failing adapter integration test**

Use a fake `RuntimeInterface`, mocked image download, and mocked `createImageBitmap`. Return deterministic upload and crop JSON. Assert request order and exact `URLSearchParams` fields. Add failure tests for upload and crop errors and a no-cover regression test.

- [ ] **Step 2: Run the adapter test and record RED**

```bash
yarn workspace @wechatsync/core vitest run src/adapters/platforms/__tests__/weixin.test.ts
```

Expected: cover fields are empty or the crop endpoint is never called.

- [ ] **Step 3: Implement authenticated cover preparation**

Extend the private upload result to retain `content` as file ID. Decode dimensions via `createImageBitmap`, calculate two centered crops, call `/cgi-bin/cropimage?action=crop_multi`, validate result count/fields, and build `PreparedWeixinCover`. Add `cover` to capabilities.

- [ ] **Step 4: Populate the draft form and summary**

Merge cover and digest helpers into the existing `URLSearchParams` construction. Keep body-image processing unchanged. Propagate actionable errors through the existing failed `SyncResult` path.

- [ ] **Step 5: Run focused and core-wide tests**

```bash
yarn workspace @wechatsync/core vitest run src/adapters/platforms/__tests__/weixin.test.ts
yarn workspace @wechatsync/core vitest run
yarn workspace @wechatsync/core build
```

Expected: all tests pass and core build exits 0.

- [ ] **Step 6: Commit WeChat cover support**

```bash
git add packages/core
git commit -m "feat(weixin): upload and crop article covers"
```

### Task 6: Versions, Documentation, and Real Hexo Fixture

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/extension/package.json`
- Modify: `packages/extension/manifest.json`
- Modify: `README.md`
- Modify: `packages/cli/README.md`
- Modify: lockfiles as generated.

**Interfaces:**
- Produces: documented `wechatsync sync <hexo-post> -p weixin` workflow.

- [ ] **Step 1: Bump versions and update docs**

Set CLI to `1.2.0`, extension/manifest to `2.1.0`, and replace the CLI's hard-coded version with the same value. Document Front Matter fields, precedence, browser bridge requirement, draft-only behavior, and local package installation.

- [ ] **Step 2: Build and run the real article dry-run**

```bash
yarn workspace @wechatsync/cli build
node packages/cli/dist/index.js sync ../blog/source/_posts/linux/Linux命令行table格式的输出转json通用函数.md -p weixin --dry-run
```

Expected output includes the exact article title, `weixin`, and the Pixabay window cover URL, and does not start the browser bridge.

- [ ] **Step 3: Run workspace verification**

```bash
yarn test
yarn typecheck
yarn build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit versions and documentation**

```bash
git add README.md packages package.json yarn.lock pnpm-lock.yaml
git commit -m "docs: document Hexo to WeChat workflow"
```

### Task 7: Package, Inspect, Push, and Deliver

**Files:**
- Create outside Git tracking: `artifacts/wechatsync-extension-v2.1.0-hexo.zip`
- Create outside Git tracking: `artifacts/wechatsync-cli-1.2.0.tgz`
- Create outside Git tracking: `artifacts/SHA256SUMS`

**Interfaces:**
- Produces: installable browser replacement and CLI tarball.

- [ ] **Step 1: Build production packages**

```bash
mkdir -p artifacts
(cd packages/extension/dist && zip -r ../../../artifacts/wechatsync-extension-v2.1.0-hexo.zip .)
(cd packages/cli && npm pack --pack-destination ../../artifacts)
```

Rename the npm output to `wechatsync-cli-1.2.0.tgz`.

- [ ] **Step 2: Inspect package contents**

```bash
unzip -t artifacts/wechatsync-extension-v2.1.0-hexo.zip
tar -tzf artifacts/wechatsync-cli-1.2.0.tgz
```

Extract the extension to a temporary directory and assert manifest version `2.1.0`, MV3, service worker, popup, Reader scripts, and asset icons exist. Install the CLI tarball into a temporary npm prefix and run `wechatsync --version` plus the real article dry-run.

- [ ] **Step 3: Generate checksums and audit requirements**

```bash
shasum -a 256 artifacts/wechatsync-extension-v2.1.0-hexo.zip artifacts/wechatsync-cli-1.2.0.tgz > artifacts/SHA256SUMS
git status --short
git log --oneline upstream/v2..HEAD
```

Match every design requirement to a test, build output, dry-run output, or inspected artifact.

- [ ] **Step 4: Push the maintained branch**

```bash
git push -u origin v2
```

Verify `origin/v2` equals local `HEAD` through both `git rev-parse` and `gh repo view`/API.

- [ ] **Step 5: Deliver replacement instructions**

Provide absolute artifact paths, SHA-256 values, Chrome replacement steps, CLI install command, bridge configuration, and the real sync command. Do not claim a live WeChat draft was created unless an authenticated end-to-end run produced a draft URL.
