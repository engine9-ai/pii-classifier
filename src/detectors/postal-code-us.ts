import type { Hit, ContextStrength } from '../contracts.ts';

export function postalHits(
  path: string,
  sampleId: string,
  text: string,
  allow: boolean,
  context: ContextStrength
): Hit[] {
  if (!allow) return [];
  const value = text.trim();
  if (!/^\d{5}(?:-\d{4})?$/.test(value)) return [];
  return [
    {
      path,
      sampleId,
      type: 'POSTAL_CODE',
      detectorId: 'postal-code-us.v1',
      validation: 'weak',
      context,
      start: 0,
      end: text.length,
      normalised: value,
      synthetic: false,
      reasons: ['POSTAL_ZIP_SYNTAX']
    }
  ];
}
