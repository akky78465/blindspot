export function mask(text: string): string {
  const dates: string[] = [];
  // Phone masking also matches YYYY-MM-DD. Park those dates so a fixed date still reaches the judge.
  const parked = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, date => {
    dates.push(date);
    return `DATEHOLDER${dates.length - 1}X`;
  });
  const masked = parked.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[MASKED_EMAIL]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[MASKED_CARD]')
    .replace(/(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g, '[MASKED_PHONE]');
  return masked.replace(/DATEHOLDER(\d+)X/g, (_, index) => dates[Number(index)]);
}
