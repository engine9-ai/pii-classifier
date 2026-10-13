import type { Hit, ResolvedOptions } from './contracts.ts';
import type { PreparedField } from './canonicalise.ts';
import type { FieldMeta } from './metadata.ts';
import { weightFor } from './metadata.ts';
import type { Profile } from './profile.ts';
import { emailHits } from './detectors/email.ts';
import { phoneHits } from './detectors/phone-us.ts';
import { cardHits } from './detectors/payment-card.ts';
import { ssnHits } from './detectors/us-ssn.ts';
import { ibanHits } from './detectors/iban.ts';
import { ipHits } from './detectors/ip-address.ts';
import { birthHits } from './detectors/birth-date.ts';
import { nameHits } from './detectors/person-name.ts';
import { streetHits } from './detectors/street-address.ts';
import { postalHits } from './detectors/postal-code-us.ts';
import { linkedIdHits } from './detectors/person-linked-id.ts';

export function detectField(
  field: PreparedField,
  meta: FieldMeta,
  profile: Profile,
  options: ResolvedOptions
): { hits: Hit[]; capped: boolean } {
  const hits: Hit[] = [];
  let capped = false;
  const room = () => options.maxSpansPerValue;
  const ssnMeta = weightFor(meta.hints, 'US_SSN');
  const dobMeta = weightFor(meta.hints, 'DATE_OF_BIRTH');
  const nameMeta = weightFor(meta.hints, 'PERSON_NAME');
  const streetMeta = weightFor(meta.hints, 'STREET_ADDRESS');
  const postalMeta = weightFor(meta.hints, 'POSTAL_CODE');
  const idMeta = weightFor(meta.hints, 'PERSON_LINKED_ID');
  const freeText = profile.isFreeText;

  for (const cell of field.cells) {
    if (cell.kind !== 'usable') continue;
    const before = hits.length;
    const text = cell.text;
    push(hits, emailHits(field.path, cell.sampleId, text, room()));
    push(hits, ipHits(field.path, cell.sampleId, text, 'whole', room()));
    if (options.enableEmbeddedText) {
      push(hits, ipHits(field.path, cell.sampleId, text, 'embedded', room()));
    }
    push(hits, phoneHits(field.path, cell.sampleId, text, 'whole', room()));
    if (freeText && options.enableEmbeddedText) {
      push(hits, phoneHits(field.path, cell.sampleId, text, 'embedded', room()));
      push(hits, cardHits(field.path, cell.sampleId, text, 'embedded', room()));
    }
    push(hits, cardHits(field.path, cell.sampleId, text, 'whole', room()));
    push(hits, ssnHits(field.path, cell.sampleId, text, 'whole', ssnMeta != null, room()));
    if (options.enableEmbeddedText) {
      push(hits, ssnHits(field.path, cell.sampleId, text, 'embedded', false, room()));
    }
    push(hits, ibanHits(field.path, cell.sampleId, text, 'whole', room()));
    if (options.enableEmbeddedText) {
      push(hits, ibanHits(field.path, cell.sampleId, text, 'embedded', room()));
    }
    if (dobMeta) push(hits, birthHits(field.path, cell.sampleId, text, true, 'none'));
    if (nameMeta) push(hits, nameHits(field.path, cell.sampleId, text, 'none'));
    if (streetMeta || text.length <= 160) push(hits, streetHits(field.path, cell.sampleId, text, 'none'));
    if (postalMeta) push(hits, postalHits(field.path, cell.sampleId, text, true, 'none'));
    if (idMeta === 'verified_relation') {
      push(hits, linkedIdHits(field.path, cell.sampleId, text, 'strong', 'strong', 'RELATION_PERSON'));
    } else if (idMeta === 'strong') {
      push(hits, linkedIdHits(field.path, cell.sampleId, text, 'moderate', 'none', 'META_PERSON_KEY'));
    } else if (idMeta === 'weak') {
      push(hits, linkedIdHits(field.path, cell.sampleId, text, 'weak', 'none', 'META_WEAK_PERSON_LINKED_ID'));
    }
    if (hits.length - before >= options.maxSpansPerValue) {
      hits.length = before + options.maxSpansPerValue;
      capped = true;
    }
  }

  applyHintContext(hits, meta);
  return { hits, capped };
}

function push(hits: Hit[], more: Hit[]) {
  for (const hit of more) hits.push(hit);
}

function applyHintContext(hits: Hit[], meta: FieldMeta) {
  for (const hit of hits) {
    if (hit.context !== 'none') continue;
    const weight = weightFor(meta.hints, hit.type);
    if (weight === 'strong' || weight === 'verified_relation') hit.context = 'strong';
    else if (weight === 'weak') hit.context = 'weak';
  }
}
