import type { Hit } from '../contracts.ts';

const LOCAL = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]/;
const DOMAIN = /[A-Za-z0-9.-]/;

export function emailHits(path: string, sampleId: string, text: string, limit: number): Hit[] {
  const hits: Hit[] = [];
  let from = 0;
  while (hits.length < limit) {
    const at = text.indexOf('@', from);
    if (at < 0) break;
    let start = at;
    while (start > 0 && LOCAL.test(text[start - 1])) start -= 1;
    let end = at + 1;
    while (end < text.length && DOMAIN.test(text[end])) end += 1;
    const raw = trimPunct(text.slice(start, end));
    const check = validateEmail(raw);
    if (check) {
      hits.push({
        path,
        sampleId,
        type: 'EMAIL',
        detectorId: 'email.v1',
        validation: check,
        context: 'none',
        start,
        end: start + raw.length,
        normalised: raw.toLowerCase(),
        synthetic: false,
        reasons: [check === 'strong' ? 'EMAIL_SYNTAX_VALID' : 'EMAIL_SYNTAX_WEAK']
      });
    }
    from = at + 1;
  }
  return hits;
}

function trimPunct(value: string): string {
  return value.replace(/^[.\s,;:()<>[\]"']+|[.\s,;:()<>[\]"']+$/g, '');
}

export function validateEmail(value: string): 'strong' | 'weak' | null {
  if (value.length < 6 || value.length > 254) return null;
  if ([...value].some((ch) => ch.charCodeAt(0) > 127)) return 'weak';
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length < 1 || local.length > 64) return null;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || domain.length > 253) return null;
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) return null;
    if (label.startsWith('-') || label.endsWith('-')) return null;
    if (!/^[A-Za-z0-9-]+$/.test(label)) return null;
  }
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]{2,}$/.test(tld)) return null;
  return 'strong';
}
