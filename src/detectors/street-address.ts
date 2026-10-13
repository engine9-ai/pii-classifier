import type { Hit, ContextStrength } from '../contracts.ts';
import { STREET_SUFFIXES } from '../rules/street-suffixes-us.ts';

const SUFFIX = STREET_SUFFIXES.join('|');
const STREET = new RegExp(
  String.raw`^\d{1,6}\s+(?:[\p{L}.'-]+\s+){0,6}(?:${SUFFIX})\b(?:\s+(?:N|S|E|W|NE|NW|SE|SW))?(?:\s+(?:apt|unit|ste|suite|#)\s*[\w-]+)?$`,
  'iu'
);

export function streetHits(
  path: string,
  sampleId: string,
  text: string,
  context: ContextStrength
): Hit[] {
  const value = text.trim().replace(/\s+/g, ' ');
  if (!STREET.test(value)) return [];
  if (value.includes('/') || value.includes('\\')) return [];
  return [
    {
      path,
      sampleId,
      type: 'STREET_ADDRESS',
      detectorId: 'street-address.v1',
      validation: 'moderate',
      context,
      start: 0,
      end: text.length,
      normalised: value,
      synthetic: false,
      reasons: ['STREET_SYNTAX_VALID']
    }
  ];
}
