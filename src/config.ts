import 'dotenv/config';
import path from 'node:path';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.toLowerCase() === 'true';
}

export interface ProxyConfig {
  server: string;
  username?: string;
  password?: string;
}

/**
 * Accepts the usual http://user:pass@host:port shape and splits it into the
 * form Playwright wants, since Playwright will not read credentials that are
 * embedded in the server URL.
 */
function parseProxy(raw: string | undefined): ProxyConfig | undefined {
  if (!raw || raw.trim() === '') return undefined;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`PROXY_URL is not a valid URL: "${raw}"`);
  }
  const server = `${url.protocol}//${url.host}`;
  return {
    server,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
  };
}

export const config = {
  port: num('PORT', 3000),

  chromeChannel: process.env.CHROME_CHANNEL || 'chrome',
  headless: bool('HEADLESS', false),
  userDataDir: path.resolve(process.env.USER_DATA_DIR || './.browser-profile'),
  proxy: parseProxy(process.env.PROXY_URL),

  pageSettleMs: num('PAGE_SETTLE_MS', 8000),

  lodgementPeriod: process.env.LODGEMENT_PERIOD || '0-5',
  pageSize: num('PAGE_SIZE', 40),
  maxCaptchaRetries: num('MAX_CAPTCHA_RETRIES', 3),
  minRequestGapMs: num('MIN_REQUEST_GAP_MS', 1500),
  // Sweeping seven categories, each paginated, means a company with a lot of
  // filings legitimately takes minutes. 120s was too tight and produced 504s.
  requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 300_000),
} as const;

/** Never log the proxy password. */
export function describeConfig(): Record<string, unknown> {
  return {
    port: config.port,
    chromeChannel: config.chromeChannel,
    headless: config.headless,
    userDataDir: config.userDataDir,
    proxy: config.proxy ? `${config.proxy.server} (auth: ${config.proxy.username ? 'yes' : 'no'})` : 'none',
    lodgementPeriod: config.lodgementPeriod,
    pageSize: config.pageSize,
  };
}
