/** Keys are built by the service from uuids; anything else is refused. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_./-]*$/;

export function assertSafeKey(key: string): void {
  if (
    !SAFE_KEY.test(key) ||
    key.split('/').some((p) => p === '..' || p === '')
  ) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}
