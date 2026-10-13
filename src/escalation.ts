import type { DatasetContext, FieldResult, PiiType } from './contracts.ts';
import type { FieldMeta } from './metadata.ts';
import type { Profile } from './profile.ts';
import type { ResolvedOptions } from './contracts.ts';

export function escalate(
  result: FieldResult,
  meta: FieldMeta,
  profile: Profile,
  context: DatasetContext,
  options: ResolvedOptions
): FieldResult {
  const escalation = [...(result.escalation || [])];
  const observed = profile.usable;
  const requested = context.sampling?.requestedRows ?? 0;
  const cap = options.samplesCap;

  if (result.scanIncomplete) {
    escalation.push({ action: 'manual_review', reason: 'SCAN_INCOMPLETE' });
  }

  if (result.outcome === 'insufficient_data' && requested > 0 && observed < cap) {
    escalation.push({
      action: 'more_samples',
      reason: 'NO_USABLE_VALUES',
      additionalRows: Math.min(options.samplesTarget, cap - observed)
    });
  }

  const strongPossible = result.findings.filter((finding) => finding.status === 'possible');
  const strongHint = meta.hints.some((hint) => hint.weight === 'strong' || hint.weight === 'verified_relation');
  if (result.outcome === 'possible' && strongHint && observed < 256 && observed < cap) {
    escalation.push({
      action: 'more_samples',
      reason: 'STRONG_METADATA_UNCERTAIN',
      additionalRows: Math.min(256, cap) - observed,
      requestedTypes: strongPossible.map((finding) => finding.type)
    });
  }

  const weakSensitive = result.findings.filter(
    (finding) =>
      finding.status === 'likely' &&
      (finding.type === 'PHONE_US' || finding.type === 'PAYMENT_CARD' || finding.type === 'US_SSN')
  );
  if (weakSensitive.length && observed < 128 && observed < cap) {
    escalation.push({
      action: 'more_samples',
      reason: 'LIKELY_NEEDS_CONTEXT',
      additionalRows: Math.min(128, cap) - observed,
      requestedTypes: weakSensitive.map((finding) => finding.type as PiiType)
    });
  } else if (weakSensitive.length && observed >= 128) {
    escalation.push({
      action: 'manual_review',
      reason: 'LIKELY_NEEDS_REVIEW',
      requestedTypes: weakSensitive.map((finding) => finding.type)
    });
  }

  if (!escalation.length) return result;
  return { ...result, escalation };
}
