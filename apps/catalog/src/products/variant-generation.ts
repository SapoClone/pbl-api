import { VariantAttribute } from '../entities/catalog.entities';

export interface AxisValue {
  id: string;
  value: string;
  code: string;
}

export interface Axis {
  attributeName: string;
  values: AxisValue[];
}

export interface GeneratedVariant {
  skuCode: string;
  attributes: VariantAttribute[];
}

/** Variants one product may have (contract C004) */
export const MAX_VARIANTS = 100;

/**
 * Every combination of the axes, in the order the axes and values were given:
 * 3 colours x 2 sizes = 6 variants, each `<baseSku>-<code>-<code>`. The count is
 * checked before anything is built, so a huge input costs nothing.
 */
export function generateVariants(
  baseSku: string,
  axes: Axis[],
): GeneratedVariant[] {
  const total = axes.reduce((count, axis) => count * axis.values.length, 1);
  if (total > MAX_VARIANTS) {
    throw new TooManyVariantsError(total);
  }
  let combos: AxisValue[][] = [[]];
  const names: string[] = [];
  for (const axis of axes) {
    names.push(axis.attributeName);
    combos = combos.flatMap((combo) =>
      axis.values.map((value) => [...combo, value]),
    );
  }
  return combos.map((combo) => ({
    skuCode: combo.length
      ? `${baseSku}-${combo.map((value) => value.code).join('-')}`
      : baseSku,
    attributes: combo.map((value, index) => ({
      name: names[index],
      value: value.value,
    })),
  }));
}

export class TooManyVariantsError extends Error {
  constructor(readonly count: number) {
    super(`${count} variants exceed the limit of ${MAX_VARIANTS}`);
    this.name = 'TooManyVariantsError';
  }
}

/** Order-independent key of a combination: `Màu=Xanh|Size=M` */
export const combinationKey = (attributes: VariantAttribute[]): string =>
  attributes
    .map(
      (a) => `${a.name.trim().toLowerCase()}=${a.value.trim().toLowerCase()}`,
    )
    .sort()
    .join('|');

/** `500ml / Xanh sage`, or null for a variant without attributes */
export const variantLabel = (attributes: VariantAttribute[]): string | null =>
  attributes.length ? attributes.map((a) => a.value).join(' / ') : null;
