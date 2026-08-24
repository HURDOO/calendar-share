import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join('; ')

export const BASE_SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
} as const

const IMMUTABLE_ASSET_PATH = /^\/assets\/[^/?]+-[A-Za-z0-9_-]{8,}\.[^/?]+$/

export function registerResponsePolicy(
  app: FastifyInstance,
  options: { readonly secureTransport: boolean },
): void {
  app.addHook('onSend', async (request, reply, payload) => {
    applySecurityHeaders(reply, options.secureTransport)

    if (!reply.hasHeader('Cache-Control')) {
      reply.header(
        'Cache-Control',
        isImmutableAsset(request, reply)
          ? 'public, max-age=31536000, immutable'
          : 'no-store',
      )
    }

    return payload
  })
}

export function applySecurityHeaders(
  reply: FastifyReply,
  secureTransport: boolean,
): void {
  reply.headers(BASE_SECURITY_HEADERS)
  if (secureTransport) {
    reply.header('Strict-Transport-Security', 'max-age=31536000')
  }
}

export function rawSecurityHeaders(
  secureTransport: boolean,
): Record<string, string> {
  return {
    ...BASE_SECURITY_HEADERS,
    ...(secureTransport
      ? { 'Strict-Transport-Security': 'max-age=31536000' }
      : {}),
  }
}

function isImmutableAsset(request: FastifyRequest, reply: FastifyReply): boolean {
  const path = request.url.split('?', 1)[0] ?? ''
  return (
    (request.method === 'GET' || request.method === 'HEAD') &&
    reply.statusCode < 400 &&
    IMMUTABLE_ASSET_PATH.test(path)
  )
}
