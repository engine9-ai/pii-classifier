import type { Hit, ContextStrength } from '../contracts.ts';

export function phoneHits(
  path: string,
  sampleId: string,
  text: string,
  mode: 'whole' | 'embedded',
  limit: number
): Hit[] {
  if (mode === 'whole') {
    const hit = parsePhone(text);
    if (!hit) return [];
    return [make(path, sampleId, text, 0, text.length, hit, 'none')];
  }
  const hits: Hit[] = [];
  const pattern = /(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g;
  let match: RegExpExecArray | null;
  while (hits.length < limit && (match = pattern.exec(text))) {
    const raw = match[0];
    const hit = parsePhone(raw);
    if (!hit) continue;
    hits.push(make(path, sampleId, raw, match.index, match.index + raw.length, hit, 'none'));
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
  return hits;
}

export function parsePhone(value: string): { digits: string; synthetic: boolean } | null {
  const trimmed = value.trim();
  if (!/^[\d\s()+.\-]+$/.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);
  if (!nxx(area) || !nxx(exchange)) return null;
  if (area.slice(1) === '11' || exchange.slice(1) === '11') return null;
  return { digits, synthetic: isSyntheticPhone(digits, exchange) };
}

function nxx(code: string): boolean {
  return code[0] >= '2' && code[0] <= '9';
}

function isSyntheticPhone(digits: string, exchange: string): boolean {
  if (/^(\d)\1{9}$/.test(digits)) return true;
  if (exchange === '555') return true;
  return digits === '1234567890' || digits === '0123456789';
}

function make(
  path: string,
  sampleId: string,
  raw: string,
  start: number,
  end: number,
  hit: { digits: string; synthetic: boolean },
  context: ContextStrength
): Hit {
  return {
    path,
    sampleId,
    type: 'PHONE_US',
    detectorId: 'us-phone.v1',
    validation: 'moderate',
    context,
    start,
    end,
    normalised: hit.digits,
    synthetic: hit.synthetic,
    reasons: ['PHONE_NANP_VALID', ...(hit.synthetic ? ['PHONE_SYNTHETIC'] : [])]
  };
}
