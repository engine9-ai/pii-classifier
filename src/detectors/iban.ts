import type { Hit } from '../contracts.ts';
import { IBAN_LENGTHS } from '../rules/iban-country-lengths.ts';

export function ibanHits(path: string, sampleId: string, text: string, mode: 'whole' | 'embedded', limit: number): Hit[] {
  if (mode === 'whole') {
    const compact = compactIban(text);
    const kind = classifyIban(compact);
    if (!kind) return [];
    return [make(path, sampleId, 0, text.length, compact, kind)];
  }
  const hits: Hit[] = [];
  const pattern = /\b[A-Z]{2}\d{2}[A-Z0-9]{8,30}\b/gi;
  let match: RegExpExecArray | null;
  while (hits.length < limit && (match = pattern.exec(text))) {
    const compact = compactIban(match[0]);
    const kind = classifyIban(compact);
    if (kind === 'valid') hits.push(make(path, sampleId, match.index, match.index + match[0].length, compact, kind));
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
  return hits;
}

export function compactIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function classifyIban(compact: string): 'valid' | 'unsupported' | null {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)) return null;
  const country = compact.slice(0, 2);
  const expected = IBAN_LENGTHS[country];
  if (!expected) return compact.length >= 15 && compact.length <= 34 ? 'unsupported' : null;
  if (compact.length !== expected) return null;
  return ibanMod97(compact) ? 'valid' : null;
}

export function ibanMod97(compact: string): boolean {
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const expanded = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of expanded) {
      remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder === 1;
}

function make(path: string, sampleId: string, start: number, end: number, compact: string, kind: 'valid' | 'unsupported'): Hit {
  return {
    path,
    sampleId,
    type: 'IBAN',
    detectorId: 'iban.v1',
    validation: kind === 'valid' ? 'strong' : 'weak',
    context: 'none',
    start,
    end,
    normalised: compact,
    synthetic: false,
    reasons: [kind === 'valid' ? 'IBAN_MOD97_VALID' : 'IBAN_COUNTRY_UNSUPPORTED']
  };
}
