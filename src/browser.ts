import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { config } from './config';
import { BrowserError } from './errors';

const HOME = 'https://www.bizfile.gov.sg/';

/**
 * One long-lived Chrome session, shared by every request.
 *
 * Two reasons it is a singleton rather than a browser per request:
 *
 *  1. reCAPTCHA v3 is a trust score, and a browser that has been on the site
 *     for a while with real cookies scores better than one that appeared a
 *     second ago. Recreating the browser per request throws that away.
 *  2. Every call is serialised through a queue, which gives us natural pacing.
 *     Hammering BizFile in parallel is the fastest way to get an IP flagged.
 */
class BizfileSession {
  private ctx?: BrowserContext;
  private page?: Page;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;

  /** Serialised access to the page, with a minimum gap between upstream calls. */
  run<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      await this.pace();
      const page = await this.ensurePage();
      try {
        return await fn(page);
      } finally {
        this.lastCallAt = Date.now();
      }
    });
    // Keep the chain alive even when a caller's promise rejects.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async pace(): Promise<void> {
    const wait = config.minRequestGapMs - (Date.now() - this.lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  private async ensurePage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) {
      // The SPA can be navigated away or crash; make sure we are still on the
      // right origin with grecaptcha available before handing the page back.
      const healthy = await this.isHealthy(this.page);
      if (healthy) return this.page;
      await this.reload(this.page);
      return this.page;
    }
    await this.launch();
    return this.page!;
  }

  private async isHealthy(page: Page): Promise<boolean> {
    try {
      if (!page.url().includes('bizfile.gov.sg')) return false;
      return await page.evaluate(() => typeof (window as any).grecaptcha?.execute === 'function');
    } catch {
      return false;
    }
  }

  private async reload(page: Page): Promise<void> {
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await this.waitForRecaptcha(page);
  }

  private async launch(): Promise<void> {
    await this.close();
    try {
      this.ctx = await chromium.launchPersistentContext(config.userDataDir, {
        channel: config.chromeChannel,
        headless: config.headless,
        viewport: { width: 1440, height: 900 },
        // Deliberately NOT setting locale or timezoneId. Playwright applies
        // those through CDP emulation, and the override is itself a signal --
        // a page claiming Asia/Singapore on a machine that is plainly not there
        // scored badly enough that BizFile rejected every token. Inheriting the
        // real machine's locale and timezone is the more honest fingerprint.
        //
        // The flag below removes the obvious `navigator.webdriver` tell. That
        // is the whole of the stealth here; in testing nothing more was needed.
        args: ['--disable-blink-features=AutomationControlled'],
        ...(config.proxy ? { proxy: config.proxy } : {}),
      });
    } catch (err) {
      throw new BrowserError(
        `Could not launch Chrome (channel "${config.chromeChannel}"). Is Chrome installed?`,
        { cause: (err as Error).message },
      );
    }

    this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
    try {
      await this.reload(this.page);
    } catch (err) {
      throw new BrowserError('Could not load bizfile.gov.sg', { cause: (err as Error).message });
    }
  }

  /**
   * The reCAPTCHA script is injected by the SPA after hydration, so the page
   * being "loaded" is not enough. Wait for grecaptcha to actually be callable.
   */
  private async waitForRecaptcha(page: Page): Promise<void> {
    await page.waitForFunction(
      () => typeof (window as any).grecaptcha?.execute === 'function',
      undefined,
      { timeout: 60_000 },
    ).catch(() => {
      throw new BrowserError('reCAPTCHA never initialised on bizfile.gov.sg');
    });

    // grecaptcha being *callable* is not the same as it being *ready to score
    // well*. It keeps collecting signals while the SPA finishes booting, and a
    // token minted the instant the script loads scores materially worse — on a
    // cold profile it gets rejected outright. Letting the page settle first is
    // the difference between a token that passes and one that does not.
    await page.waitForTimeout(config.pageSettleMs);
  }

  async close(): Promise<void> {
    try {
      await this.ctx?.close();
    } catch {
      /* already gone */
    }
    this.ctx = undefined;
    this.page = undefined;
  }
}

export const session = new BizfileSession();
