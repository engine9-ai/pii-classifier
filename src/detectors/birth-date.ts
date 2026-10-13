import type { Hit, ContextStrength } from '../contracts.ts';

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const US = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export function birthHits(
  path: string,
  sampleId: string,
  text: string,
  allow: boolean,
  context: ContextStrength
): Hit[] {
  if (!allow) return [];
  const parsed = parseBirth(text.trim());
  if (!parsed) return [];
  return [
    {
      path,
      sampleId,
      type: 'DATE_OF_BIRTH',
      detectorId: 'birth-date.v1',
      validation: 'moderate',
      context,
      start: 0,
      end: text.length,
      normalised: parsed,
      synthetic: false,
      reasons: ['DOB_DATE_VALID']
    }
  ];
}

export function parseBirth(value: string): string | null {
  let year: number;
  let month: number;
  let day: number;
  const iso = ISO.exec(value);
  const us = US.exec(value);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
  } else if (/^\d{4}$/.test(value)) {
    year = Number(value);
    if (!plausibleAge(year, 1, 1) || year > todayUtc().year) return null;
    return value;
  } else {
    return null;
  }
  if (!realDate(year, month, day) || !plausibleAge(year, month, day)) return null;
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function realDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function plausibleAge(year: number, month: number, day: number): boolean {
  const today = todayUtc();
  const age = today.year - year - (today.month < month || (today.month === month && today.day < day) ? 1 : 0);
  return age >= 0 && age <= 125;
}

function todayUtc(): { year: number; month: number; day: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}
