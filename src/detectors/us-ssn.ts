import type { Hit, ContextStrength } from '../contracts.ts';

export function ssnHits(
  path: string,
  sampleId: string,
  text: string,
  mode: 'whole' | 'embedded',
  allowUnformatted: boolean,
  limit: number
): Hit[] {
  if (mode === 'whole') {
    const formatted = /^\d{3}-\d{2}-\d{4}$/.test(text.trim());
    const digits = text.replace(/\D/g, '');
    if (!formatted && !(allowUnformatted && digits.length === 9 && text.trim() === digits)) return [];
    if (!validSsn(digits)) return [];
    return [make(path, sampleId, text.trim(), 0, text.length, digits, 'none')];
  }
  const hits: Hit[] = [];
  const pattern = /\b\d{3}-\d{2}-\d{4}\b/g;
  let match: RegExpExecArray | null;
  while (hits.length < limit && (match = pattern.exec(text))) {
    const digits = match[0].replace(/\D/g, '');
    if (validSsn(digits)) hits.push(make(path, sampleId, match[0], match.index, match.index + match[0].length, digits, 'none'));
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
  if (allowUnformatted) {
    const plain = /\b\d{9}\b/g;
    while (hits.length < limit && (match = plain.exec(text))) {
      if (validSsn(match[0])) {
        hits.push(make(path, sampleId, match[0], match.index, match.index + 9, match[0], 'strong'));
      }
      if (match.index === plain.lastIndex) plain.lastIndex += 1;
    }
  }
  return hits;
}

export function validSsn(digits: string): boolean {
  if (!/^\d{9}$/.test(digits)) return false;
  const area = Number(digits.slice(0, 3));
  const group = Number(digits.slice(3, 5));
  const serial = Number(digits.slice(5));
  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0 || serial === 0) return false;
  return true;
}

function make(
  path: string,
  sampleId: string,
  raw: string,
  start: number,
  end: number,
  digits: string,
  context: ContextStrength
): Hit {
  return {
    path,
    sampleId,
    type: 'US_SSN',
    detectorId: 'us-ssn.v1',
    validation: 'moderate',
    context,
    start,
    end,
    normalised: `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`,
    synthetic: false,
    reasons: ['SSN_FORMAT_VALID']
  };
}
