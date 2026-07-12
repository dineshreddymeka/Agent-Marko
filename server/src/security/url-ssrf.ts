/**
 * SSRF guards for outbound HTTP URLs (MCP HTTP transports, Graph nextLink, etc.).
 */

export type UrlSsrfResult = { ok: true; url: URL } | { ok: false; error: string }

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '::1' ||
    h === '0:0:0:0:0:0:0:1'
  )
}

/** True for IPv4 private / link-local / CGNAT ranges. */
export function isPrivateOrLinkLocalIpv4(hostname: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname)
  if (!m) return false
  const octets = m.slice(1).map(Number)
  if (octets.some((n) => n > 255)) return false
  const [a, b] = octets as [number, number, number, number]
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // multicast / reserved
  return false
}

function isPrivateOrLinkLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (isLoopbackHost(h)) return true
  if (isPrivateOrLinkLocalIpv4(h)) return true
  // IPv6 ULA / link-local (coarse)
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:')) return true
  if (h.endsWith('.local') || h.endsWith('.internal')) return true
  return false
}

/**
 * Validate an outbound URL for SSRF.
 * - https only by default
 * - optional loopback http when `allowLoopbackHttp` (env MCP_HTTP_ALLOW_LOOPBACK)
 * - block private / link-local hosts (unless loopback allowed and host is loopback)
 */
export function validateOutboundUrl(
  raw: string,
  opts?: {
    allowLoopbackHttp?: boolean
    /** Extra allowed hostnames (e.g. graph.microsoft.com for nextLink). */
    allowedHosts?: string[]
  },
): UrlSsrfResult {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }

  const host = url.hostname
  if (!host) return { ok: false, error: 'URL hostname required' }

  if (opts?.allowedHosts?.length) {
    const allowed = opts.allowedHosts.map((h) => h.toLowerCase())
    if (!allowed.includes(host.toLowerCase())) {
      return { ok: false, error: `Host not allowlisted: ${host}` }
    }
  }

  const loopback = isLoopbackHost(host)
  const allowLoopbackHttp =
    opts?.allowLoopbackHttp ??
    ['1', 'true', 'yes', 'on'].includes(
      (process.env.MCP_HTTP_ALLOW_LOOPBACK ?? '').trim().toLowerCase(),
    )

  if (url.protocol === 'https:') {
    if (!opts?.allowedHosts && isPrivateOrLinkLocalHost(host) && !(loopback && allowLoopbackHttp)) {
      return { ok: false, error: 'Private/link-local hosts are not allowed' }
    }
    return { ok: true, url }
  }

  if (url.protocol === 'http:') {
    if (allowLoopbackHttp && loopback) return { ok: true, url }
    return {
      ok: false,
      error: allowLoopbackHttp
        ? 'http is only allowed for loopback hosts'
        : 'Only https URLs are allowed',
    }
  }

  return { ok: false, error: `Unsupported URL scheme: ${url.protocol}` }
}

/** MCP HTTP URL validation (https + optional loopback http). */
export function validateMcpHttpUrl(raw: string): UrlSsrfResult {
  return validateOutboundUrl(raw, {
    allowLoopbackHttp: ['1', 'true', 'yes', 'on'].includes(
      (process.env.MCP_HTTP_ALLOW_LOOPBACK ?? '').trim().toLowerCase(),
    ),
  })
}
