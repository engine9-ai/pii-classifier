import type { DatasetContext, FieldResult, FindingStatus, Hit, PiiType, ResolvedOptions, TypeFinding } from './contracts.ts';
import type { PreparedField } from './canonicalise.ts';
import type { FieldMeta, HintWeight } from './metadata.ts';
import { isNumericDeclaredType, weightFor } from './metadata.ts';
import type { Profile } from './profile.ts';
import { tokenizePath } from './canonicalise.ts';
import { maskValue } from './mask.ts';
import { STRONG_ALIASES } from './rules/field-aliases.ts';

const DISTINCT_CAP = 4096;

interface FieldContext {
  siblingContact: boolean;
  siblingCity: boolean;
  siblingPostal: boolean;
  addressParent: boolean;
  /** A numeric id column with no person-key name: its digits identify a record, not a phone. */
  idColumn: boolean;
}

export function aggregateField(
  field: PreparedField,
  meta: FieldMeta,
  profile: Profile,
  hits: Hit[],
  context: DatasetContext,
  options: ResolvedOptions,
  capped: boolean,
  allPaths: string[]
): FieldResult {
  const siblings = siblingLeaves(context, field.path, allPaths);
  const siblingContact = siblings.some((leaf) => isContactLeaf(leaf));
  const siblingCity = siblings.some((leaf) => leaf === 'city' || leaf.endsWith('_city'));
  const siblingPostal = siblings.some((leaf) =>
    ['postal_code', 'zip_code', 'postcode', 'zip'].includes(leaf)
  );
  const idColumn =
    isNumericDeclaredType(field.declaredType) &&
    field.leaf.split('_').includes('id') &&
    !weightFor(meta.hints, 'PERSON_LINKED_ID');
  const types = new Set<PiiType>([
    ...hits.map((hit) => hit.type),
    ...meta.hints.map((hint) => hint.type)
  ]);
  const findings: TypeFinding[] = [];
  for (const type of [...types].sort()) {
    const finding = decideType(type, hits.filter((hit) => hit.type === type), meta, profile, {
      siblingContact,
      siblingCity,
      siblingPostal,
      addressParent: meta.addressParent,
      idColumn
    }, options);
    if (finding) findings.push(finding);
  }

  const scanIncomplete = capped || profile.truncated > 0 || field.conflict;
  let outcome: FieldResult['outcome'];
  if (profile.usable === 0) {
    outcome = 'insufficient_data';
  } else if (findings.some((finding) => finding.status === 'confirmed' || finding.status === 'likely')) {
    outcome = 'pii_detected';
  } else if (findings.some((finding) => finding.status === 'possible')) {
    outcome = 'possible';
  } else {
    outcome = 'not_observed';
  }

  return {
    path: field.path,
    outcome,
    findings,
    evaluatedRows: profile.usable,
    nullRows: profile.nulls,
    unsupportedRows: profile.unsupported,
    truncatedRows: profile.truncated,
    scanIncomplete
  };
}

function decideType(
  type: PiiType,
  hits: Hit[],
  meta: FieldMeta,
  profile: Profile,
  siblings: FieldContext,
  options: ResolvedOptions
): TypeFinding | null {
  const hint = weightFor(meta.hints, type);
  const decision = decisionFor(type, hits, hint, siblings, profile);
  if (!decision) return null;
  const status = lowerIfSynthetic(decision.status, hits);
  const examinedIds = new Set(hits.map((hit) => hit.sampleId));
  const validatedIds = new Set(hits.filter((hit) => hit.validation === 'strong').map((hit) => hit.sampleId));
  const distinct = new Set<string>();
  let cappedDistinct = false;
  for (const hit of hits) {
    if (distinct.size >= DISTINCT_CAP) {
      cappedDistinct = true;
      break;
    }
    distinct.add(hit.normalised);
  }
  const examples: string[] = [];
  if (options.allowMaskedExamples) {
    const seen = new Set<string>();
    for (const hit of hits) {
      const masked = maskValue(type, hit.normalised);
      if (seen.has(masked)) continue;
      seen.add(masked);
      examples.push(masked);
      if (examples.length >= options.maxExamplesPerFinding) break;
    }
  }
  const reasons = [
    ...new Set([
      ...decision.reasons,
      ...hits.flatMap((hit) => hit.reasons),
      ...(cappedDistinct ? ['DISTINCT_CAP'] : [])
    ])
  ].sort();
  const detectors = [...new Set(hits.map((hit) => hit.detectorId))].sort();
  return {
    type,
    status,
    confidenceBand: status === 'confirmed' ? 'high' : status === 'likely' ? 'medium' : 'low',
    examined: profile.usable,
    matchingRows: examinedIds.size,
    validatedRows: validatedIds.size,
    distinctMatches: distinct.size,
    examples,
    reasons,
    detectors
  };
}

function decisionFor(
  type: PiiType,
  hits: Hit[],
  hint: HintWeight | null,
  siblings: FieldContext,
  profile: Profile
): { status: FindingStatus; reasons: string[] } | null {
  const distinct = new Set(hits.map((hit) => hit.normalised)).size;
  const strongContext = hits.some((hit) => hit.context === 'strong') || hint === 'strong' || hint === 'verified_relation';
  const weakContext = hits.some((hit) => hit.context === 'weak') || hint === 'weak';
  const metaReason = hint ? `META_${hint === 'verified_relation' ? 'RELATION' : hint.toUpperCase()}_${type}` : null;

  if (type === 'EMAIL' || type === 'IP_ADDRESS' || type === 'IBAN') {
    if (hits.some((hit) => hit.validation === 'strong')) {
      return { status: 'confirmed', reasons: ['STRONG_MATCH', ...(metaReason ? [metaReason] : [])] };
    }
    if (hits.length || hint) return { status: 'possible', reasons: [metaReason || 'WEAK_CANDIDATE'] };
    return null;
  }

  if (type === 'PHONE_US') {
    if (!hits.length) return hint ? { status: 'possible', reasons: [metaReason || 'META_PHONE'] } : null;
    if (strongContext) return { status: 'confirmed', reasons: ['PHONE_CONTEXT', ...(metaReason ? [metaReason] : [])] };
    if (distinct >= 2 && weakContext) return { status: 'confirmed', reasons: ['PHONE_REPEATED_WEAK_CONTEXT'] };
    if (siblings.idColumn) return { status: 'possible', reasons: ['PHONE_ID_COLUMN'] };
    return { status: 'likely', reasons: ['PHONE_FORMAT_ONLY'] };
  }

  if (type === 'PAYMENT_CARD') {
    if (!hits.length) return hint ? { status: 'possible', reasons: [metaReason || 'META_CARD'] } : null;
    const syntheticOnly = hits.every((hit) => hit.synthetic);
    if (!syntheticOnly && strongContext) return { status: 'confirmed', reasons: ['CARD_CONTEXT'] };
    if (distinct >= 2 && (strongContext || weakContext)) return { status: 'confirmed', reasons: ['CARD_REPEATED'] };
    // About one in ten random digit strings passes Luhn, so a sparse hit in an id column is noise.
    const rows = new Set(hits.map((hit) => hit.sampleId)).size;
    if (profile.isFreeText || rows * 2 >= profile.usable) return { status: 'likely', reasons: ['CARD_LUHN_ONLY'] };
    return { status: 'possible', reasons: ['CARD_LUHN_SPARSE'] };
  }

  if (type === 'US_SSN') {
    if (!hits.length) return hint ? { status: 'possible', reasons: [metaReason || 'META_SSN'] } : null;
    if (strongContext) return { status: 'confirmed', reasons: ['SSN_CONTEXT'] };
    if (weakContext) return { status: 'likely', reasons: ['SSN_WEAK_CONTEXT'] };
    return { status: 'possible', reasons: ['SSN_UNLABELLED'] };
  }

  if (type === 'DATE_OF_BIRTH') {
    const labelled = hits.some((hit) => hit.reasons.includes('LABEL_DOB'));
    if (distinct >= 2 && (hint === 'strong' || hint === 'verified_relation')) {
      return { status: 'confirmed', reasons: ['DOB_REPEATED', metaReason || 'META_STRONG_DATE_OF_BIRTH'] };
    }
    if (hits.length && labelled) return { status: 'confirmed', reasons: ['LABEL_DOB'] };
    if (hits.length && hint === 'strong') return { status: 'likely', reasons: ['DOB_STRONG_FIELD'] };
    if (hint) return { status: 'possible', reasons: [metaReason || 'META_DOB'] };
    return null;
  }

  if (type === 'PERSON_NAME') {
    const labelled = hits.some((hit) => hit.reasons.includes('LABEL_NAME'));
    if (labelled && hits.length) return { status: 'confirmed', reasons: ['LABEL_NAME'] };
    // One name on every row is a label (the client or sender), not a column of people.
    if (distinct === 1 && new Set(hits.map((hit) => hit.sampleId)).size >= 10) {
      return { status: 'possible', reasons: ['PERSON_NAME_CONSTANT'] };
    }
    if (distinct >= 3 && hint === 'strong' && siblings.siblingContact) {
      return { status: 'confirmed', reasons: ['PERSON_NAME_FIELD_AND_CONTACT'] };
    }
    if (hits.length && hint === 'strong') return { status: 'likely', reasons: ['PERSON_NAME_FIELD'] };
    if (hint) return { status: 'possible', reasons: [metaReason || 'META_PERSON_NAME'] };
    return null;
  }

  if (type === 'STREET_ADDRESS') {
    const labelled = hits.some((hit) => hit.reasons.includes('LABEL_ADDRESS'));
    const located = siblings.siblingCity || siblings.siblingPostal;
    const strongField = hint === 'strong' || ((hint === 'weak' || siblings.addressParent) && located);
    if ((labelled || (hits.length && strongField && located))) {
      return { status: 'confirmed', reasons: [labelled ? 'LABEL_ADDRESS' : 'STREET_WITH_LOCALITY'] };
    }
    if (hits.length && (hint === 'strong' || strongField)) return { status: 'likely', reasons: ['STREET_FIELD'] };
    if (hits.length) return { status: 'possible', reasons: ['STREET_UNLABELLED'] };
    if (hint) return { status: 'possible', reasons: [metaReason || 'META_STREET'] };
    return null;
  }

  if (type === 'POSTAL_CODE') {
    if (hits.length && (hint || strongContext)) return { status: 'confirmed', reasons: ['POSTAL_CONTEXT'] };
    if (hits.length && weakContext) return { status: 'likely', reasons: ['POSTAL_WEAK_CONTEXT'] };
    if (hint) return { status: 'possible', reasons: [metaReason || 'META_POSTAL'] };
    return null;
  }

  if (type === 'PERSON_LINKED_ID') {
    if (hint === 'verified_relation' && hits.length) return { status: 'confirmed', reasons: ['RELATION_PERSON'] };
    if (hint === 'strong' && hits.length) return { status: 'likely', reasons: ['META_PERSON_KEY'] };
    if (hint === 'weak' && hits.length) return { status: 'possible', reasons: ['META_WEAK_PERSON_LINKED_ID'] };
    if (hint) return { status: 'possible', reasons: [metaReason || 'META_PERSON_LINKED_ID'] };
    return null;
  }

  return null;
}

function lowerIfSynthetic(status: FindingStatus, hits: Hit[]): FindingStatus {
  if (!hits.length || hits.some((hit) => !hit.synthetic)) return status;
  if (status === 'confirmed') return 'likely';
  if (status === 'likely') return 'possible';
  return status;
}

function siblingLeaves(context: DatasetContext, selfPath: string, allPaths: string[]): string[] {
  const paths = new Set<string>([...(context.siblingPaths || []), ...allPaths]);
  return [...paths].filter((path) => path !== selfPath).map((path) => tokenizePath(path).leaf);
}

function isContactLeaf(leaf: string): boolean {
  return (
    (STRONG_ALIASES.EMAIL as readonly string[]).includes(leaf) ||
    (STRONG_ALIASES.PHONE_US as readonly string[]).includes(leaf) ||
    leaf.endsWith('_email') ||
    leaf.endsWith('_phone')
  );
}
