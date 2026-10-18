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
