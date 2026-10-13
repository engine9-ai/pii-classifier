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
  if (!luhn(digits)) return null;
  return { digits, synthetic: TEST_PANS.has(digits) };
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
