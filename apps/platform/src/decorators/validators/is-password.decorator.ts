import { registerDecorator, type ValidationOptions } from 'class-validator';

/** What a password may contain: letters, digits and ! # $ % & * @ ^ (the sign-in forms validate with it). */
export const PASSWORD_PATTERN = /^[\d!#$%&*@A-Z^a-z]*$/;

export function IsPassword(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      propertyName: propertyName as string,
      name: 'isPassword',
      target: object.constructor,
      constraints: [],
      options: validationOptions,
      validator: {
        validate(value: string) {
          return PASSWORD_PATTERN.test(value);
        },
        defaultMessage() {
          return `$property is invalid`;
        },
      },
    });
  };
}
