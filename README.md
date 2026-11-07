# @engine9/pii-classifier

Finds personal data. Classification only: the caller decides what to sample and what to do with the result.

- **`classify(request)`**: what a *field* (a column, a JSON path) holds, from a sample of its values, its name and its neighbours. Returns per-field outcomes (`pii_detected`, `possible`, `not_observed`, `insufficient_data`) with findings per type, masked examples and escalation advice (more samples, manual review).
- **`scanText(text, options)`**: spans of personal data in free text (log lines, notes, email bodies), with exact offsets and masked forms. Names and street addresses only when labelled (`Full name: …`, `Mailing address: …`, `my name is …`).
- **`redactText(text, options)`**: the text with those spans replaced (`style: 'mask'` keeps a hint such as `**** **** **** 6467`; `'label'` writes `[PAYMENT_CARD]`). `types` limits what is redacted; known test values (Stripe test cards, 555 numbers) are kept unless `keepSynthetic: false`.
- **`maskValue(type, value)`**: the masked form of one value.

Types: `EMAIL`, `PHONE_US`, `PAYMENT_CARD`, `US_SSN`, `IBAN`, `IP_ADDRESS`, `DATE_OF_BIRTH`, `PERSON_NAME`, `STREET_ADDRESS`, `POSTAL_CODE`, `PERSON_LINKED_ID`.

```js
import { classify, redactText } from '@engine9/pii-classifier';

classify({
  context: { assetId: 'donors.csv', assetPath: 'donors', sourceKind: 'csv' },
  fields: [{ path: 'email', samples: [{ sampleId: '1', value: 'jane@example.org' }] }],
});
redactText('Call 415-867-5309 about card 4539 1488 0343 6467', { types: ['PAYMENT_CARD'] }).text;
// 'Call 415-867-5309 about card **** **** **** 6467'
```

Not on npm; depend on the repository: `"@engine9/pii-classifier": "github:engine9-ai/pii-classifier"`. The package resolves to `dist/index.js`, a dependency-free ES module bundle of `src/` that runs in Node, Cloudflare Workers and browsers. Types come from `src/`.

## Develop

`src/` is TypeScript run directly by Node 22 (type stripping). `npm test` checks that `dist/` matches `src/` and runs the tests; `npm run build` rebuilds `dist/`. On `main`, the Test workflow rebuilds and commits a stale `dist/` itself.

Used by [`@engine9/folio`](https://github.com/engine9-ai/folio) to summarise data files and logs added to a folio, and to keep card numbers, bank details and SSNs out of folios.
