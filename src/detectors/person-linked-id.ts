import type { Hit, ContextStrength, Validation } from '../contracts.ts';

export function linkedIdHits(
  path: string,
  sampleId: string,
  text: string,
  validation: Validation,
  context: ContextStrength,
  reason: string
): Hit[] {
  const value = text.trim();
  if (!value) return [];
  return [
    {
      path,
      sampleId,
      type: 'PERSON_LINKED_ID',
      detectorId: 'person-linked-id.v1',
      validation,
      context,
      start: 0,
      end: text.length,
      normalised: value,
      synthetic: false,
      reasons: [reason]
    }
  ];
}
