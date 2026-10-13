import type { ResolvedOptions } from './contracts.ts';
import { LIMITS } from './taxonomy.ts';
import { PLACEHOLDER_TEXT } from './rules/placeholders.ts';

export interface SampleCell {
  sampleId: string;
  kind: 'usable' | 'null' | 'unsupported';
  text: string;
  truncated: boolean;
}

export interface PreparedField {
  path: string;
  leaf: string;
  tokens: string[];
  declaredType?: string;
  cells: SampleCell[];
  conflict: boolean;
}

export function resolveOptions(options: {
  enableEmbeddedText?: boolean;
  maxCharsPerValue?: number;
  maxExamplesPerFinding?: number;
  samplesTarget?: number;
  samplesCap?: number;
  allowMaskedExamples?: boolean;
} = {}): ResolvedOptions {
  return {
    enableEmbeddedText: options.enableEmbeddedText !== false,
    maxCharsPerValue: positive(options.maxCharsPerValue, LIMITS.maxCharsPerValue),
    maxExamplesPerFinding: positive(options.maxExamplesPerFinding, LIMITS.maxExamplesPerFinding),
    samplesTarget: positive(options.samplesTarget, LIMITS.samplesTarget),
    samplesCap: positive(options.samplesCap, LIMITS.samplesCap),
    allowMaskedExamples: options.allowMaskedExamples !== false,
    maxSpansPerValue: LIMITS.maxSpansPerValue
  };
}

function positive(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

/** Split a path into a leaf name and lowercase tokens (camelCase and separators). */
export function tokenizePath(path: string): { leaf: string; tokens: string[] } {
  const segments = String(path)
    .split(/[.[\]]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const leafSource = segments[segments.length - 1] || String(path);
  const leaf = normalizeLeaf(leafSource);
  const tokens = segments.flatMap((segment) => normalizeLeaf(segment).split('_')).filter(Boolean);
  return { leaf, tokens };
}

export function normalizeLeaf(input: string): string {
  return String(input)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_TEXT.has(value.trim().toLowerCase());
}

export function prepareField(
  field: { path: string; declaredType?: string; samples: Array<{ sampleId: string; value: unknown }> },
  options: ResolvedOptions
): PreparedField {
  const { leaf, tokens } = tokenizePath(field.path);
  const seen = new Map<string, string>();
  const cells: SampleCell[] = [];
  let conflict = false;

  for (const sample of field.samples || []) {
    const sampleId = String(sample.sampleId);
    const cell = coerce(sample.value, options.maxCharsPerValue);
    const fingerprint = `${cell.kind}:${cell.text}`;
    const previous = seen.get(sampleId);
    if (previous != null) {
      if (previous !== fingerprint) conflict = true;
      continue;
    }
    seen.set(sampleId, fingerprint);
    cells.push({ sampleId, ...cell });
  }

  return {
    path: field.path,
    leaf,
    tokens,
    declaredType: field.declaredType,
    cells,
    conflict
  };
}

function coerce(value: unknown, maxChars: number): Omit<SampleCell, 'sampleId'> {
  if (value == null) return { kind: 'null', text: '', truncated: false };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { kind: 'unsupported', text: '', truncated: false };
    return bound(value.toISOString().slice(0, 10), maxChars);
  }
  if (typeof value === 'string') {
    if (value.trim() === '' || isPlaceholder(value)) return { kind: 'null', text: '', truncated: false };
    return bound(value, maxChars);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      return { kind: 'unsupported', text: '', truncated: false };
    }
    return bound(String(value), maxChars);
  }
  if (typeof value === 'bigint') return bound(value.toString(), maxChars);
  return { kind: 'unsupported', text: '', truncated: false };
}

function bound(text: string, maxChars: number): Omit<SampleCell, 'sampleId'> {
  if (text.length <= maxChars) return { kind: 'usable', text, truncated: false };
  return { kind: 'usable', text: text.slice(0, maxChars), truncated: true };
}
