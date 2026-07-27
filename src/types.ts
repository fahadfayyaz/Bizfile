/** Request body accepted by POST /api/sgp/filings. At least one field required. */
export interface FilingsRequest {
  /** e.g. "UNFOLD PTE. LTD." */
  companyName?: string;
  /** UEN, e.g. "201408775N" */
  companyNumber?: string;
}

/** A single filing row, as required by the brief. */
export interface Filing {
  docName: string;
  /** YYYY-MM-DD */
  filingDate: string;
}

/** Response body of POST /api/sgp/filings. */
export interface FilingsResponse {
  companyName: string;
  companyNumber: string;
  filings: Filing[];
  /** ISO timestamp of when the scrape completed. */
  scrapedAt: string;
}

/** An entity as resolved from a name or UEN lookup. */
export interface ResolvedEntity {
  uen: string;
  /** Full display name, suffix already decoded. */
  name: string;
  status?: string;
}

/** BizFile wraps every response in this envelope. */
export interface BizfileEnvelope<T> {
  status: 'SUCCESS' | 'ERROR';
  result?: T;
  error?: { errorCode?: string; errorDesc?: string; errorField?: string };
  errors?: Array<{ errorCode?: string; errorDesc?: string; errorSummary?: string }>;
}

/** One row from POST /api/extract/v1/ez/extracts/ishop. */
export interface ExtractRow {
  extractId: string;
  entityName: string;
  uen: string;
  transactionDesc: string;
  transactionDescWithAddInfo?: string;
  transactionNo: string;
  /** ISO datetime, e.g. "2025-02-03T17:31:28.227" */
  transactionDate: string;
  lodgedDate?: string;
  pageCount?: number;
  hasAttachments?: boolean;
}

export interface ExtractsResult {
  extracts?: ExtractRow[];
  totalRecords: number;
  pageNumber: number;
  pageSize: number;
}

/** One row from POST /api/infoproduct/v2/ez/entities. */
export interface EntitySearchRow {
  entityProfileId: string;
  entityName: string;
  /** Numeric code that decodes to "PTE. LTD.", "LIMITED", etc. */
  entityNameSuffix: string;
  uen: string;
  entityStatus?: string;
  entityType?: string;
}

export interface EntitySearchResult {
  entities?: EntitySearchRow[];
  resultCount?: number;
  pageNumber?: number;
  pageSize?: number;
}

/** From GET /api/entity/v1/ez/entityInfoIps?uen=... */
export interface EntityInfoResult {
  entityProfiles?: Array<{
    uen: string;
    entityName: string;
    entityNameSuffix?: string;
    entityStatus?: string;
  }>;
  totalCount?: number;
}

export interface CodeTableResult {
  codeTable: string;
  codeList: Array<{ value: string; description: string }>;
}
