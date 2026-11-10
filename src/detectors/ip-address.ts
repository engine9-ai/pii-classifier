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
    if (isIP(match[0]) && !isPartOfLongerDottedToken(text, match.index, match.index + match[0].length)) hits.push(make(path, sampleId, match[0], match.index, match.index + match[0].length));
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

/**
 * Four dotted numbers inside free text are often not an address: analytics ids (`guci=1.2.0.0.2.2.0.0`),
 * version strings (`/mail-1.89.263.11226/client`), or a tail of a longer dotted run. Reject a candidate that
 * continues into more dotted digits or letters, or that sits directly after `digit.`, `-` or `_`.
 * `ip=1.2.3.4`, `1.2.3.4:8080`, `[1.2.3.4]`, `http://1.2.3.4/` and a sentence-ending `1.2.3.4.` still match.
 */
function isPartOfLongerDottedToken(text: string, start: number, end: number): boolean {
  if (/^\.[0-9A-Za-z]/.test(text.slice(end, end + 2))) return true;
  const before = text.slice(Math.max(0, start - 2), start);
  if (/\d\.$/.test(before)) return true;
  return /[-_]$/.test(before);
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

/**
 * 4 or 6 when the value is an IPv4 or IPv6 address, else 0 (the node:net contract, without node:net,
 * so the classifier runs in Workers and browsers too).
 */
export function isIP(value: string): 0 | 4 | 6 {
  if (isIPv4(value)) return 4;
  if (isIPv6(value)) return 6;
  return 0;
}

function isIPv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

function isIPv6(value: string): boolean {
  let text = value;
  const zone = text.indexOf('%');
  if (zone >= 0) {
    if (!/^[A-Za-z0-9._~-]+$/.test(text.slice(zone + 1))) return false;
    text = text.slice(0, zone);
  }
  if (!text.includes(':')) return false;
  let groups = 8;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return false;
    text = text.slice(0, lastColon + 1) + '0:0';
  }
  const double = text.indexOf('::');
  if (double !== text.lastIndexOf('::')) return false;
  const hex = /^[0-9A-Fa-f]{1,4}$/;
  if (double >= 0) {
    const head = text.slice(0, double);
    const rest = text.slice(double + 2);
    const a = head ? head.split(':') : [];
    const b = rest ? rest.split(':') : [];
    if (![...a, ...b].every((g) => hex.test(g))) return false;
    return a.length + b.length < groups;
  }
  const all = text.split(':');
  return all.length === groups && all.every((g) => hex.test(g));
}
