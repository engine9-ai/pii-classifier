import nodetest from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../src/index.ts';
import { classifyIban } from '../../src/detectors/iban.ts';
import { luhn } from '../../src/detectors/payment-card.ts';

const { describe, it } = nodetest;

function samples(values) {
  return values.map((value, index) => ({ sampleId: String(index), value }));
}

function run(assetPath, fields, context = {}) {
  const observed = Math.max(...fields.map((field) => field.samples.length), 0);
  return classify({
    context: {
      assetId: assetPath,
      assetPath,
      sourceKind: 'sql',
      sampling: { strategy: 'head', observedRows: observed, requestedRows: observed || 64 },
      ...context
    },
    fields
  });
}

function fieldResult(response, path) {
  const field = response.fields.find((item) => item.path === path);
  assert.ok(field, path);
  return field;
}

function finding(response, path, type) {
  return fieldResult(response, path).findings.find((item) => item.type === type);
}

function luhnBody(body) {
  let sum = 0;
  let doubleDigit = true;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    let n = body.charCodeAt(i) - 48;
    if (doubleDigit) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleDigit = !doubleDigit;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

describe('pii classifier', () => {
  it('confirms a column of emails and counts rows once each', () => {
    const emails = Array.from({ length: 128 }, (_, index) => `person${index}@example.com`);
    const response = run('contacts', [{ path: 'contacts.email', samples: samples(emails) }]);
    const email = finding(response, 'contacts.email', 'EMAIL');
    assert.equal(fieldResult(response, 'contacts.email').outcome, 'pii_detected');
    assert.equal(email.status, 'confirmed');
    assert.equal(email.examined, 128);
    assert.equal(email.matchingRows, 128);
    assert.equal(email.validatedRows, 128);
    assert.equal(email.distinctMatches, 128);
    assert.ok(email.reasons.includes('EMAIL_SYNTAX_VALID'));
    assert.equal(JSON.stringify(response).includes('person0@example.com'), false);
  });

  it('confirms one embedded email without calling the column an email column', () => {
    const notes = Array.from({ length: 128 }, () => 'Thanks for writing.');
    notes[40] = 'Please reach me at ada@example.com tomorrow.';
    const response = run('crm.notes', [{ path: 'notes', samples: samples(notes) }]);
    const email = finding(response, 'notes', 'EMAIL');
    assert.equal(email.status, 'confirmed');
    assert.equal(email.examined, 128);
    assert.equal(email.matchingRows, 1);
    assert.equal(email.distinctMatches, 1);
    assert.equal(JSON.stringify(response).includes('ada@example.com'), false);
  });

  it('does not confirm payment cards for Luhn-valid order ids', () => {
    const ids = [luhnBody('400000123456789'), luhnBody('510000123456789'), '1000000000000008', '9999999999999995'];
    assert.equal(luhn(ids[0]), true);
    const response = run('catalog.sku', [{ path: 'order_id', samples: samples(ids) }]);
    const card = finding(response, 'order_id', 'PAYMENT_CARD');
    if (card) assert.notEqual(card.status, 'confirmed');
  });

  it('counts a Luhn-valid card number and rejects an invalid one', () => {
    const valid = luhnBody('400000123456789');
    assert.equal(luhn(valid), true);
    const response = run('billing', [
      { path: 'card_number', samples: samples([valid, '4000001234567890']) }
    ]);
    const card = finding(response, 'card_number', 'PAYMENT_CARD');
    assert.equal(card.status, 'confirmed');
    assert.equal(card.matchingRows, 1);
    assert.equal(card.distinctMatches, 1);
  });

  it('does not treat last4 fields as a full card or SSN', () => {
    const response = run('billing', [
      { path: 'card_last4', samples: samples(['4242']) },
      { path: 'ssn_last4', samples: samples(['6789']) },
      { path: 'last4', samples: samples(['4242']) }
    ]);
    for (const path of ['card_last4', 'ssn_last4', 'last4']) {
      const field = fieldResult(response, path);
      assert.equal(field.findings.some((item) => item.type === 'PAYMENT_CARD' && item.status === 'confirmed'), false);
      assert.equal(field.findings.some((item) => item.type === 'US_SSN'), false);
    }
  });

  it('confirms a labelled SSN and ignores an unformatted tracking number', () => {
    const labelled = run('tax', [{ path: 'ssn', samples: samples(['219-09-9999']) }]);
    assert.equal(finding(labelled, 'ssn', 'US_SSN').status, 'confirmed');
    const tracking = run('ops', [{ path: 'tracking_number', samples: samples(['219099999']) }]);
    const ssn = finding(tracking, 'tracking_number', 'US_SSN');
    if (ssn) assert.notEqual(ssn.status, 'confirmed');
    assert.notEqual(fieldResult(tracking, 'tracking_number').outcome, 'pii_detected');
  });

  it('does not treat ordinary dates as birth dates', () => {
    const response = run('events', [
      { path: 'created_at', samples: samples(['2020-01-15', '2021-05-01']) },
      { path: 'event_date', samples: samples(['03/02/1990']) }
    ]);
    assert.equal(finding(response, 'created_at', 'DATE_OF_BIRTH'), undefined);
    assert.equal(finding(response, 'event_date', 'DATE_OF_BIRTH'), undefined);
  });

  it('classifies dob values from the birth-date rules', () => {
    const one = run('people', [{ path: 'dob', samples: samples(['1990-01-15']) }]);
    assert.equal(finding(one, 'dob', 'DATE_OF_BIRTH').status, 'likely');
    const two = run('people', [{ path: 'date_of_birth', samples: samples(['1990-01-15', '1985-07-04']) }]);
    assert.equal(finding(two, 'date_of_birth', 'DATE_OF_BIRTH').status, 'confirmed');
  });

  it('does not confirm person names for companies, products, or filenames', () => {
    const response = run('catalog', [
      { path: 'company_name', samples: samples(['Jane Doe LLC', 'Acme Inc']) },
      { path: 'product_name', samples: samples(['Ada Lovelace']) },
      { path: 'filename', samples: samples(['Jane Doe.pdf']) }
    ]);
    for (const path of ['company_name', 'product_name', 'filename']) {
      const name = finding(response, path, 'PERSON_NAME');
      if (name) assert.notEqual(name.status, 'confirmed');
      assert.notEqual(fieldResult(response, path).outcome, 'pii_detected');
    }
  });

  it('confirms first_name when several names sit beside an email', () => {
    const response = run('contacts', [
      { path: 'contacts.first_name', samples: samples(['Ada', 'Grace', 'Alan']) },
      { path: 'contacts.email', samples: samples(['a@example.com', 'g@example.com', 'n@example.com']) }
    ]);
    const name = finding(response, 'contacts.first_name', 'PERSON_NAME');
    assert.equal(name.status, 'confirmed');
    assert.ok(name.reasons.includes('PERSON_NAME_FIELD_AND_CONTACT'));
  });

  it('confirms a street when city and postal code are siblings', () => {
    const response = run('attendees', [
      { path: 'attendees[].address.line1', samples: samples(['350 Fifth Avenue', '1600 Pennsylvania Ave']) },
      { path: 'attendees[].address.city', samples: samples(['New York', 'Washington']) },
      { path: 'attendees[].address.postal_code', samples: samples(['10118', '20500']) }
    ]);
    assert.equal(finding(response, 'attendees[].address.line1', 'STREET_ADDRESS').status, 'confirmed');
    assert.equal(finding(response, 'attendees[].address.postal_code', 'POSTAL_CODE').status, 'confirmed');
  });

  it('does not treat a product code of 90210 as a postal code', () => {
    const response = run('catalog', [{ path: 'product_code', samples: samples(['90210']) }]);
    assert.equal(finding(response, 'product_code', 'POSTAL_CODE'), undefined);
    assert.equal(fieldResult(response, 'product_code').outcome, 'not_observed');
  });

  it('keeps an unrelated customer id possible and confirms a verified person relation', () => {
    const loose = run('orders', [{ path: 'customer_id', samples: samples(['6ba7b810-9dad-11d1-80b4-00c04fd430c8']) }]);
    const looseId = finding(loose, 'customer_id', 'PERSON_LINKED_ID');
    assert.equal(looseId.status, 'possible');
    const linked = run(
      'person_email',
      [{ path: 'person_id', samples: samples(['42']) }],
      { relations: [{ fromField: 'person_id', toAsset: 'person', toField: 'id', targetIsPerson: true }] }
    );
    assert.equal(finding(linked, 'person_id', 'PERSON_LINKED_ID').status, 'confirmed');
  });

  it('detects IPv4 and IPv6 without calling them a person id', () => {
    const response = run('logs', [
      { path: 'client_ip', samples: samples(['203.0.113.10', '2001:db8::1']) }
    ]);
    const ip = finding(response, 'client_ip', 'IP_ADDRESS');
    assert.equal(ip.status, 'confirmed');
    assert.equal(ip.matchingRows, 2);
    assert.equal(finding(response, 'client_ip', 'PERSON_LINKED_ID'), undefined);
  });

  it('accepts a supported IBAN and rejects a bad checksum', () => {
    assert.equal(classifyIban('GB82WEST12345698765432'), 'valid');
    const good = run('banks', [{ path: 'iban', samples: samples(['GB82 WEST 1234 5698 7654 32']) }]);
    assert.equal(finding(good, 'iban', 'IBAN').status, 'confirmed');
    const bad = run('banks', [{ path: 'iban', samples: samples(['GB82WEST12345698765433']) }]);
    const rejected = finding(bad, 'iban', 'IBAN');
    assert.equal(rejected.status, 'possible');
    assert.equal(rejected.matchingRows, 0);
  });

  it('confirms an email and a name from an explicit contact phrase', () => {
    const response = run('notes', [
      { path: 'notes', samples: samples(['Contact Jane Doe at jane@example.org about the ticket.']) }
    ]);
    assert.equal(finding(response, 'notes', 'EMAIL').status, 'confirmed');
    assert.equal(finding(response, 'notes', 'PERSON_NAME').status, 'confirmed');
    assert.equal(JSON.stringify(response).includes('jane@example.org'), false);
    assert.equal(JSON.stringify(response).includes('Jane Doe'), false);
  });

  it('asks for more samples when every value is null or a placeholder', () => {
    const values = Array.from({ length: 100 }, (_, index) => (index % 2 ? 'N/A' : null));
    const response = run('contacts', [{ path: 'email', samples: samples(values) }]);
    const field = fieldResult(response, 'email');
    assert.equal(field.outcome, 'insufficient_data');
    assert.equal(field.nullRows, 100);
    assert.ok(field.escalation.some((item) => item.action === 'more_samples'));
  });

  it('marks a very long value truncated and incomplete', () => {
    const response = run('notes', [{ path: 'notes', samples: samples(['x'.repeat(20_000)]) }]);
    const field = fieldResult(response, 'notes');
    assert.equal(field.truncatedRows, 1);
    assert.equal(field.scanIncomplete, true);
    assert.ok(field.escalation.some((item) => item.action === 'manual_review'));
  });

  it('counts repeated emails as many rows and one distinct value', () => {
    const response = run('contacts', [
      { path: 'email', samples: samples(Array.from({ length: 64 }, () => 'ada@example.com')) }
    ]);
    const email = finding(response, 'email', 'EMAIL');
    assert.equal(email.matchingRows, 64);
    assert.equal(email.distinctMatches, 1);
  });

  it('tokenizes camelCase, acronyms, and ambiguous names', () => {
    const response = run('campaigns', [
      { path: 'emailAddress', samples: samples(['ada@example.com']) },
      { path: 'IPAddress', samples: samples(['203.0.113.8']) },
      { path: 'pan', samples: samples(['not-a-card']) },
      { path: 'name', samples: samples(['Annual Report']) },
      { path: 'email_count', samples: samples(['12']) },
      { path: 'email_status', samples: samples(['Subscribed']) }
    ]);
    assert.equal(finding(response, 'emailAddress', 'EMAIL').status, 'confirmed');
    assert.equal(finding(response, 'IPAddress', 'IP_ADDRESS').status, 'confirmed');
    assert.equal(finding(response, 'pan', 'PAYMENT_CARD'), undefined);
    assert.equal(finding(response, 'name', 'PERSON_NAME'), undefined);
    assert.equal(finding(response, 'email_count', 'EMAIL'), undefined);
    assert.equal(finding(response, 'email_status', 'EMAIL'), undefined);

    const person = run('person', [{ path: 'name', samples: samples(['Ada Lovelace']) }]);
    assert.equal(finding(person, 'name', 'PERSON_NAME').status, 'possible');
  });

  it('finishes a hostile digit string without hanging', () => {
    const started = Date.now();
    const response = run('imports', [{ path: 'payload', samples: samples(['9'.repeat(100_000)]) }]);
    assert.ok(Date.now() - started < 1000);
    const field = fieldResult(response, 'payload');
    assert.equal(field.truncatedRows, 1);
    assert.equal(field.scanIncomplete, true);
  });

  it('keeps raw secrets out of the result and recognizes engine9 column names', () => {
    const secrets = {
      email: 'ada@example.com',
      given: 'Ada',
      family: 'Lovelace',
      first: 'Augusta',
      phone: '202-867-5309',
      ssn: '219-09-9999',
      street: '350 Fifth Avenue'
    };
    const response = run('person', [
      { path: 'given_name', samples: samples(['Ada', 'Grace', 'Alan']) },
      { path: 'family_name', samples: samples(['Lovelace', 'Hopper', 'Turing']) },
      { path: 'first_name', samples: samples(['Augusta', 'Grace', 'Alan']) },
      { path: 'email', samples: samples([secrets.email, 'grace@example.com', 'alan@example.com']) },
      { path: 'phone', samples: samples([secrets.phone]) },
      { path: 'street_1', samples: samples([secrets.street]) },
      { path: 'city', samples: samples(['New York']) },
      { path: 'postal_code', samples: samples(['10118']) },
      { path: 'email_hash_v1', samples: samples(['ab'.repeat(32)]) },
      { path: 'ssn', samples: samples([secrets.ssn]) }
    ]);
    assert.equal(finding(response, 'given_name', 'PERSON_NAME').status, 'confirmed');
    assert.equal(finding(response, 'family_name', 'PERSON_NAME').status, 'confirmed');
    assert.equal(finding(response, 'first_name', 'PERSON_NAME').status, 'confirmed');
    assert.equal(finding(response, 'email', 'EMAIL').status, 'confirmed');
    assert.equal(finding(response, 'phone', 'PHONE_US').status, 'confirmed');
    assert.equal(finding(response, 'street_1', 'STREET_ADDRESS').status, 'confirmed');
    assert.equal(finding(response, 'postal_code', 'POSTAL_CODE').status, 'confirmed');
    assert.equal(finding(response, 'ssn', 'US_SSN').status, 'confirmed');
    assert.equal(fieldResult(response, 'email_hash_v1').outcome, 'not_observed');
    const encoded = JSON.stringify(response);
    for (const secret of Object.values(secrets)) {
      assert.equal(encoded.includes(secret), false, secret);
    }
  });
});
