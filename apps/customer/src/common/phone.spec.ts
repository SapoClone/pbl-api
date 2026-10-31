import { maskPhone, normalizePhone } from './phone';

describe('phone helpers', () => {
  it('normalises separators', () => {
    expect(normalizePhone('090 123-4528')).toBe('0901234528');
    expect(normalizePhone('+84.901.234.528')).toBe('+84901234528');
  });

  it('masks all but the first three and last two digits', () => {
    expect(maskPhone('0901234528')).toBe('090 ••• •• 28');
    expect(maskPhone('+84901234528')).toBe('+84 ••• •• 28');
    expect(maskPhone('12345678')).toBe('12••••78');
    expect(maskPhone('123')).toBe('•••');
  });
});
