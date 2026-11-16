/**
 * PII Scrubbing helpers (browser + edge safe).
 * Strips phone numbers (Arabic-Indic, Extended Arabic-Indic, Latin),
 * email addresses, and detailed Arabic street/apartment phrases before persistence.
 */

const ARABIC_INDIC_MAP: Record<string, string> = {
  '\u0660': '0',
  '\u0661': '1',
  '\u0662': '2',
  '\u0663': '3',
  '\u0664': '4',
  '\u0665': '5',
  '\u0666': '6',
  '\u0667': '7',
  '\u0668': '8',
  '\u0669': '9',
  '\u06F0': '0',
  '\u06F1': '1',
  '\u06F2': '2',
  '\u06F3': '3',
  '\u06F4': '4',
  '\u06F5': '5',
  '\u06F6': '6',
  '\u06F7': '7',
  '\u06F8': '8',
  '\u06F9': '9',
};

export function normalizeDigits(input: string): string {
  return input.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => ARABIC_INDIC_MAP[d] ?? d);
}

const PHONE_CHAR_REGEX =
  /(?:\+?\s*[\d\u0660-\u0669\u06F0-\u06F9][\d\u0660-\u0669\u06F0-\u06F9\s\-().]{6,18}[\d\u0660-\u0669\u06F0-\u06F9])/g;

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const ARABIC_ADDRESS_REGEX =
  /(?:^|[\s،,:])((?:شارع|ش\.|حارة|ميدان|عمارة|برج|بناية|عقار|دور|الدور|شقة|طابق|بجوار|أمام|تقاطع|ناصية)\s+[^\n،.؛]{2,65})/g;

export function sanitizePiiText(text: string): string {
  if (!text) return '';

  let cleaned = text.replace(EMAIL_REGEX, '[بريد محذوف]');

  cleaned = cleaned.replace(PHONE_CHAR_REGEX, (match) => {
    const normalized = normalizeDigits(match).replace(/[^\d]/g, '');
    // Egyptian & international phone numbers (>= 8 digits)
    if (normalized.length >= 8 && normalized.length <= 15) {
      return ' [هاتف محذوف] ';
    }
    return match;
  });

  cleaned = cleaned.replace(ARABIC_ADDRESS_REGEX, (full, addrPhrase: string) => {
    return full.replace(addrPhrase, '[عنوان محذوف]');
  });

  return cleaned.replace(/\s{2,}/g, ' ').trim();
}

export function containsSensitivePii(text: string): boolean {
  if (!text) return false;
  return sanitizePiiText(text) !== text.trim();
}
