import type { PiiType } from '../contracts.ts';

/**
 * Complete leaf names and tokens. `family_name`, `given_name`, and `street_1`
 * are engine9 columns; `first_name` and the other aliases are the wider set.
 * A hash token on the same field suppresses these metadata hints.
 */
export const STRONG_ALIASES: Record<PiiType, readonly string[]> = {
  EMAIL: ['email', 'email_address', 'contact_email', 'e_mail'],
  PHONE_US: ['phone', 'mobile', 'telephone', 'cell', 'phone_number', 'mobile_phone'],
  US_SSN: ['ssn', 'social_security_number', 'taxpayer_ssn'],
  PAYMENT_CARD: ['card_number', 'credit_card', 'credit_card_number'],
  IBAN: ['iban', 'bank_iban'],
  IP_ADDRESS: ['ip_address', 'client_ip', 'remote_ip', 'ipv4', 'ipv6'],
  DATE_OF_BIRTH: ['dob', 'birth_date', 'date_of_birth', 'birthday'],
  PERSON_NAME: [
    'first_name',
    'last_name',
    'surname',
    'given_name',
    'family_name',
    'middle_name',
    'full_name',
    'person_name'
  ],
  STREET_ADDRESS: [
    'street_address',
    'address_line1',
    'address_line_1',
    'mailing_address',
    'billing_address',
    'street',
    'street_1',
    'street_2',
    'street_3',
    'address_1',
    'address_2'
  ],
  POSTAL_CODE: ['zip_code', 'postal_code', 'postcode'],
  PERSON_LINKED_ID: ['person_id', 'contact_id', 'member_id', 'supporter_id', 'donor_id', 'user_id']
};

export const WEAK_ALIASES: Record<PiiType, readonly string[]> = {
  EMAIL: ['mail'],
  PHONE_US: ['contact_number'],
  US_SSN: ['tax_id'],
  PAYMENT_CARD: ['payment_method', 'pan'],
  IBAN: ['bank_account'],
  IP_ADDRESS: ['ip'],
  DATE_OF_BIRTH: ['birth_year'],
  PERSON_NAME: ['name'],
  STREET_ADDRESS: ['address', 'line1'],
  POSTAL_CODE: ['zip'],
  PERSON_LINKED_ID: ['customer_id']
};

export const NEGATIVE_ALIASES: Record<PiiType, readonly string[]> = {
  EMAIL: ['email_count', 'email_template', 'email_subject', 'email_status'],
  PHONE_US: ['phone_extension', 'phone_type', 'telephone_count'],
  US_SSN: ['ssn_last4', 'ein', 'business_tax_id'],
  PAYMENT_CARD: ['card_last4', 'card_type', 'last4'],
  IBAN: ['bank_name', 'routing_number'],
  IP_ADDRESS: ['ip_count', 'ip_version'],
  DATE_OF_BIRTH: ['created_at', 'modified_at', 'invoice_date', 'event_date', 'birth_count'],
  PERSON_NAME: [
    'company_name',
    'org_name',
    'organization_name',
    'organisation_name',
    'product_name',
    'campaign_name',
    'file_name',
    'filename',
    'display_name'
  ],
  STREET_ADDRESS: ['url_address', 'ip_address', 'email_address'],
  POSTAL_CODE: ['zip_file', 'zip_size'],
  PERSON_LINKED_ID: ['product_id', 'order_id', 'campaign_id']
};

export const FREE_TEXT_TOKENS = new Set([
  'notes',
  'note',
  'description',
  'message',
  'comment',
  'comments',
  'body',
  'free_text'
]);

export const PERSON_ID_LEAVES = new Set(STRONG_ALIASES.PERSON_LINKED_ID);
