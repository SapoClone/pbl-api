/** Strips spaces, dots, dashes and brackets: the stored and compared form of a phone */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s.\-()]/g, '');
}

/** `0901234528` -> `090 ••• •• 28` (anything shorter keeps its first 2 and last 2 digits) */
export function maskPhone(phone: string): string {
  if (phone.length >= 9)
    return `${phone.slice(0, 3)} ••• •• ${phone.slice(-2)}`;
  if (phone.length > 4)
    return `${phone.slice(0, 2)}${'•'.repeat(phone.length - 4)}${phone.slice(-2)}`;
  return '•'.repeat(phone.length);
}
