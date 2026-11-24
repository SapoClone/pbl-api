# Password reset by email

`POST /auth/forgot-password` and `POST /auth/reset-password` (platform, public routes; contract in
[01-platform.md](../specs/2026-10-28-api-contracts/01-platform.md)). Code: `api/auth/password-reset.service.ts`.

## Flow

1. The web app posts `{ email }`. The answer is always 200 `{ message }`, so it never tells whether the account exists.
   An active account with a password gets a token and an email; any other email gets nothing. A failure to queue the
   mail is logged and still answers 200.
2. The token is 32 random bytes (`base64url`, 43 characters). Only its SHA-256 (hex) is stored, in Redis, with the
   account id and a 60-minute TTL (`CacheKey.PASSWORD_RESET`). A second key per account (`PASSWORD_RESET_ACCOUNT`) holds
   the hash of its live token, so a new request deletes the previous one: one live link per account.
3. The email message goes to the email queue as `{ "type": "password-reset", "email", "url" }`, where `url` is
   `${WEB_APP_URL}/reset-password?token=<token>` (`web.config.ts`, default `http://localhost:5173`).
   `pbl-mail-service` renders the `password-reset` template; a body without `type` is still an email verification.
4. The web app posts `{ token, password }`. The password follows the registration policy (`PasswordField`, 422).
   A token that is unknown, expired or already used answers 400 `E014`. On success the token is spent first, the
   argon2 hash is stored, the sign-in lock is lifted and `SessionService.revokeAll` ends every session (all
   refresh-token families revoked, access tokens denied).

## Choices

- **Redis, not a table:** the TTL is the expiry, nothing to clean up, no migration. Cost: a Redis flush drops pending
  links (users ask again).
- **`verify/forgot-password` was removed** (route and gateway entry): the reset call validates the token itself.
- **Error code `E014`**, not `A010`: `A010` already means "admin email taken" (`admin.error.email_taken`).
- The token is never logged (`token` is in `loggingRedactPaths`, the queue logs no URL).
- Not done: rate limiting (the codebase has none; the endpoint is cheap: one lookup, and mail only for real accounts),
  and the get-then-delete of the token is not atomic, so two parallel resets with the same link could both succeed
  (both belong to the holder of the link).
- Deployment: set `WEB_APP_URL` on the platform task (pbl-infra `ecs.tf`).
