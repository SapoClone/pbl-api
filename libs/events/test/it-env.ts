/**
 * Shared set-up of the integration tests (run with `pnpm test:int`, see
 * docs/guides/events.md): they need Postgres and ElasticMQ, and every test file
 * works in a throwaway schema it drops at the end.
 */
export const IT_DB = {
  host: process.env.EVENTS_IT_DB_HOST ?? 'localhost',
  port: String(process.env.EVENTS_IT_DB_PORT ?? 25432),
};

/** Points the `DATABASE_*` variables at the test database and a schema */
export function useDatabase(schema: string): void {
  process.env.DATABASE_HOST = IT_DB.host;
  process.env.DATABASE_PORT = IT_DB.port;
  process.env.DATABASE_USERNAME = 'postgres';
  process.env.DATABASE_PASSWORD = 'postgres';
  process.env.DATABASE_NAME = 'pbl';
  process.env.DATABASE_SCHEMA = schema;
  process.env.DATABASE_SSL_ENABLED = 'false';
}

export const uniqueSchema = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Today's date in the store time zone (Asia/Ho_Chi_Minh, UTC+7) as YYYY-MM-DD: the day that sales filters and insight
 * reports bucket by. `new Date().toISOString().slice(0, 10)` is the UTC date, which is yesterday's between 00:00 and
 * 07:00 in Vietnam, so a test built on it fails during those hours.
 */
export const storeToday = (): string =>
  new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
