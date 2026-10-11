import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BooleanFieldOptional,
  ClassFieldOptional,
  DateFieldOptional,
  EmailFieldOptional,
  EnumFieldOptional,
  NumberFieldOptional,
  PasswordFieldOptional,
  StringFieldOptional,
  URLFieldOptional,
  UUIDFieldOptional,
} from './field.decorators';

enum Color {
  Red = 'red',
}

class Nested {
  @StringFieldOptional()
  name?: string;
}

const cases: Array<[string, (nullable: boolean) => new () => object, unknown]> =
  [
    [
      'NumberFieldOptional',
      (nullable) => {
        class Dto {
          @NumberFieldOptional({ nullable })
          value?: number | null;
        }
        return Dto;
      },
      1,
    ],
    [
      'PasswordFieldOptional',
      (nullable) => {
        class Dto {
          @PasswordFieldOptional({ nullable })
          value?: string | null;
        }
        return Dto;
      },
      'Passw0rd!x',
    ],
    [
      'UUIDFieldOptional',
      (nullable) => {
        class Dto {
          @UUIDFieldOptional({ nullable })
          value?: string | null;
        }
        return Dto;
      },
      '6f1c1f0e-8f0c-4b0e-9a57-0c6f1f6f3a11',
    ],
    [
      'EmailFieldOptional',
      (nullable) => {
        class Dto {
          @EmailFieldOptional({ nullable })
          value?: string | null;
        }
        return Dto;
      },
      'a@example.com',
    ],
    [
      'URLFieldOptional',
      (nullable) => {
        class Dto {
          @URLFieldOptional({ nullable })
          value?: string | null;
        }
        return Dto;
      },
      'https://example.com',
    ],
    [
      'DateFieldOptional',
      (nullable) => {
        class Dto {
          @DateFieldOptional({ nullable })
          value?: Date | null;
        }
        return Dto;
      },
      '2026-01-01T00:00:00.000Z',
    ],
    [
      'ClassFieldOptional',
      (nullable) => {
        class Dto {
          @ClassFieldOptional(() => Nested, { nullable })
          value?: Nested | null;
        }
        return Dto;
      },
      { name: 'x' },
    ],
    [
      'StringFieldOptional',
      (nullable) => {
        class Dto {
          @StringFieldOptional({ nullable })
          value?: string | null;
        }
        return Dto;
      },
      'x',
    ],
    [
      'BooleanFieldOptional',
      (nullable) => {
        class Dto {
          @BooleanFieldOptional({ nullable })
          value?: boolean | null;
        }
        return Dto;
      },
      true,
    ],
    [
      'EnumFieldOptional',
      (nullable) => {
        class Dto {
          @EnumFieldOptional(() => Color, { nullable })
          value?: Color | null;
        }
        return Dto;
      },
      'red',
    ],
  ];

describe.each(cases)('%s', (_name, build, valid) => {
  const errorsFor = (cls: new () => object, plain: object) =>
    validate(plainToInstance(cls, plain));

  it('accepts undefined', async () => {
    expect(await errorsFor(build(false), {})).toHaveLength(0);
  });

  it('accepts a valid value', async () => {
    expect(await errorsFor(build(false), { value: valid })).toHaveLength(0);
  });

  it('rejects null', async () => {
    expect(
      (await errorsFor(build(false), { value: null })).length,
    ).toBeGreaterThan(0);
  });

  it('accepts null when nullable', async () => {
    expect(await errorsFor(build(true), { value: null })).toHaveLength(0);
  });
});
