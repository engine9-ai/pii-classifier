import type { PiiType } from './contracts.ts';

export function maskValue(type: PiiType, normalised: string): string {
  switch (type) {
    case 'EMAIL':
      return maskEmail(normalised);
    case 'PHONE_US':
      return maskPhone(normalised);
    case 'US_SSN':
      return maskSsn(normalised);
    case 'PAYMENT_CARD':
      return maskCard(normalised);
    case 'PERSON_NAME':
      return maskName(normalised);
    case 'STREET_ADDRESS':
      return '[address redacted]';
    case 'IBAN':
      return '[IBAN redacted]';
    case 'IP_ADDRESS':
      return '[IP redacted]';
    case 'PERSON_LINKED_ID':
      return '[identifier redacted]';
    case 'POSTAL_CODE':
      return '[postal redacted]';
    case 'DATE_OF_BIRTH':
      return '[date redacted]';
    default:
      return '[redacted]';
  }
}

function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 1) return '[email redacted]';
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const tld = domain.includes('.') ? domain.slice(domain.lastIndexOf('.') + 1) : '';
  const tldPart = /^[a-z]{2,}$/i.test(tld) ? tld.toLowerCase() : '***';
  return `${local.slice(0, 1)}***@***.${tldPart}`;
}

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const last = digits.slice(-4);
  return `${'*'.repeat(Math.max(6, digits.length - 4))}${last}`;
}

function maskSsn(value: string): string {
  const digits = value.replace(/\D/g, '');
  return `***-**-${digits.slice(-4)}`;
}

function maskCard(value: string): string {
  const digits = value.replace(/\D/g, '');
  return `**** **** **** ${digits.slice(-4)}`;
}

function maskName(value: string): string {
  const parts = value.split(/\s+/).filter(Boolean).slice(0, 5);
  if (!parts.length) return '[name redacted]';
  return parts.map((part) => `${part.slice(0, 1).toUpperCase()}***`).join(' ');
}
