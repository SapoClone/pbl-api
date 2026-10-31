import { maskPhone } from './suppliers.service';

describe('maskPhone', () => {
  it.each([
    ['0281234536', '028 ••• •• 36'],
    ['028 123 4536', '028 ••• •• 36'],
    ['12345', '•••'],
    [null, null],
    ['', null],
  ])('%p -> %p', (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });
});
