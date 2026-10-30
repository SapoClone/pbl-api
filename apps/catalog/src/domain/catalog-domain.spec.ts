import {
  CatalogDomainError,
  CatalogErrorCode,
  buildCombinationSignature,
  generateCartesianVariantSpecs,
  isValidEan13,
  normalizeName,
  normalizeSku,
  normalizeSlug,
  parseAndFormatConversionFactor,
  parseAndFormatMoney,
  resolveVariantPrice,
  validateAndNormalizeBarcode,
  validateCategoryReparent,
  validateProductLifecycleTransition,
  validateVariantWithProductLifecycle,
  verifyGs1Checksum,
} from './catalog-domain';

describe('Catalog Domain Invariants (M1)', () => {
  describe('normalizeName & normalizeSlug', () => {
    it('normalizes whitespace and case for names', () => {
      expect(normalizeName('  Áo   Thun   Cotton  ')).toBe('áo thun cotton');
    });

    it('generates URL-safe ASCII slugs from Vietnamese text', () => {
      expect(normalizeSlug('Thời Trang Nam & Nữ (Đông 2026)')).toBe(
        'thoi-trang-nam-nu-dong-2026',
      );
    });
  });

  describe('normalizeSku', () => {
    it('trims, uppercases, and validates SKU codes', () => {
      expect(normalizeSku('  tshirt-blk-m_01.a/b  ')).toBe(
        'TSHIRT-BLK-M_01.A/B',
      );
    });

    it('rejects empty or invalid SKU characters', () => {
      expect(() => normalizeSku('   ')).toThrow(CatalogDomainError);
      expect(() => normalizeSku('SKU WITH SPACES')).toThrow(
        expect.objectContaining({ code: CatalogErrorCode.INVALID_SKU }),
      );
    });
  });

  describe('GS1 / EAN-13 & Barcode Validation', () => {
    it('verifies valid EAN-13 and GTIN-8/12/14 checksums', () => {
      // Valid EAN-13: 893456312345 + check digit
      // Let's compute: 8*1 + 9*3 + 3*1 + 4*3 + 5*1 + 6*3 + 3*1 + 1*3 + 2*1 + 3*3 + 4*1 + 5*3 = 8+27+3+12+5+18+3+3+2+9+4+15 = 109 -> check digit = 1
      expect(verifyGs1Checksum('8934563123451')).toBe(true);
      expect(isValidEan13('8934563123451')).toBe(true);
      expect(verifyGs1Checksum('8934563123452')).toBe(false);
      expect(isValidEan13('8934563123452')).toBe(false);
    });

    it('accepts valid EAN-13 and alphanumeric barcodes, rejects bad EAN-13 checksums', () => {
      expect(validateAndNormalizeBarcode(' 8934563123451 ')).toBe(
        '8934563123451',
      );
      expect(validateAndNormalizeBarcode('CODE128-BLK-M')).toBe(
        'CODE128-BLK-M',
      );
      expect(validateAndNormalizeBarcode(null)).toBeNull();
      expect(validateAndNormalizeBarcode('   ')).toBeNull();

      expect(() => validateAndNormalizeBarcode('8934563123459')).toThrow(
        expect.objectContaining({ code: CatalogErrorCode.INVALID_BARCODE }),
      );
    });
  });

  describe('Variant Attribute Combination Signature', () => {
    it('builds canonical sorted combination signatures regardless of input order', () => {
      const attrA = '11111111-1111-4111-8111-111111111111';
      const attrB = '22222222-2222-4222-8222-222222222222';
      const val1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const val2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

      const sig1 = buildCombinationSignature([
        { attributeId: attrB, attributeValueId: val2 },
        { attributeId: attrA, attributeValueId: val1 },
      ]);
      const sig2 = buildCombinationSignature([
        { attributeId: attrA, attributeValueId: val1 },
        { attributeId: attrB, attributeValueId: val2 },
      ]);

      expect(sig1).toBe(`${attrA}:${val1}|${attrB}:${val2}`);
      expect(sig1).toBe(sig2);
    });

    it('rejects multiple values for the same attribute on a single variant (e.g. Color=Black and Color=White)', () => {
      const colorAttr = '11111111-1111-4111-8111-111111111111';
      expect(() =>
        buildCombinationSignature([
          {
            attributeId: colorAttr,
            attributeValueId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
          {
            attributeId: colorAttr,
            attributeValueId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          },
        ]),
      ).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.INVALID_VARIANT_COMBINATION,
        }),
      );
    });
  });

  describe('Cartesian Variant Generation', () => {
    const colorId = '11111111-1111-4111-8111-111111111111';
    const sizeId = '22222222-2222-4222-8222-222222222222';

    it('generates exact Cartesian combinations with normalized SKUs and signatures', () => {
      const specs = generateCartesianVariantSpecs(
        'TSHIRT',
        'Áo thun cotton nam',
        [
          {
            attributeId: colorId,
            attributeName: 'Color',
            values: [
              { id: 'c-blk', value: 'Black', skuToken: 'BLK' },
              { id: 'c-wht', value: 'White', skuToken: 'WHT' },
            ],
          },
          {
            attributeId: sizeId,
            attributeName: 'Size',
            values: [
              { id: 's-m', value: 'M' },
              { id: 's-l', value: 'L' },
            ],
          },
        ],
      );

      expect(specs).toHaveLength(4);
      expect(specs.map((s) => s.skuCode)).toEqual([
        'TSHIRT-BLK-M',
        'TSHIRT-BLK-L',
        'TSHIRT-WHT-M',
        'TSHIRT-WHT-L',
      ]);
      expect(new Set(specs.map((s) => s.combinationSignature)).size).toBe(4);
    });

    it('enforces upper bound on Cartesian combinations', () => {
      const manyValues = Array.from({ length: 12 }, (_, idx) => ({
        id: `v-${idx}`,
        value: `Val ${idx}`,
      }));

      expect(() =>
        generateCartesianVariantSpecs(
          'TSHIRT',
          'Product',
          [
            {
              attributeId: colorId,
              attributeName: 'Color',
              values: manyValues,
            },
            { attributeId: sizeId, attributeName: 'Size', values: manyValues },
          ],
          100,
        ),
      ).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.VARIANT_GENERATION_LIMIT_EXCEEDED,
        }),
      );
    });
  });

  describe('Category Hierarchy & Reparent Validation', () => {
    it('rejects self-parenting and cyclic reparenting into a descendant', () => {
      expect(() =>
        validateCategoryReparent({
          categoryId: 'cat-1',
          newParentId: 'cat-1',
          newParentDepth: 1,
          descendantRelativeDepths: [{ id: 'cat-1', relativeDepth: 0 }],
        }),
      ).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.CATEGORY_CYCLE_DETECTED,
        }),
      );

      expect(() =>
        validateCategoryReparent({
          categoryId: 'cat-1',
          newParentId: 'cat-child',
          newParentDepth: 2,
          descendantRelativeDepths: [
            { id: 'cat-1', relativeDepth: 0 },
            { id: 'cat-child', relativeDepth: 1 },
          ],
        }),
      ).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.CATEGORY_CYCLE_DETECTED,
        }),
      );
    });

    it('rejects reparenting when subtree would exceed max depth of 3', () => {
      // Moving a category that has a child (relativeDepth=1) under a depth-2 parent -> max depth 2 + 1 + 1 = 4 > 3
      expect(() =>
        validateCategoryReparent({
          categoryId: 'cat-1',
          newParentId: 'parent-depth-2',
          newParentDepth: 2,
          descendantRelativeDepths: [
            { id: 'cat-1', relativeDepth: 0 },
            { id: 'cat-child', relativeDepth: 1 },
          ],
        }),
      ).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.CATEGORY_DEPTH_EXCEEDED,
        }),
      );
    });

    it('allows valid reparenting within depth 3', () => {
      const res = validateCategoryReparent({
        categoryId: 'cat-1',
        newParentId: 'parent-depth-1',
        newParentDepth: 1,
        descendantRelativeDepths: [
          { id: 'cat-1', relativeDepth: 0 },
          { id: 'cat-child', relativeDepth: 1 },
        ],
      });
      expect(res).toEqual({ newCategoryDepth: 2, maxResultingDepth: 3 });
    });
  });

  describe('Money & Unit Conversion Precision', () => {
    it('formats decimal money without binary float drift and rejects negative or >2 decimal places', () => {
      expect(parseAndFormatMoney('199000')).toBe('199000.00');
      expect(parseAndFormatMoney('00199000.5')).toBe('199000.50');
      expect(parseAndFormatMoney(0)).toBe('0.00');

      expect(() => parseAndFormatMoney('-10.00')).toThrow(
        expect.objectContaining({ code: CatalogErrorCode.INVALID_PRICE }),
      );
      expect(() => parseAndFormatMoney('19.999')).toThrow(
        expect.objectContaining({ code: CatalogErrorCode.INVALID_PRICE }),
      );
    });

    it('validates positive unit conversion factors and base unit = 1.0000', () => {
      expect(parseAndFormatConversionFactor('24')).toBe('24.0000');
      expect(parseAndFormatConversionFactor('1', true)).toBe('1.0000');

      expect(() => parseAndFormatConversionFactor('0')).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.INVALID_UNIT_CONVERSION,
        }),
      );
      expect(() => parseAndFormatConversionFactor('12', true)).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.INVALID_UNIT_CONVERSION,
        }),
      );
    });
  });

  describe('Product Lifecycle & Deterministic Price Resolution', () => {
    it('prevents transitioning ARCHIVED products or reverting to DRAFT', () => {
      expect(() =>
        validateProductLifecycleTransition('ARCHIVED', 'ACTIVE'),
      ).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
        }),
      );
      expect(() =>
        validateProductLifecycleTransition('ACTIVE', 'DRAFT'),
      ).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
        }),
      );
      expect(() =>
        validateVariantWithProductLifecycle('ARCHIVED', 'ACTIVE'),
      ).toThrow(
        expect.objectContaining({
          code: CatalogErrorCode.INVALID_PRODUCT_LIFECYCLE,
        }),
      );
    });

    it('resolves selected price list -> default price list -> variant base price deterministically', () => {
      // 1. Selected price list
      const fromSelected = resolveVariantPrice({
        variantId: 'var-1',
        skuCode: 'TSHIRT-BLK-M',
        variantStatus: 'ACTIVE',
        basePrice: '199000.00',
        asOfDate: '2026-10-29',
        selectedList: {
          id: 'pl-vip',
          name: 'VIP',
          currency: 'VND',
          isDefault: false,
          status: 'ACTIVE',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          itemPrice: '169000.00',
        },
      });
      expect(fromSelected.source).toBe('PRICE_LIST');
      expect(fromSelected.amount).toBe('169000.00');

      // 2. Default price list fallback
      const fromDefault = resolveVariantPrice({
        variantId: 'var-1',
        skuCode: 'TSHIRT-BLK-M',
        variantStatus: 'ACTIVE',
        basePrice: '199000.00',
        asOfDate: '2026-10-29',
        defaultList: {
          id: 'pl-def',
          name: 'Default Retail',
          currency: 'VND',
          isDefault: true,
          status: 'ACTIVE',
          startDate: null,
          endDate: null,
          itemPrice: '179000.00',
        },
      });
      expect(fromDefault.source).toBe('DEFAULT_PRICE_LIST');
      expect(fromDefault.amount).toBe('179000.00');

      // 3. Variant base price fallback when default list has no item
      const fromBase = resolveVariantPrice({
        variantId: 'var-1',
        skuCode: 'TSHIRT-BLK-M',
        variantStatus: 'ACTIVE',
        basePrice: '199000.00',
        asOfDate: '2026-10-29',
        defaultList: null,
      });
      expect(fromBase.source).toBe('VARIANT_BASE_PRICE');
      expect(fromBase.amount).toBe('199000.00');
    });
  });
});
