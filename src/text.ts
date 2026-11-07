import type { Hit, PiiType } from './contracts.ts';
import { emailHits } from './detectors/email.ts';
import { phoneHits } from './detectors/phone-us.ts';
import { cardHits } from './detectors/payment-card.ts';
import { ssnHits } from './detectors/us-ssn.ts';
import { ibanHits } from './detectors/iban.ts';
import { ipHits } from './detectors/ip-address.ts';
import { parseBirth } from './detectors/birth-date.ts';
import { plausibleName } from './detectors/person-name.ts';
import { streetHits } from './detectors/street-address.ts';
import { maskValue } from './mask.ts';
import { LIMITS } from './taxonomy.ts';

/**
 * Free text (a log line, a note, an email body, a ticket comment) rather than a column of values.
 *
 * `classify` decides what a *field* holds from many samples and its name. Free text has no field name to
 * lean on, so this finds individual spans with the same detectors in embedded mode, plus labelled values
 * ("DOB: …", "Full name: …", "Mailing address: …", "my name is …"). Every span has exact offsets, so the
 * caller can redact the text itself. Names and street addresses are only found when labelled: an unlabelled
 * "Jordan Lee" in prose is indistinguishable from a product or a place.
 */

export const TEXT_TYPES: readonly PiiType[] = [
  'EMAIL',
  'PHONE_US',
  'PAYMENT_CARD',
  'US_SSN',
  'IBAN',
  'IP_ADDRESS',
  'DATE_OF_BIRTH',
  'PERSON_NAME',
  'STREET_ADDRESS'
];

export interface TextSpan {
  type: PiiType;
  start: number;
  end: number;
  /** A known test value (Stripe test card, 555 exchange…). */
  synthetic: boolean;
  /** Masked form, safe to show. */
  masked: string;
}

export interface TextScanOptions {
  /** Types to look for. Default: all of TEXT_TYPES. */
  types?: readonly PiiType[];
  /** Longest text scanned; the rest is reported as not scanned. Default 1,000,000 characters. */
  maxChars?: number;
  /** Most spans returned. Default 10,000. */
  maxSpans?: number;
}

export interface TextScan {
  spans: TextSpan[];
  /** Per type: how many spans, and up to three masked examples. */
  counts: Partial<Record<PiiType, number>>;
  examples: Partial<Record<PiiType, string[]>>;
  scannedChars: number;
  truncated: boolean;
}

export interface RedactOptions extends TextScanOptions {
  /** Leave known test values (4242 4242 4242 4242, 555 numbers) as they are. Default true. */
  keepSynthetic?: boolean;
  /** 'mask' keeps a hint ("j***@***.com", "**** **** **** 1111"); 'label' writes "[EMAIL]". Default 'mask'. */
  style?: 'mask' | 'label';
}

export interface Redaction {
  text: string;
  redacted: Partial<Record<PiiType, number>>;
  total: number;
  truncated: boolean;
}

const LABELLED =
  /\b(full name|name|mailing address|home address|street address|address|dob|date of birth|birth ?date|birthday)\s*[:=]\s*([^\n\r;|]{1,120})/gi;

export function scanText(text: string, options: TextScanOptions = {}): TextScan {
  const wanted = new Set<PiiType>(options.types || TEXT_TYPES);
  const maxChars = options.maxChars ?? 1_000_000;
  const maxSpans = options.maxSpans ?? 10_000;
  const source = String(text ?? '');
  const truncated = source.length > maxChars;
  const body = truncated ? source.slice(0, maxChars) : source;
  const hits: Hit[] = [];
  const limit = Math.max(maxSpans, LIMITS.maxSpansPerValue);
  const want = (type: PiiType) => wanted.has(type);

  // Per line, so offsets stay small and one huge line cannot starve the rest.
  let offset = 0;
  for (const line of body.split(/(?<=\n)/)) {
    if (hits.length >= limit) break;
    const shift = (found: Hit[]) => {
      for (const hit of found) hits.push({ ...hit, start: hit.start + offset, end: hit.end + offset });
    };
    if (want('EMAIL')) shift(emailHits('text', 'line', line, limit));
    if (want('PHONE_US')) shift(phoneHits('text', 'line', line, 'embedded', limit));
    if (want('PAYMENT_CARD')) shift(cardHits('text', 'line', line, 'embedded', limit));
    if (want('US_SSN')) shift(ssnHits('text', 'line', line, 'embedded', /\bssn\b|social security/i.test(line), limit));
    if (want('IBAN')) shift(ibanHits('text', 'line', line, 'embedded', limit));
    if (want('IP_ADDRESS')) shift(ipHits('text', 'line', line, 'embedded', limit));
    shift(labelled(line, wanted));
    offset += line.length;
  }

  const spans = resolve(hits).slice(0, maxSpans);
  const counts: Partial<Record<PiiType, number>> = {};
  const examples: Partial<Record<PiiType, string[]>> = {};
  for (const span of spans) {
    counts[span.type] = (counts[span.type] || 0) + 1;
    const list = (examples[span.type] ||= []);
    if (list.length < LIMITS.maxExamplesPerFinding && !list.includes(span.masked)) list.push(span.masked);
  }
  return { spans, counts, examples, scannedChars: body.length, truncated };
}

/** The text with every span of the requested types replaced. Text past maxChars is dropped, not kept unscanned. */
export function redactText(text: string, options: RedactOptions = {}): Redaction {
  const keepSynthetic = options.keepSynthetic !== false;
  const style = options.style || 'mask';
  const scan = scanText(text, options);
  const source = String(text ?? '').slice(0, scan.scannedChars);
  let out = '';
  let at = 0;
  const redacted: Partial<Record<PiiType, number>> = {};
  let total = 0;
  for (const span of scan.spans) {
    if (keepSynthetic && span.synthetic) continue;
    out += source.slice(at, span.start) + (style === 'label' ? `[${span.type}]` : span.masked);
    at = span.end;
    redacted[span.type] = (redacted[span.type] || 0) + 1;
    total += 1;
  }
  out += source.slice(at);
  if (scan.truncated) out += '\n[remainder not scanned and removed]';
  return { text: out, redacted, total, truncated: scan.truncated };
}

function labelled(line: string, wanted: Set<PiiType>): Hit[] {
  const out: Hit[] = [];
  LABELLED.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LABELLED.exec(line))) {
    const label = match[1].toLowerCase();
    const raw = match[2];
    const valueStart = match.index + match[0].length - raw.length;
    const lead = raw.length - raw.trimStart().length;
    const value = raw.trim();
    const start = valueStart + lead;
    if (/name/.test(label) && wanted.has('PERSON_NAME')) {
      const words = value.split(/\s+/).slice(0, 4);
      // A bare "name:" must look like a person (two or more capitalised words); "full name:" is enough on its own.
      let take = 0;
      for (let n = words.length; n >= 1 && !take; n -= 1) {
        const candidate = words.slice(0, n).join(' ').replace(/[,.]+$/, '');
        const shaped = label === 'name' ? n >= 2 && words.slice(0, n).every((w) => /^\p{Lu}/u.test(w)) : true;
        if (shaped && plausibleName(candidate)) take = candidate.length;
      }
      if (take) out.push(hit('PERSON_NAME', start, start + take, value.slice(0, take), 'LABEL_NAME'));
    } else if (/address/.test(label) && wanted.has('STREET_ADDRESS')) {
      const street = value.split(',')[0].trim();
      if (streetHits('text', 'line', street, 'strong').length) {
        // Through the ZIP code when there is one ("12 Oak St, Springfield, IL 62704"), else the whole value.
        const zip = /\b\d{5}(?:-\d{4})?\b/.exec(value);
        const span = zip ? value.slice(0, zip.index + zip[0].length) : value;
        out.push(hit('STREET_ADDRESS', start, start + span.length, span, 'LABEL_ADDRESS'));
      }
    } else if ((/dob|birth/.test(label)) && wanted.has('DATE_OF_BIRTH')) {
      const token = value.split(/\s+/)[0].replace(/[,.]+$/, '');
      const parsed = parseBirth(token);
      if (parsed) out.push(hit('DATE_OF_BIRTH', start, start + token.length, parsed, 'LABEL_DOB'));
    }
    if (match.index === LABELLED.lastIndex) LABELLED.lastIndex += 1;
  }
  const named = /\bmy name is\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,2})/iu.exec(line);
  if (named && wanted.has('PERSON_NAME')) {
    const words = named[1].split(/\s+/);
    // Stop at the first lower-case word: "my name is Ana and I…" is Ana.
    const cut = words.findIndex((w, i) => i > 0 && !/^\p{Lu}/u.test(w));
    const name = (cut < 0 ? words : words.slice(0, cut)).join(' ').replace(/[,.]+$/, '');
    if (plausibleName(name)) {
      const start = named.index + named[0].length - named[1].length;
      out.push(hit('PERSON_NAME', start, start + name.length, name, 'LABEL_NAME'));
    }
  }
  return out;
}

function hit(type: PiiType, start: number, end: number, normalised: string, reason: string): Hit {
  return {
    path: 'text',
    sampleId: 'line',
    type,
    detectorId: 'text-label.v1',
    validation: 'moderate',
    context: 'strong',
    start,
    end,
    normalised,
    synthetic: false,
    reasons: [reason]
  };
}

/** Sorted, non-overlapping spans. Where two overlap, the longer wins (a card number over the phone inside it). */
function resolve(hits: Hit[]): TextSpan[] {
  const sorted = [...hits].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: TextSpan[] = [];
  for (const h of sorted) {
    if (h.end <= h.start) continue;
    const last = out[out.length - 1];
    if (last && h.start < last.end) {
      if (h.end - h.start > last.end - last.start) out[out.length - 1] = span(h);
      continue;
    }
    out.push(span(h));
  }
  return out;
}

function span(h: Hit): TextSpan {
  return { type: h.type, start: h.start, end: h.end, synthetic: h.synthetic, masked: maskValue(h.type, h.normalised) };
}
