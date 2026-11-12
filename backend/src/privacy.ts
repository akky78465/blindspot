export function mask(text: string): string {
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[MASKED_EMAIL]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[MASKED_CARD]')
    .replace(/(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g, '[MASKED_PHONE]');
}
