import { csvCell } from './products.service';
import {
  MAX_VARIANTS,
  TooManyVariantsError,
  combinationKey,
  generateVariants,
  variantLabel,
} from './variant-generation';

const axis = (attributeName: string, ...codes: string[]) => ({
  attributeName,
  values: codes.map((code) => ({
    id: `id-${code}`,
    value: `v${code}`,
    code,
  })),
});

describe('generateVariants', () => {
  it('makes every combination: 3 colours x 2 sizes = 6', () => {
    const out = generateVariants('MC', [
      axis('Màu', 'X', 'T', 'D'),
      axis('Size', '3', '5'),
    ]);
    expect(out.map((v) => v.skuCode)).toEqual([
      'MC-X-3',
      'MC-X-5',
      'MC-T-3',
      'MC-T-5',
      'MC-D-3',
      'MC-D-5',
    ]);
    expect(out[0].attributes).toEqual([
      { name: 'Màu', value: 'vX' },
      { name: 'Size', value: 'v3' },
    ]);
  });

  it('gives the base SKU alone when there are no axes', () => {
    expect(generateVariants('MC', [])).toEqual([
      { skuCode: 'MC', attributes: [] },
    ]);
  });

  it('refuses more than 100 variants before building them', () => {
    const many = Array.from({ length: 11 }, (_, i) => String(i));
    expect(() =>
      generateVariants('MC', [axis('A', ...many), axis('B', ...many)]),
    ).toThrow(TooManyVariantsError);
    expect(MAX_VARIANTS).toBe(100);
  });
});

describe('combinationKey and variantLabel', () => {
  it('ignores order and case', () => {
    expect(
      combinationKey([
        { name: 'A', value: 'x' },
        { name: 'B', value: 'Y' },
      ]),
    ).toBe(
      combinationKey([
        { name: 'b', value: 'y' },
        { name: 'a', value: 'X' },
      ]),
    );
  });

  it('labels with the values, null without attributes', () => {
    expect(
      variantLabel([
        { name: 'A', value: '500ml' },
        { name: 'B', value: 'Xanh' },
      ]),
    ).toBe('500ml / Xanh');
    expect(variantLabel([])).toBeNull();
  });
});

describe('csvCell', () => {
  it('quotes, escapes and defuses formulas', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(290000)).toBe('290000');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });
});
