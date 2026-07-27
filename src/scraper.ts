import type { Page } from 'playwright-core';
import { callApi } from './bizfile';
import { session } from './browser';
import { config } from './config';
import { CompanyNotFoundError, ValidationError } from './errors';
import type {
  CodeTableResult,
  EntityInfoResult,
  EntitySearchResult,
  ExtractRow,
  ExtractsResult,
  Filing,
  FilingsRequest,
  FilingsResponse,
  ResolvedEntity,
} from './types';

/** A UEN is 9 or 10 characters, digits with a trailing checksum letter. */
const UEN_PATTERN = /^[0-9A-Z]{8,10}$/i;

/**
 * BizFile stores an entity's name split in two: the distinctive part
 * ("UNFOLD") and a numeric suffix code ("311" -> "PTE. LTD."). To match what a
 * user typed we have to rejoin them, so we cache the suffix table.
 */
let suffixMap: Map<string, string> | null = null;

async function getSuffixMap(page: Page): Promise<Map<string, string>> {
  if (suffixMap) return suffixMap;
  const tables = await callApi<CodeTableResult[]>(page, {
    method: 'POST',
    path: '/api/codes/v2/ez/master/tables',
    body: { codeTables: ['suffix'] },
    captcha: false,
  });
  const map = new Map<string, string>();
  for (const t of tables) {
    if (t.codeTable !== 'suffix') continue;
    for (const c of t.codeList) map.set(c.value, c.description);
  }
  suffixMap = map;
  return map;
}

function joinName(name: string, suffixCode: string | undefined, suffixes: Map<string, string>): string {
  const suffix = suffixCode ? (suffixes.get(suffixCode) ?? '') : '';
  return suffix ? `${name} ${suffix}`.trim() : name.trim();
}

/** Compare names the way a human would: ignore case, punctuation and spacing. */
function normalise(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function resolveByUen(page: Page, uen: string): Promise<ResolvedEntity> {
  const result = await callApi<EntityInfoResult>(page, {
    method: 'GET',
    path: `/api/entity/v1/ez/entityInfoIps?uen=${encodeURIComponent(uen)}`,
    captcha: false,
  });

  const profile = result.entityProfiles?.[0];
  if (!profile) {
    throw new CompanyNotFoundError(`No entity on BizFile with UEN "${uen}"`, { uen });
  }

  const suffixes = await getSuffixMap(page);
  return {
    uen: profile.uen,
    name: joinName(profile.entityName, profile.entityNameSuffix, suffixes),
    status: profile.entityStatus,
  };
}

async function resolveByName(page: Page, companyName: string): Promise<ResolvedEntity> {
  const result = await callApi<EntitySearchResult>(page, {
    method: 'POST',
    path: '/api/infoproduct/v2/ez/entities',
    body: {
      matchType: 'NAME-CONTAINING',
      filingAgentNo: '',
      entityStatus: '',
      entityType: '',
      searchKey: companyName,
      issuanceAgency: ['ACRA'],
      ssic: [],
      pageSize: 10,
      pageNumber: 1,
    },
    captcha: true,
  });

  const rows = result.entities ?? [];
  if (rows.length === 0) {
    throw new CompanyNotFoundError(`No entity on BizFile matching "${companyName}"`, { companyName });
  }

  const suffixes = await getSuffixMap(page);
  const candidates = rows.map((r) => ({
    uen: r.uen,
    name: joinName(r.entityName, r.entityNameSuffix, suffixes),
    status: r.entityStatus,
  }));

  const wanted = normalise(companyName);

  // A name search is "contains", so "UNFOLD PTE. LTD." also returns
  // "UNFOLD WORKS" and "UNFOLDING HOLDINGS". Prefer an exact match.
  const exact = candidates.find((c) => normalise(c.name) === wanted);
  if (exact) return exact;

  // Then the case where the suffix was simply omitted from the query.
  const byBareName = candidates.filter((c) => normalise(c.name).startsWith(wanted));
  if (byBareName.length === 1) return byBareName[0];

  if (candidates.length === 1) return candidates[0];

  throw new CompanyNotFoundError(
    `"${companyName}" did not match a single entity. Pass companyNumber (UEN) to disambiguate.`,
    { companyName, candidates },
  );
}

/**
 * The extract categories, fetched once and cached.
 *
 * This matters more than it looks. Sending `extractCategory: ""` does NOT mean
 * "every category" — it quietly behaves like a narrow default and returns a
 * small subset. For UEN 201411189G it returns 2 rows, while sweeping the six
 * real categories returns 96. So the categories have to be enumerated and
 * queried one by one.
 */
let categoryCache: string[] | null = null;

async function getExtractCategories(page: Page): Promise<string[]> {
  if (categoryCache) return categoryCache;
  const table = await callApi<CodeTableResult>(page, {
    method: 'GET',
    path: '/api/codes/v2/ez/extract-category',
    captcha: false,
  });
  categoryCache = table.codeList.map((c) => c.value);
  return categoryCache;
}

/** Walk every page of one category. */
async function fetchCategory(page: Page, uen: string, extractCategory: string): Promise<ExtractRow[]> {
  const rows: ExtractRow[] = [];
  let pageNumber = 1;

  // BizFile's page numbering is 1-based; sending 0 is rejected outright.
  for (;;) {
    const result = await callApi<ExtractsResult>(page, {
      method: 'POST',
      path: '/api/extract/v1/ez/extracts/ishop',
      body: {
        uen,
        period: config.lodgementPeriod,
        extractCategory,
        pageNumber,
        pageSize: config.pageSize,
      },
      captcha: true,
    });

    const batch = result.extracts ?? [];
    rows.push(...batch);

    if (batch.length === 0) break;
    if (rows.length >= (result.totalRecords ?? 0)) break;

    pageNumber += 1;

    // Guard against a server that keeps claiming more records than it serves.
    if (pageNumber > 200) break;
  }

  return rows;
}

/**
 * Every filing for the entity: each category swept in full, then merged.
 *
 * The empty category is included as a safety net in case BizFile ever returns
 * something that is not in the code table. Rows are keyed by extractId, so the
 * overlap costs nothing.
 */
async function fetchAllFilings(page: Page, uen: string): Promise<ExtractRow[]> {
  const categories = await getExtractCategories(page);
  const byId = new Map<string, ExtractRow>();

  for (const category of ['', ...categories]) {
    const rows = await fetchCategory(page, uen, category);
    for (const row of rows) byId.set(row.extractId, row);
  }

  // Newest first. BizFile does not guarantee an order across categories.
  return [...byId.values()].sort((a, b) =>
    (b.transactionDate ?? '').localeCompare(a.transactionDate ?? ''),
  );
}

/** "2025-02-03T17:31:28.227" -> "2025-02-03" */
function toFilingDate(raw: string | undefined): string {
  if (!raw) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return m ? m[1] : '';
}

function toFilings(rows: ExtractRow[]): Filing[] {
  return rows.map((r) => ({
    docName: r.transactionDesc ?? r.transactionDescWithAddInfo ?? '',
    filingDate: toFilingDate(r.transactionDate ?? r.lodgedDate),
  }));
}

function validate(input: FilingsRequest): { companyName?: string; companyNumber?: string } {
  const companyName = input.companyName?.trim() || undefined;
  const companyNumber = input.companyNumber?.trim().toUpperCase() || undefined;

  if (!companyName && !companyNumber) {
    throw new ValidationError('Provide at least one of "companyName" or "companyNumber".');
  }
  if (companyNumber && !UEN_PATTERN.test(companyNumber)) {
    throw new ValidationError(`"${companyNumber}" is not a valid UEN.`, { companyNumber });
  }
  return { companyName, companyNumber };
}

/**
 * Resolve the company, then pull every filing for it.
 *
 * Both steps run inside one queued browser session, so a request never
 * interleaves with another one and the pacing between upstream calls holds.
 */
export async function getFilings(input: FilingsRequest): Promise<FilingsResponse> {
  const { companyName, companyNumber } = validate(input);

  return session.run(async (page) => {
    // A UEN is exact, so prefer it. It also skips a CAPTCHA-guarded endpoint.
    const entity = companyNumber
      ? await resolveByUen(page, companyNumber)
      : await resolveByName(page, companyName!);

    const rows = await fetchAllFilings(page, entity.uen);

    return {
      // The extract rows carry the fully composed legal name; prefer it.
      companyName: rows[0]?.entityName ?? entity.name,
      companyNumber: entity.uen,
      filings: toFilings(rows),
      scrapedAt: new Date().toISOString(),
    };
  });
}
