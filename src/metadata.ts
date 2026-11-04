import type { DatasetContext, PiiType } from './contracts.ts';
import type { PreparedField } from './canonicalise.ts';
import { normalizeLeaf, tokenizePath } from './canonicalise.ts';
import {
  FREE_TEXT_TOKENS,
  NEGATIVE_ALIASES,
  STRONG_ALIASES,
  WEAK_ALIASES
} from './rules/field-aliases.ts';
import { PERSON_ENTITY_TOKENS } from './rules/person-entities.ts';

export type HintWeight = 'strong' | 'weak' | 'negative' | 'verified_relation';

export interface Hint {
  type: PiiType;
  weight: HintWeight;
  reason: string;
}

const TYPES = Object.keys(STRONG_ALIASES) as PiiType[];

/**
 * Types a number cannot hold. A numeric column named email_open_count or
 * email_delivered is a metric, not an email. Phone, postal code, SSN, card,
 * birth date and person ids can be stored as numbers, so they keep their hints.
 */
const TEXT_ONLY_TYPES = new Set<PiiType>(['EMAIL', 'PERSON_NAME', 'STREET_ADDRESS', 'IP_ADDRESS', 'IBAN']);

export function isNumericDeclaredType(declaredType: string | undefined): boolean {
  return /^\s*(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|number|bit)\b/i.test(
    String(declaredType || '')
  );
}

export interface FieldMeta {
  hints: Hint[];
  freeTextName: boolean;
  hashColumn: boolean;
  addressParent: boolean;
  personContext: boolean;
}

export function fieldMetadata(field: PreparedField, context: DatasetContext): FieldMeta {
  const contextTokens = new Set<string>([
    ...field.tokens,
    ...tokenizePath(context.assetPath || '').tokens,
    ...(context.siblingPaths || []).flatMap((path) => tokenizePath(path).tokens)
  ]);
  const hashColumn = field.tokens.includes('hash');
  const personContext = [...contextTokens].some((token) => PERSON_ENTITY_TOKENS.has(token));
  const addressParent = field.tokens.includes('address') && field.leaf !== 'address';
  const siblingCity = (context.siblingPaths || []).some((path) => tokenizePath(path).tokens.includes('city'));
  const siblingPostal = (context.siblingPaths || []).some((path) => {
    const leaf = tokenizePath(path).leaf;
    return leaf === 'postal_code' || leaf === 'zip_code' || leaf === 'postcode' || leaf === 'zip';
  });
  const paymentContext =
    contextTokens.has('payment') ||
    contextTokens.has('card') ||
    contextTokens.has('billing') ||
    contextTokens.has('invoice');

  const hints: Hint[] = [];
  const numeric = isNumericDeclaredType(field.declaredType);
  if (!hashColumn) {
    for (const type of TYPES) {
      if (numeric && TEXT_ONLY_TYPES.has(type)) continue;
      const hint = hintForType(type, field, {
        personContext,
        addressParent,
        siblingCity,
        siblingPostal,
        paymentContext,
        context
      });
      if (hint) hints.push(hint);
    }
  }

  const relation = (context.relations || []).find(
    (item) => normalizeLeaf(item.fromField) === field.leaf || item.fromField === field.path
  );
  if (relation?.targetIsPerson) {
    hints.push({ type: 'PERSON_LINKED_ID', weight: 'verified_relation', reason: 'RELATION_PERSON' });
  }

  return {
    hints: hints.filter((hint) => hint.weight !== 'negative'),
    freeTextName: field.tokens.some((token) => FREE_TEXT_TOKENS.has(token)),
    hashColumn,
    addressParent,
    personContext
  };
}

function hintForType(
  type: PiiType,
  field: PreparedField,
  ctx: {
    personContext: boolean;
    addressParent: boolean;
    siblingCity: boolean;
    siblingPostal: boolean;
    paymentContext: boolean;
    context: DatasetContext;
  }
): Hint | null {
  if (matchesAlias(field.leaf, NEGATIVE_ALIASES[type])) {
    return { type, weight: 'negative', reason: `META_NEGATIVE_${type}` };
  }

  if (type === 'PAYMENT_CARD' && field.leaf === 'pan') {
    if (!ctx.paymentContext) return null;
    return { type, weight: 'strong', reason: 'META_STRONG_PAYMENT_CARD' };
  }
  if (type === 'PAYMENT_CARD' && field.tokens.includes('pan') && field.tokens.some((token) => token === 'image' || token === 'video')) {
    return { type, weight: 'negative', reason: 'META_NEGATIVE_PAYMENT_CARD' };
  }

  if (matchesAlias(field.leaf, STRONG_ALIASES[type]) || matchesAlias(headLeaf(field.leaf), STRONG_ALIASES[type])) {
    if (type === 'PERSON_LINKED_ID') {
      return { type, weight: 'strong', reason: 'META_PERSON_KEY' };
    }
    return { type, weight: 'strong', reason: `META_STRONG_${type}` };
  }
  // An alias that only modifies the name (email_open_count, email_type) is not what the column holds.
  if (tokenAlias(field.tokens, STRONG_ALIASES[type])) {
    return { type, weight: 'weak', reason: `META_WEAK_${type}` };
  }

  if (type === 'EMAIL' && field.tokens.includes('mail') && ctx.personContext) {
    return { type, weight: 'weak', reason: 'META_WEAK_EMAIL' };
  }
  if (type === 'PERSON_NAME' && field.leaf === 'name') {
    if (ctx.personContext) return { type, weight: 'weak', reason: 'META_WEAK_PERSON_NAME' };
    return null;
  }
  if (type === 'STREET_ADDRESS' && (field.leaf === 'address' || field.leaf === 'line1')) {
    if (ctx.addressParent || ctx.siblingCity || ctx.siblingPostal || field.tokens.includes('address')) {
      return { type, weight: 'weak', reason: 'META_WEAK_STREET_ADDRESS' };
    }
    return null;
  }
  if (type === 'POSTAL_CODE' && field.leaf === 'zip') {
    if (ctx.addressParent || field.tokens.includes('address') || ctx.siblingCity) {
      return { type, weight: 'weak', reason: 'META_WEAK_POSTAL_CODE' };
    }
    return null;
  }
  if (matchesAlias(field.leaf, WEAK_ALIASES[type]) || tokenAlias(field.tokens, WEAK_ALIASES[type])) {
    if (type === 'PERSON_NAME' || type === 'STREET_ADDRESS' || type === 'POSTAL_CODE') return null;
    return { type, weight: 'weak', reason: `META_WEAK_${type}` };
  }
  return null;
}

function matchesAlias(leaf: string, aliases: readonly string[]): boolean {
  return aliases.some((alias) => leaf === alias || leaf.endsWith(`_${alias}`));
}

const TRAILING_QUALIFIERS = new Set([
  'primary',
  'secondary',
  'home',
  'work',
  'personal',
  'business',
  'alt',
  'alternate',
  'other',
  'main',
  'preferred'
]);

/** The leaf without trailing qualifiers and numbers: email_primary and phone_2 hold an email and a phone. */
function headLeaf(leaf: string): string {
  const parts = leaf.split('_');
  while (parts.length > 1 && (TRAILING_QUALIFIERS.has(parts[parts.length - 1]) || /^\d+$/.test(parts[parts.length - 1]))) {
    parts.pop();
  }
  return parts.join('_');
}

function tokenAlias(tokens: string[], aliases: readonly string[]): boolean {
  return aliases.some((alias) => {
    if (alias.includes('_')) return false;
    return tokens.includes(alias);
  });
}

const HINT_RANK: Record<HintWeight, number> = {
  negative: 1,
  weak: 2,
  strong: 3,
  verified_relation: 4
};

export function weightFor(hints: Hint[], type: PiiType): HintWeight | null {
  let best: Hint | null = null;
  for (const hint of hints) {
    if (hint.type !== type) continue;
    if (!best || HINT_RANK[hint.weight] > HINT_RANK[best.weight]) best = hint;
  }
  return best ? best.weight : null;
}
