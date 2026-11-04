import type { Hit } from '../contracts.ts';
import { TEST_PANS } from '../rules/placeholders.ts';

export function cardHits(
  path: string,
  sampleId: string,
  text: string,
  mode: 'whole' | 'embedded',
  limit: number
): Hit[] {
  if (mode === 'whole') {
    const hit = parseCard(text);
    if (!hit) return [];
    return [make(path, sampleId, 0, text.length, hit)];
  }
  const hits: Hit[] = [];
  const pattern = /\b(?:\d[ -]?){13,19}\b/g;
  let match: RegExpExecArray | null;
  while (hits.length < limit && (match = pattern.exec(text))) {
    const hit = parseCard(match[0]);
    if (hit) hits.push(make(path, sampleId, match.index, match.index + match[0].length, hit));
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
  return hits;
}

export function parseCard(value: string): { digits: string; synthetic: boolean } | null {
  const trimmed = value.trim();
  if (!/^[\d\s-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return null;
  if (/^(\d)\1+$/.test(digits)) return null;
  if (!issuedRange(digits)) return null;
  if (!luhn(digits)) return null;
  return { digits, synthetic: TEST_PANS.has(digits) };
}

/** [first, last] prefix range of one length, and the card lengths issued in it. */
const ISSUER_RANGES: Array<[number, number, readonly number[]]> = [
  [4, 4, [13, 16, 19]], // Visa
  [51, 55, [16]], // Mastercard
  [2221, 2720, [16]], // Mastercard
  [34, 34, [15]], // American Express
  [37, 37, [15]],
  [300, 305, [14, 15, 16, 17, 18, 19]], // Diners Club
  [36, 36, [14, 15, 16, 17, 18, 19]],
  [38, 39, [14, 15, 16, 17, 18, 19]],
  [3528, 3589, [16, 17, 18, 19]], // JCB
  [6011, 6011, [16, 17, 18, 19]], // Discover
  [644, 649, [16, 17, 18, 19]],
  [65, 65, [16, 17, 18, 19]],
  [62, 62, [16, 17, 18, 19]], // UnionPay
  [50, 50, [12, 13, 14, 15, 16, 17, 18, 19]], // Maestro
  [56, 69, [12, 13, 14, 15, 16, 17, 18, 19]],
  [2200, 2204, [16, 17, 18, 19]], // Mir
  [60, 60, [16]], // RuPay
  [81, 82, [16]],
  [1, 1, [15]] // UATP
];

/** True when a network issues cards with this prefix and length; Luhn alone passes one id in ten. */
export function issuedRange(digits: string): boolean {
  return ISSUER_RANGES.some(([first, last, lengths]) => {
    if (!lengths.includes(digits.length)) return false;
    const prefix = Number(digits.slice(0, String(first).length));
    return prefix >= first && prefix <= last;
  });
}

export function luhn(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function make(path: string, sampleId: string, start: number, end: number, hit: { digits: string; synthetic: boolean }): Hit {
  return {
    path,
    sampleId,
    type: 'PAYMENT_CARD',
    detectorId: 'payment-card.v1',
    validation: 'moderate',
    context: 'none',
    start,
    end,
    normalised: hit.digits,
    synthetic: hit.synthetic,
    reasons: ['CARD_LUHN_VALID', ...(hit.synthetic ? ['CARD_SYNTHETIC'] : [])]
  };
}
