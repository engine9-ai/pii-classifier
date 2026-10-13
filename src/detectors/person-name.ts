import type { Hit, ContextStrength } from '../contracts.ts';
import { ORG_DESIGNATORS } from '../rules/placeholders.ts';

export function nameHits(
  path: string,
  sampleId: string,
  text: string,
  context: ContextStrength
): Hit[] {
  const name = text.trim().replace(/\s+/g, ' ');
  if (!plausibleName(name)) return [];
  return [
    {
      path,
      sampleId,
      type: 'PERSON_NAME',
      detectorId: 'person-name.v1',
      validation: context === 'strong' ? 'moderate' : 'weak',
      context,
      start: 0,
      end: text.length,
      normalised: name,
      synthetic: false,
      reasons: ['PERSON_NAME_SHAPE']
    }
  ];
}

export function plausibleName(value: string): boolean {
  if (value.length < 1 || value.length > 80) return false;
  if (/\d/.test(value)) return false;
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length < 1 || parts.length > 5) return false;
  if (parts.some((part) => ORG_DESIGNATORS.has(part.toLowerCase().replace(/[.]/g, '')))) return false;
  return parts.every((part) => /^[\p{L}][\p{L}'’.-]*$/u.test(part));
}
