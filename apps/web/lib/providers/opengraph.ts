import 'server-only';
import type { LinkPreview } from '@ghar/contracts';
import { ValidationError } from '@ghar/core/errors';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Reads the OpenGraph tags on a page, and nothing else.
 *
 * This is deliberately not a scraper. It reads `<meta property="og:*">` and the `<title>`
 * as a fallback, stops at the end of `<head>`, and never follows the page's own links,
 * reads its body text, or runs its scripts. A link somebody pasted is a link, not a site
 * to crawl.
 *
 * Everything below is a limit on what the fetch can do to us: a timeout, a byte cap, a
 * redirect cap, and a check that the host does not resolve to a private address, because
 * the URL comes from a person and the request goes out from our server.
 */

export interface OpenGraphProvider {
  fetchPreview(url: string): Promise<LinkPreview>;
}

/** Enough for a <head>. A page that has not declared itself by here is not going to. */
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

const USER_AGENT = 'Ghar/1.0 (household app; reads OpenGraph tags only)';

function realProvider(): OpenGraphProvider {
  return {
    async fetchPreview(url) {
      let current = url;
      for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        await assertPublicHost(current);
        const response = await fetchHead(current);

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) break;
          current = new URL(location, current).toString();
          continue;
        }
        if (!response.ok) {
          throw new ValidationError(`That link came back with a ${response.status}`);
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('html')) {
          // An image or a PDF has no tags to read, but the link is still an idea.
          return emptyPreview(current);
        }
        return parseOpenGraph(await readCapped(response), current);
      }
      throw new ValidationError('That link redirects too many times');
    },
  };
}

async function fetchHead(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'text/html', 'user-agent': USER_AGENT },
    });
  } catch (cause) {
    throw new ValidationError('That link could not be reached', { cause });
  } finally {
    clearTimeout(timeout);
  }
}

/** Stops reading at the byte cap rather than buffering whatever the server decides to send. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const chunks: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      chunks.push(decoder.decode(value, { stream: true }));
      const text = chunks.join('');
      // The tags we want live in <head>; there is no reason to read past it.
      if (total >= MAX_BYTES || text.includes('</head>')) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return chunks.join('');
}

const META_TAG = /<meta\b[^>]*>/gi;
const ATTRIBUTE = /([a-z][a-z0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i;

/** og:* first, then the page's own title. Nothing else is read. */
export function parseOpenGraph(html: string, url: string): LinkPreview {
  const head = html.split(/<\/head>/i)[0] ?? html;
  const tags = new Map<string, string>();

  for (const [tag] of head.matchAll(META_TAG)) {
    const attributes = new Map<string, string>();
    for (const [, name, quoted, single, bare] of tag.matchAll(ATTRIBUTE)) {
      if (name === undefined) continue;
      attributes.set(name.toLowerCase(), quoted ?? single ?? bare ?? '');
    }
    const key = attributes.get('property') ?? attributes.get('name');
    const content = attributes.get('content');
    if (key && content && key.startsWith('og:') && !tags.has(key)) {
      tags.set(key, decodeEntities(content).trim());
    }
  }

  const pageTitle = TITLE_TAG.exec(head)?.[1];
  const image = tags.get('og:image');

  return {
    url: tags.get('og:url') ?? url,
    title: tags.get('og:title') ?? (pageTitle ? decodeEntities(pageTitle).trim() : null) ?? null,
    description: tags.get('og:description') ?? null,
    // A relative og:image is legal and common. Anything that is not http(s) is dropped.
    imageUrl: image ? absoluteHttpUrl(image, url) : null,
    siteName: tags.get('og:site_name') ?? null,
  };
}

function absoluteHttpUrl(value: string, base: string): string | null {
  const resolved = URL.parse(value, base);
  if (!resolved) return null;
  return resolved.protocol === 'http:' || resolved.protocol === 'https:'
    ? resolved.toString()
    : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#\d+|[a-z]+);/gi, (match, name: string) => {
    const known = ENTITIES[name.toLowerCase()];
    if (known !== undefined) return known;
    if (name.startsWith('#')) {
      const code = Number(name.slice(1));
      return Number.isInteger(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return match;
  });
}

function emptyPreview(url: string): LinkPreview {
  return { url, title: null, description: null, imageUrl: null, siteName: null };
}

/**
 * The URL comes from a person, and the request leaves our server, so a link to
 * 169.254.169.254 or to something on the private network would be ours to make. The host
 * is resolved and checked before each hop, redirects included.
 */
async function assertPublicHost(url: string): Promise<void> {
  const parsed = URL.parse(url);
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new ValidationError('Links must start with http:// or https://');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [hostname]
    : await lookup(hostname, { all: true })
        .then((results) => results.map((result) => result.address))
        .catch(() => {
          throw new ValidationError('That link could not be reached');
        });

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new ValidationError('That link points somewhere we cannot read');
  }
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)) return true;
    // ::ffff:a.b.c.d maps an IPv4 address into v6 and has to be judged as that address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)?.[1];
    return mapped ? isPrivateAddress(mapped) : false;
  }

  const octets = address.split('.').map(Number);
  const [a = -1, b = -1] = octets;
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;

  return (
    a === 0 || // this network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, and the cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && b >= 18 && b <= 19) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** For tests and for local development: no network, one predictable answer. */
export function createFakeOpenGraphProvider(
  previews: Readonly<Record<string, LinkPreview>> = {},
): OpenGraphProvider {
  return {
    fetchPreview: (url) => Promise.resolve(previews[url] ?? emptyPreview(url)),
  };
}

let provider: OpenGraphProvider | undefined;

export function getOpenGraphProvider(): OpenGraphProvider {
  provider ??= realProvider();
  return provider;
}
