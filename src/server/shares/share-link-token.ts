import { createHmac } from 'node:crypto'

const shareLinkDomain = 'calendar-share/share-link/v1'

export class ShareLinkTokenFactory {
  private readonly key: Buffer

  constructor(encodedSecret: string) {
    this.key = Buffer.from(encodedSecret, 'base64url')
    if (this.key.length !== 32) {
      throw new Error('SHARE_LINK_SECRET_INVALID')
    }
  }

  create(shareId: string, tokenVersion: number): string {
    if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 1) {
      throw new Error('SHARE_LINK_TOKEN_VERSION_INVALID')
    }

    return createHmac('sha256', this.key)
      .update(shareLinkDomain, 'utf8')
      .update('\0', 'utf8')
      .update(shareId, 'utf8')
      .update('\0', 'utf8')
      .update(String(tokenVersion), 'utf8')
      .digest('base64url')
  }
}
