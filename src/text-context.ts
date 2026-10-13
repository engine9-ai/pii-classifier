import type { Hit } from './contracts.ts';
import type { PreparedField } from './canonicalise.ts';
import { validateEmail } from './detectors/email.ts';
import { parsePhone } from './detectors/phone-us.ts';
import { parseCard } from './detectors/payment-card.ts';
import { validSsn } from './detectors/us-ssn.ts';
import { parseBirth } from './detectors/birth-date.ts';
import { plausibleName } from './detectors/person-name.ts';
import { streetHits } from './detectors/street-address.ts';

const LABEL =
  /\b(e-?mail|email|phone|mobile|telephone|ssn|dob|date of birth|full name|mailing address|card number|card|pan)\s*[:=]\s*([^\n]{1,120})/gi;

export function contextualHits(field: PreparedField, limit: number): Hit[] {
  const hits: Hit[] = [];
  for (const cell of field.cells) {
    if (cell.kind !== 'usable' || hits.length >= limit) break;
    const text = cell.text;
    collectLabels(field.path, cell.sampleId, text, hits, limit);
    collectPhrases(field.path, cell.sampleId, text, hits, limit);
  }
  return hits;
}

function collectLabels(path: string, sampleId: string, text: string, hits: Hit[], limit: number) {
  LABEL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while (hits.length < limit && (match = LABEL.exec(text))) {
    const label = match[1].toLowerCase();
    const window = match[2].trim();
    const start = match.index;
    if (label === 'email' || label === 'e-mail') addEmail(path, sampleId, window, start, hits);
    else if (label === 'phone' || label === 'mobile' || label === 'telephone') addPhone(path, sampleId, window, start, hits);
    else if (label === 'ssn') addSsn(path, sampleId, window, start, hits);
    else if (label === 'dob' || label === 'date of birth') addDob(path, sampleId, window, start, hits);
    else if (label === 'full name') addName(path, sampleId, window, start, hits);
    else if (label === 'mailing address') addStreet(path, sampleId, window, start, hits);
    else if (label === 'card' || label === 'card number' || label === 'pan') addCard(path, sampleId, window, start, hits);
    if (match.index === LABEL.lastIndex) LABEL.lastIndex += 1;
  }
}

function collectPhrases(path: string, sampleId: string, text: string, hits: Hit[], limit: number) {
  if (hits.length >= limit) return;
  const named = /\bmy name is\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,3})/iu.exec(text);
  if (named && plausibleName(named[1])) {
    addName(path, sampleId, named[1], named.index, hits);
  }
  const contact = /\bcontact\s+([\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,3})\s+at\s+(\S+)/iu.exec(text);
  if (contact) {
    if (plausibleName(contact[1])) addName(path, sampleId, contact[1], contact.index, hits);
    addEmail(path, sampleId, contact[2], contact.index, hits);
  }
  const born = /\bborn on\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text);
  if (born) addDob(path, sampleId, born[1], born.index, hits);
}

function addEmail(path: string, sampleId: string, raw: string, start: number, hits: Hit[]) {
  const value = raw.replace(/[),.;]+$/g, '');
  const validation = validateEmail(value);
  if (validation !== 'strong') return;
  hits.push(base(path, sampleId, 'EMAIL', 'email.v1', validation, value.toLowerCase(), start, value.length, ['EMAIL_SYNTAX_VALID']));
}

function addPhone(path: string, sampleId: string, raw: string, start: number, hits: Hit[]) {
  const parsed = parsePhone(raw);
  if (!parsed) return;
  hits.push(
    base(path, sampleId, 'PHONE_US', 'us-phone.v1', 'moderate', parsed.digits, start, raw.length, [
      'PHONE_NANP_VALID',
      'LABEL_PHONE',
      ...(parsed.synthetic ? ['PHONE_SYNTHETIC'] : [])
    ], parsed.synthetic)
  );
}

function addSsn(path: string, sampleId: string, raw: string, start: number, hits: Hit[]) {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (!validSsn(digits)) return;
  const normalised = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  hits.push(base(path, sampleId, 'US_SSN', 'us-ssn.v1', 'moderate', normalised, start, raw.length, ['SSN_FORMAT_VALID', 'LABEL_SSN']));
}

function addDob(path: string, sampleId: string, raw: string, start: number, hits: Hit[]) {
  const token = raw.split(/\s+/)[0];
  const parsed = parseBirth(token);
  if (!parsed) return;
  hits.push(base(path, sampleId, 'DATE_OF_BIRTH', 'birth-date.v1', 'moderate', parsed, start, token.length, ['DOB_DATE_VALID', 'LABEL_DOB']));
}

function addName(path: string, sampleId: string, raw: string, start: number, hits: Hit[]) {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!plausibleName(name)) return;
  hits.push(base(path, sampleId, 'PERSON_NAME', 'person-name.v1', 'moderate', name, start, name.length, ['PERSON_NAME_SHAPE', 'LABEL_NAME']));
}

function addStreet(path: string, sampleId: string, raw: string, start: number, hits: Hit[]) {
  const found = streetHits(path, sampleId, raw, 'strong');
  if (!found.length) return;
  found[0].start = start;
  found[0].reasons.push('LABEL_ADDRESS');
  hits.push(found[0]);
}

function addCard(path: string, sampleId: string, raw: string, start: number, hits: Hit[]) {
  const parsed = parseCard(raw);
  if (!parsed) return;
  hits.push(
    base(path, sampleId, 'PAYMENT_CARD', 'payment-card.v1', 'moderate', parsed.digits, start, raw.length, [
      'CARD_LUHN_VALID',
      'LABEL_CARD',
      ...(parsed.synthetic ? ['CARD_SYNTHETIC'] : [])
    ], parsed.synthetic)
  );
}

function base(
  path: string,
  sampleId: string,
  type: Hit['type'],
  detectorId: string,
  validation: Hit['validation'],
  normalised: string,
  start: number,
  length: number,
  reasons: string[],
  synthetic = false
): Hit {
  return {
    path,
    sampleId,
    type,
    detectorId,
    validation,
    context: 'strong',
    start,
    end: start + length,
    normalised,
    synthetic,
    reasons
  };
}
