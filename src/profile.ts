import type { PreparedField } from './canonicalise.ts';

export interface Profile {
  usable: number;
  nulls: number;
  unsupported: number;
  truncated: number;
  isFreeText: boolean;
  isMixedContent: boolean;
}

export function profileField(field: PreparedField, freeTextName: boolean): Profile {
  let usable = 0;
  let nulls = 0;
  let unsupported = 0;
  let truncated = 0;
  let longProse = 0;
  for (const cell of field.cells) {
    if (cell.kind === 'null') {
      nulls += 1;
      continue;
    }
    if (cell.kind === 'unsupported') {
      unsupported += 1;
      continue;
    }
    usable += 1;
    if (cell.truncated) truncated += 1;
    const tokens = cell.text.trim().split(/\s+/).filter(Boolean);
    if (cell.text.length >= 80 && tokens.length >= 8) longProse += 1;
  }
  const isFreeText = freeTextName || (usable > 0 && longProse / usable >= 0.25);
  return {
    usable,
    nulls,
    unsupported,
    truncated,
    isFreeText,
    isMixedContent: false
  };
}
