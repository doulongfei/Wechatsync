import { describe, expect, it } from 'vitest'
import { extractRenderedBody } from '../article-source'

function page(body: string): string {
  return `<!DOCTYPE html><html><body><div id="post">
<article class="post-content" id="article-container">${body}</article>
<footer>site footer</footer></body></html>`
}

describe('extractRenderedBody', () => {
  it('pulls the article body out of a Hexo build artifact', () => {
    const html = page('<h2>Heading</h2><p>Body text</p>')
    expect(extractRenderedBody(html)).toBe('<h2>Heading</h2><p>Body text</p>')
  })

  it('leaves the surrounding chrome behind', () => {
    const extracted = extractRenderedBody(page('<p>Body</p>'))
    expect(extracted).not.toContain('site footer')
    expect(extracted).not.toContain('<html')
  })

  it('strips heading anchors that mean nothing off-site', () => {
    const html = page('<h2 id="x"><a href="#x" class="headerlink" title="x"></a>Heading</h2>')
    const extracted = extractRenderedBody(html)
    expect(extracted).not.toContain('headerlink')
    expect(extracted).toContain('Heading')
  })

  it('strips scripts that target platforms would drop anyway', () => {
    const html = page('<p>Body</p><script>console.log("x")</script>')
    expect(extractRenderedBody(html)).not.toContain('<script')
  })

  // Counting the tag pairs matters: bailing at the first </article> would
  // truncate the body whenever the post embeds an article element of its own.
  it('matches the closing tag by depth, not by first occurrence', () => {
    const html = page('<p>Before</p><article class="inner">Nested</article><p>After</p>')
    const extracted = extractRenderedBody(html)
    expect(extracted).toContain('After')
    expect(extracted).toContain('Nested')
  })

  it('preserves tables, which the regex fallback cannot render at all', () => {
    const table = '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
    expect(extractRenderedBody(page(table))).toContain('<table>')
  })

  it('returns undefined when the page is not a Hexo article', () => {
    expect(extractRenderedBody('<html><body><p>No container</p></body></html>')).toBeUndefined()
  })

  it('returns undefined when the container is left unclosed', () => {
    const broken = '<article class="post-content" id="article-container"><p>Body</p>'
    expect(extractRenderedBody(broken)).toBeUndefined()
  })

  it('returns undefined for an empty container so callers fall back', () => {
    expect(extractRenderedBody(page('   '))).toBeUndefined()
  })
})
