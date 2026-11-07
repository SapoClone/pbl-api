/**
 * Defaults of the sign-in lockout (Figma security policy: 5 consecutive failed password logins lock the account for 15
 * minutes). The numbers in force come from the platform settings `security.lockoutMaxAttempts` and
 * `security.lockoutWindowMinutes` (`PlatformSettingReader`, never below 3 attempts); these are what they fall back to.
 */
export const MAX_FAILED_LOGINS = 5;
export const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;
