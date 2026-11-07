import { I18nTranslations } from '@/generated/i18n.generated';
import { I18nContext } from 'nestjs-i18n';

/** The text of `key` in the request's language; the key itself outside a request (unit tests, jobs) */
export function translate(
  key: string,
  args: Record<string, string | number> = {},
): string {
  const i18n = I18nContext.current<I18nTranslations>();
  return i18n ? i18n.t(key as never, { args }) : key;
}
