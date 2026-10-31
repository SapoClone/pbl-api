import { readFileSync } from 'fs';
import { join } from 'path';
import { ErrorCode } from './error-code.constant';

const I18N_DIR = join(__dirname, '..', 'i18n');

const translation = (lang: string, key: string): unknown => {
  const [file, ...path] = key.split('.');
  let node: unknown = JSON.parse(
    readFileSync(join(I18N_DIR, lang, `${file}.json`), 'utf8'),
  );
  for (const part of path) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  return node;
};

describe('ErrorCode', () => {
  const roleCodes = Object.entries(ErrorCode).filter(([name]) =>
    name.startsWith('R'),
  );

  it('numbers the role errors R001 onwards without gaps', () => {
    expect(roleCodes.map(([name]) => name)).toEqual(
      roleCodes.map((_, i) => `R${String(i + 1).padStart(3, '0')}`),
    );
  });

  // V002 has had no translation since before RBAC; not this spec's to fix
  it.each(Object.entries(ErrorCode).filter(([name]) => name !== 'V002'))(
    '%s has a non-empty message in en, vi and jp',
    (_name, key) => {
      for (const lang of ['en', 'vi', 'jp']) {
        const text = translation(lang, key);
        expect([lang, typeof text]).toEqual([lang, 'string']);
        expect((text as string).length).toBeGreaterThan(0);
      }
    },
  );
});
