export enum CacheKey {
  SESSION_BLACKLIST = 'auth:session-blacklist:%s', // %s: sessionId
  EMAIL_VERIFICATION = 'auth:token:%s:email-verification', // %s: userId
  PASSWORD_RESET = 'auth:password-reset:%s', // %s: SHA-256 (hex) of the token; value: accountId
  PASSWORD_RESET_ACCOUNT = 'auth:password-reset-account:%s', // %s: accountId; value: the hash of its one live token
}
