import nodetest from 'node:test';
import assert from 'node:assert/strict';
import { classify, redactText, scanText } from '../../src/index.ts';
import { isIP } from '../../src/detectors/ip-address.ts';

const { describe, it } = nodetest;

describe('free text', () => {
  it('finds embedded values with exact offsets', () => {
    const text = 'Donor jane.roe@example.org called from (312) 555-0199 and 415-867-5309; card 4539 1488 0343 6467.';
    const scan = scanText(text);
    const types = scan.spans.map((s) => s.type);
    assert.deepEqual(types, ['EMAIL', 'PHONE_US', 'PHONE_US', 'PAYMENT_CARD']);
    for (const s of scan.spans) assert.ok(text.slice(s.start, s.end).length > 5);
    assert.equal(text.slice(scan.spans[0].start, scan.spans[0].end), 'jane.roe@example.org');
    assert.equal(scan.counts.PHONE_US, 2);
  });

  it('redacts, keeping known test values by default', () => {
    const text = 'Paid with 4242 4242 4242 4242 (test) and 4539 1488 0343 6467. SSN 123-45-6789. Call 415-867-5309 or 312-555-0199.';
    const r = redactText(text);
    assert.match(r.text, /4242 4242 4242 4242/);
    assert.doesNotMatch(r.text, /4539 1488 0343 6467/);
    assert.match(r.text, /\*\*\*\* \*\*\*\* \*\*\*\* 6467/);
    assert.doesNotMatch(r.text, /123-45-6789/);
    assert.doesNotMatch(r.text, /867-5309/);
    assert.match(r.text, /312-555-0199/);
    assert.equal(r.redacted.US_SSN, 1);
    const strict = redactText(text, { keepSynthetic: false, style: 'label' });
    assert.doesNotMatch(strict.text, /4242/);
    assert.match(strict.text, /\[PAYMENT_CARD\]/);
  });

  it('only redacts the requested types', () => {
    const r = redactText('Contact pat@client.com, card 4539148803436467', { types: ['PAYMENT_CARD'] });
    assert.match(r.text, /pat@client\.com/);
    assert.doesNotMatch(r.text, /4539148803436467/);
  });

  it('finds labelled names, addresses and birth dates', () => {
    const text = 'Full name: Maria Lopez\nMailing address: 12 Oak Street, Springfield, IL 62704\nDOB: 1984-02-29\nmy name is Ana and I need help\nfile name: report.csv';
    const r = redactText(text, { style: 'label' });
    assert.match(r.text, /Full name: \[PERSON_NAME\]\n/);
    assert.match(r.text, /Mailing address: \[STREET_ADDRESS\]\n/);
    assert.match(r.text, /DOB: \[DATE_OF_BIRTH\]\n/);
    assert.match(r.text, /my name is \[PERSON_NAME\] and I need help/);
    assert.match(r.text, /file name: report\.csv/);
  });

  it('finds IPs in log lines and tolerates CRLF', () => {
    const text = '2026-11-01T10:00:00Z GET /donate 200 203.0.113.9\r\n2026-11-01T10:00:01Z GET / 500 2001:db8::1\r\n';
    const r = redactText(text, { style: 'label' });
    assert.equal(r.redacted.IP_ADDRESS, 2);
    assert.match(r.text, /200 \[IP_ADDRESS\]\r\n/);
  });

  it('ignores dotted digits in URLs, analytics ids and version strings, but keeps real IPs', () => {
    const noise = [
      'https://example.org/?guci=1.2.0.0.2.2.0.0&x=1',
      'https://example.org/?_ga=2.266443662.107568383.1597066074-473745148.1597066074',
      'https://mail.example.com/mail-1.89.263.11226/client/dereferrer',
      'build_1.87.246.2 released',
      'http://m.facebook.com/'
    ];
    for (const text of noise) assert.equal(redactText(text, { style: 'label' }).redacted.IP_ADDRESS || 0, 0, text);
    const real = ['ip=1.2.3.4', 'from 74.125.79.132.', '74.125.79.132:8080', '[10.0.0.1]', 'http://203.0.113.9/path'];
    for (const text of real) assert.equal(redactText(text, { style: 'label' }).redacted.IP_ADDRESS, 1, text);
  });

  it('drops text past maxChars instead of keeping it unscanned', () => {
    const r = redactText('a'.repeat(50) + ' x@y.com', { maxChars: 40 });
    assert.equal(r.truncated, true);
    assert.doesNotMatch(r.text, /x@y\.com/);
  });

  it('classify runs without node:net', () => {
    const out = classify({ context: { assetId: 'a', assetPath: 'logs', sourceKind: 'csv' }, fields: [{ path: 'client_ip', samples: [{ sampleId: '1', value: '10.0.0.1' }] }] });
    assert.equal(out.fields[0].findings[0].type, 'IP_ADDRESS');
  });
});

describe('isIP', () => {
  it('matches node:net', async () => {
    const net = await import('node:net');
    for (const v of ['1.2.3.4', '256.1.1.1', '01.2.3.4', '::1', '::', 'fe80::1%eth0', '::ffff:192.0.2.1', '1::2::3', '1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8:9', 'abc', '1:']) {
      assert.equal(isIP(v), net.isIP(v), v);
    }
  });
});
