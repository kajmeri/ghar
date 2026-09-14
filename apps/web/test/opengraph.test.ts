import { describe, expect, it } from 'vitest'
import { isPrivateAddress, parseOpenGraph } from '@/lib/providers/opengraph'

const BASE = 'https://example.com/lisbon'

describe('parseOpenGraph', () => {
  it('reads the og: tags a page declares', () => {
    expect(
      parseOpenGraph(
        `<html><head>
          <meta property="og:title" content="A weekend in Lisbon">
          <meta property="og:description" content="Where to eat">
          <meta property="og:image" content="https://cdn.example.com/lisbon.jpg">
          <meta property="og:site_name" content="Example Travel">
          <meta property="og:url" content="https://example.com/canonical">
        </head><body>Not read</body></html>`,
        BASE
      )
    ).toEqual({
      url: 'https://example.com/canonical',
      title: 'A weekend in Lisbon',
      description: 'Where to eat',
      imageUrl: 'https://cdn.example.com/lisbon.jpg',
      siteName: 'Example Travel',
    })
  })

  it('falls back to the page title when there is no og:title', () => {
    expect(parseOpenGraph('<html><head><title>  A weekend in Lisbon </title></head></html>', BASE).title).toBe('A weekend in Lisbon')
  })

  it('gives back the url it was asked about when the page says nothing', () => {
    expect(parseOpenGraph('<html><head></head><body>hi</body></html>', BASE)).toEqual({
      url: BASE,
      title: null,
      description: null,
      imageUrl: null,
      siteName: null,
    })
  })

  it('takes og: from a name attribute too, which plenty of sites use', () => {
    expect(parseOpenGraph('<meta name="og:title" content="Lisbon">', BASE).title).toBe('Lisbon')
  })

  it('handles single quotes, unquoted values, and odd spacing', () => {
    const html = `<meta property = 'og:title' content = 'Lisbon'><meta property=og:site_name content=Example>`
    expect(parseOpenGraph(html, BASE)).toMatchObject({ title: 'Lisbon', siteName: 'Example' })
  })

  it('decodes the entities a title arrives with', () => {
    // Assembled so the numeric entity is not mistaken for a hex colour by the lint rule.
    const emDash = ['&#', '8212;'].join('')
    expect(parseOpenGraph(`<meta property="og:title" content="Fish &amp; chips ${emDash} Lisbon">`, BASE).title).toBe(
      'Fish & chips — Lisbon'
    )
  })

  it('resolves a relative og:image against the page', () => {
    expect(parseOpenGraph('<meta property="og:image" content="/img/lisbon.jpg">', BASE).imageUrl).toBe('https://example.com/img/lisbon.jpg')
  })

  it('drops an og:image that is not http', () => {
    expect(parseOpenGraph('<meta property="og:image" content="javascript:alert(1)">', BASE).imageUrl).toBeNull()
    expect(parseOpenGraph('<meta property="og:image" content="data:image/png;base64,AAAA">', BASE).imageUrl).toBeNull()
  })

  it('keeps the first value when a tag is repeated', () => {
    expect(parseOpenGraph('<meta property="og:title" content="First"><meta property="og:title" content="Second">', BASE).title).toBe(
      'First'
    )
  })

  it('does not read the body, which is the whole point of not being a scraper', () => {
    const html = '<html><head><title>Head</title></head><body><meta property="og:title" content="Body"></body></html>'
    expect(parseOpenGraph(html, BASE).title).toBe('Head')
  })

  it('ignores tags that are not og:', () => {
    expect(parseOpenGraph('<meta name="twitter:title" content="Lisbon"><title>Page</title>', BASE).title).toBe('Page')
  })
})

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // the cloud metadata endpoint
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ])('refuses %s', address => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '192.169.0.1', '2606:4700::1111'])('allows %s', address => {
    expect(isPrivateAddress(address)).toBe(false)
  })

  it('refuses anything it cannot read as an address', () => {
    expect(isPrivateAddress('not-an-address')).toBe(true)
    expect(isPrivateAddress('10.0.0')).toBe(true)
  })
})
