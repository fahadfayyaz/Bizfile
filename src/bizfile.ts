import type { Page } from 'playwright-core';
import { config } from './config';
import { AntiBotError, UpstreamError } from './errors';
import type { BizfileEnvelope } from './types';

export const BASE = 'https://www.bizfile.gov.sg';

/**
 * BizFile's public reCAPTCHA site key, read straight out of the site's own
 * bundle (`/ips/*.js`). It is a public value; it appears in the page source.
 */
export const SITE_KEY = '6LfIEuIqAAAAAPGiSbBEzmpmoZvlNX50t2rtUiow';

/** The header BizFile expects the token in. */
const CAPTCHA_HEADER = 'g-recaptcha-response';

/** BizFile's error code for "your CAPTCHA token was not good enough". */
const SUSPICIOUS_CODE = 'CORELIB-VAL-016';

export interface ApiCall {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Whether this endpoint requires a CAPTCHA token. */
  captcha: boolean;
}

/**
 * Ask Google for a fresh v3 token from inside the real page.
 *
 * Note that tokens are single use: replaying one gets the same "Suspicious
 * attempt detected" rejection as sending none at all. Every call mints a new one.
 */
export async function mintToken(page: Page): Promise<string> {
  const token = await page.evaluate(async (siteKey) => {
    const g = (window as any).grecaptcha;
    if (!g?.execute) return null;
    try {
      await new Promise<void>((resolve) => g.ready(resolve));
      return (await g.execute(siteKey, { action: 'submit' })) as string;
    } catch {
      return null;
    }
  }, SITE_KEY);

  if (!token) throw new AntiBotError('Could not obtain a reCAPTCHA token from the page');
  return token;
}

/**
 * Issue the request from inside the page rather than from Node.
 *
 * This is deliberate. The same request sent with axios/fetch from Node is
 * refused at the edge with a bare 403 no matter which headers you copy, because
 * it is the browser's own TLS and session identity that is being checked. From
 * inside the page it is simply the site calling its own API.
 */
async function rawCall(
  page: Page,
  call: ApiCall,
  token: string | undefined,
): Promise<{ httpStatus: number; text: string }> {
  return page.evaluate(
    async (c) => {
      const headers: Record<string, string> = {};
      if (c.body !== undefined) headers['Content-Type'] = 'application/json';
      if (c.token) headers[c.captchaHeader] = c.token;
      const res = await fetch(c.base + c.path, {
        method: c.method,
        credentials: 'include',
        headers,
        body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
      });
      return { httpStatus: res.status, text: await res.text() };
    },
    {
      base: BASE,
      path: call.path,
      method: call.method,
      body: call.body,
      token,
      captchaHeader: CAPTCHA_HEADER,
    },
  );
}

function isSuspicious(env: BizfileEnvelope<unknown>): boolean {
  if (env.error?.errorCode === SUSPICIOUS_CODE) return true;
  return (env.errors ?? []).some((e) => e.errorCode === SUSPICIOUS_CODE);
}

function describeError(env: BizfileEnvelope<unknown>): string {
  const parts = [env.error?.errorDesc, ...(env.errors ?? []).map((e) => e.errorDesc)];
  const msg = parts.filter(Boolean).join('; ');
  return msg || 'BizFile returned an error with no description';
}

/**
 * Call a BizFile endpoint, minting a fresh CAPTCHA token when the endpoint
 * needs one and retrying with backoff when the token is rejected.
 *
 * A rejected token is not a code fault, it is a low trust score. Retrying does
 * sometimes clear it, but if it persists the caller needs a better IP, which is
 * why the final error says so explicitly instead of just "request failed".
 */
export async function callApi<T>(page: Page, call: ApiCall): Promise<T> {
  let lastMessage = '';

  for (let attempt = 1; attempt <= config.maxCaptchaRetries; attempt += 1) {
    const token = call.captcha ? await mintToken(page) : undefined;
    const { httpStatus, text } = await rawCall(page, call, token);

    let env: BizfileEnvelope<T>;
    try {
      env = JSON.parse(text) as BizfileEnvelope<T>;
    } catch {
      // A non-JSON body here means we were stopped before reaching the API,
      // e.g. an edge/WAF block page.
      throw new UpstreamError(`BizFile returned a non-JSON response (HTTP ${httpStatus})`, {
        httpStatus,
        snippet: text.slice(0, 300),
      });
    }

    if (env.status === 'SUCCESS') {
      if (env.result === undefined) {
        throw new UpstreamError('BizFile reported success but returned no result');
      }
      return env.result;
    }

    lastMessage = describeError(env);

    if (isSuspicious(env)) {
      if (attempt < config.maxCaptchaRetries) {
        // Linear backoff. Going faster after a rejection is exactly what
        // deepens the flag on the IP.
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw new AntiBotError(
        'BizFile rejected the reCAPTCHA token on every attempt. This is a trust score problem, ' +
          'not a code fault: the usual cause is a flagged or datacenter IP. Set PROXY_URL to a ' +
          'residential/ISP proxy, keep HEADLESS=false, and reuse USER_DATA_DIR.',
        { attempts: config.maxCaptchaRetries, bizfileMessage: lastMessage },
      );
    }

    // Any other error is a genuine upstream/validation failure. Retrying it
    // would just be noise.
    throw new UpstreamError(lastMessage, { httpStatus, path: call.path });
  }

  throw new UpstreamError(lastMessage || 'BizFile request failed');
}
