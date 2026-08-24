import { z } from 'zod'

import { generateSecret, hashSecret, secretsMatch } from '../../shared/secrets'
import { GoogleConnectionService } from './connection-service'
import { TokenCipher } from './token-cipher'
import type { GoogleAdapter } from './types'

const oauthTransactionPurpose = 'google-oauth-transaction'
export const OAUTH_TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000

const transactionSchema = z.object({
  codeVerifier: z.string().min(43).max(128),
  createdAt: z.number().int(),
  sessionId: z.string().uuid(),
  state: z.string().min(43).max(128),
})

export class GoogleOAuthService {
  constructor(
    private readonly adapter: GoogleAdapter,
    private readonly connection: GoogleConnectionService,
    private readonly cipher: TokenCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  begin(sessionId: string): {
    readonly authorizationUrl: string
    readonly transaction: string
  } {
    const state = generateSecret()
    const codeVerifier = generateSecret()
    const transaction = this.cipher.encrypt(
      JSON.stringify({
        codeVerifier,
        createdAt: this.now().getTime(),
        sessionId,
        state,
      }),
      oauthTransactionPurpose,
    )

    return {
      authorizationUrl: this.adapter.authorizationUrl({
        codeChallenge: hashSecret(codeVerifier),
        state,
      }),
      transaction,
    }
  }

  async complete(
    transaction: string,
    state: string,
    code: string,
    sessionId: string,
  ): Promise<void> {
    const parsed = transactionSchema.safeParse(
      JSON.parse(this.cipher.decrypt(transaction, oauthTransactionPurpose)),
    )

    if (!parsed.success) {
      throw new Error('OAUTH_TRANSACTION_INVALID')
    }

    const payload = parsed.data
    const age = this.now().getTime() - payload.createdAt
    if (
      age < 0 ||
      age > OAUTH_TRANSACTION_TIMEOUT_MS ||
      payload.sessionId !== sessionId ||
      !secretsMatch(payload.state, state)
    ) {
      throw new Error('OAUTH_TRANSACTION_REJECTED')
    }

    const tokens = await this.adapter.exchangeAuthorizationCode(
      code,
      payload.codeVerifier,
    )
    const existing = this.connection.status()
    const refreshToken =
      tokens.refreshToken ??
      (existing.connected ? this.connection.refreshToken() : undefined)
    const scopes = tokens.scopes.length > 0 ? tokens.scopes : existing.scopes

    if (!refreshToken) {
      throw new Error('OAUTH_REFRESH_TOKEN_MISSING')
    }

    this.connection.connect(refreshToken, scopes)
    this.adapter.setRefreshToken(refreshToken)
  }
}
