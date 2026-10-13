export type PiiType =
  | 'EMAIL'
  | 'PHONE_US'
  | 'PAYMENT_CARD'
  | 'US_SSN'
  | 'IBAN'
  | 'IP_ADDRESS'
  | 'DATE_OF_BIRTH'
  | 'PERSON_NAME'
  | 'STREET_ADDRESS'
  | 'POSTAL_CODE'
  | 'PERSON_LINKED_ID';

export type Status = 'pii_detected' | 'possible' | 'not_observed' | 'insufficient_data';

export type FindingStatus = 'confirmed' | 'likely' | 'possible';

export interface FieldInput {
  path: string;
  declaredType?: string;
  nullable?: boolean;
  samples: Array<{ sampleId: string; value: unknown }>;
}

export interface DatasetContext {
  assetId: string;
  assetPath: string;
  sourceKind: 'sql' | 'csv' | 'json' | 'parquet' | 'other';
  regionHints?: string[];
  siblingPaths?: string[];
  relations?: Array<{
    fromField: string;
    toAsset: string;
    toField: string;
    targetIsPerson?: boolean;
  }>;
  tags?: string[];
  sampling?: {
    strategy: 'random' | 'systematic' | 'head' | 'unknown';
    observedRows: number;
    requestedRows?: number;
  };
}

export interface ClassifierRequest {
  context: DatasetContext;
  fields: FieldInput[];
  options?: {
    enableEmbeddedText?: boolean;
    maxCharsPerValue?: number;
    maxExamplesPerFinding?: number;
    samplesTarget?: number;
    samplesCap?: number;
    allowMaskedExamples?: boolean;
  };
}

export interface TypeFinding {
  type: PiiType;
  status: FindingStatus;
  confidenceBand: 'high' | 'medium' | 'low';
  examined: number;
  matchingRows: number;
  validatedRows: number;
  distinctMatches: number;
  examples: string[];
  reasons: string[];
  detectors: string[];
}

export interface FieldResult {
  path: string;
  outcome: Status;
  findings: TypeFinding[];
  evaluatedRows: number;
  nullRows: number;
  unsupportedRows: number;
  truncatedRows: number;
  scanIncomplete: boolean;
  escalation?: Array<{
    action: 'more_samples' | 'manual_review';
    reason: string;
    additionalRows?: number;
    requestedTypes?: PiiType[];
  }>;
}

export interface ClassifierResponse {
  assetId: string;
  classifierVersion: string;
  rulesVersion: string;
  fields: FieldResult[];
}

export type Validation = 'strong' | 'moderate' | 'weak';
export type ContextStrength = 'strong' | 'weak' | 'none';

/** Internal evidence. Never serialised with normalised text. */
export interface Hit {
  path: string;
  sampleId: string;
  type: PiiType;
  detectorId: string;
  validation: Validation;
  context: ContextStrength;
  start: number;
  end: number;
  normalised: string;
  synthetic: boolean;
  reasons: string[];
}

export interface ResolvedOptions {
  enableEmbeddedText: boolean;
  maxCharsPerValue: number;
  maxExamplesPerFinding: number;
  samplesTarget: number;
  samplesCap: number;
  allowMaskedExamples: boolean;
  maxSpansPerValue: number;
}
