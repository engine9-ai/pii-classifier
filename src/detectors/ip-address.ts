import { isIP } from 'node:net';
import type { Hit } from '../contracts.ts';

export function ipHits(path: string, sampleId: string, text: string, mode: 'whole' | 'embedded', limit: number): Hit[] {
  if (mode === 'whole') {
    const trimmed = text.trim();
    if (!isIP(trimmed)) return [];
    return [make(path, sampleId, trimmed, 0, text.length)];
  }
  const hits: Hit[] = [];
  const v4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  let match: RegExpExecArray | null;
  while (hits.length < limit && (match = v4.exec(text))) {
    if (isIP(match[0])) hits.push(make(path, sampleId, match[0], match.index, match.index + match[0].length));
    if (match.index === v4.lastIndex) v4.lastIndex += 1;
  }
  const v6 = /\b(?:[A-F0-9]{0,4}:){2,7}[A-F0-9]{0,4}\b/gi;
  while (hits.length < limit && (match = v6.exec(text))) {
    const candidate = match[0].replace(/^[^\dA-F:]+|[^\dA-F:]+$/gi, '');
    if (candidate.includes(':') && isIP(candidate)) {
      hits.push(make(path, sampleId, candidate, match.index, match.index + match[0].length));
    }
    if (match.index === v6.lastIndex) v6.lastIndex += 1;
  }
  return hits;
}

function make(path: string, sampleId: string, ip: string, start: number, end: number): Hit {
  return {
    path,
    sampleId,
    type: 'IP_ADDRESS',
    detectorId: 'ip-address.v1',
    validation: 'strong',
    context: 'none',
    start,
    end,
    normalised: ip.toLowerCase(),
    synthetic: false,
    reasons: ['IP_SYNTAX_VALID']
  };
}
