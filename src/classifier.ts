import type { ClassifierRequest, ClassifierResponse, Hit } from './contracts.ts';
import { CLASSIFIER_VERSION, RULES_VERSION } from './taxonomy.ts';
import { prepareField, resolveOptions } from './canonicalise.ts';
import { fieldMetadata } from './metadata.ts';
import { profileField } from './profile.ts';
import { detectField } from './detector-registry.ts';
import { contextualHits } from './text-context.ts';
import { aggregateField } from './aggregate.ts';
import { escalate } from './escalation.ts';

export function classify(request: ClassifierRequest): ClassifierResponse {
  const options = resolveOptions(request.options);
  const context = request.context;
  const fields = [...(request.fields || [])].sort((a, b) => a.path.localeCompare(b.path));
  const preparedFields = fields.map((field) => prepareField(field, options));
  const allPaths = preparedFields.map((field) => field.path);
  const results = preparedFields.map((prepared) => {
    const meta = fieldMetadata(prepared, context);
    const profile = profileField(prepared, meta.freeTextName);
    const detected = detectField(prepared, meta, profile, options);
    const extra = contextualHits(prepared, options.maxSpansPerValue);
    const hits = mergeHits(detected.hits, extra);
    const aggregated = aggregateField(prepared, meta, profile, hits, context, options, detected.capped, allPaths);
    return escalate(aggregated, meta, profile, context, options);
  });
  return {
    assetId: context.assetId,
    classifierVersion: CLASSIFIER_VERSION,
    rulesVersion: RULES_VERSION,
    fields: results
  };
}

function mergeHits(primary: Hit[], extra: Hit[]): Hit[] {
  const map = new Map<string, Hit>();
  for (const hit of [...primary, ...extra]) {
    const key = `${hit.sampleId}|${hit.type}|${hit.normalised}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...hit, reasons: [...hit.reasons] });
      continue;
    }
    if (rank(hit.context) > rank(existing.context)) existing.context = hit.context;
    if (rankValidation(hit.validation) > rankValidation(existing.validation)) existing.validation = hit.validation;
    if (hit.synthetic === false) existing.synthetic = false;
    for (const reason of hit.reasons) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    }
  }
  return [...map.values()];
}

function rank(context: Hit['context']): number {
  if (context === 'strong') return 3;
  if (context === 'weak') return 2;
  return 1;
}

function rankValidation(validation: Hit['validation']): number {
  if (validation === 'strong') return 3;
  if (validation === 'moderate') return 2;
  return 1;
}
