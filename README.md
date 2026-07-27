# BizFile Filings Service

A small Node.js / TypeScript service that takes a Singapore company name or UEN, pulls that company's filing extracts from [bizfile.gov.sg](https://www.bizfile.gov.sg), and returns them as structured JSON.

It gets past BizFile's reCAPTCHA **without any third-party CAPTCHA solving service** — no 2Captcha, no CapSolver, no API key. The reasoning is in [Anti-bot approach](#anti-bot-approach) below.

---

## Requirements

- **Node.js 18+**
- **Google Chrome installed** on the machine. The service drives your real Chrome rather than downloading a Chromium build — this matters for the CAPTCHA score, and it is why the install is small and `playwright install` is never needed.

## Install and run

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
npm run build
npm start
```

The server starts on `http://localhost:3000`.

For development with auto-reload:

```bash
npm run dev
```

To regenerate the sample outputs in `./samples`:

```bash
npm run sample
npm run sample -- 196300440G "KODLAND PTE. LTD."   # or specific companies
```

---

## API

### `POST /api/sgp/filings`

Provide **at least one** of the two fields.

```jsonc
{
  "companyName": "ECOMMERCE ENABLERS PTE. LTD.",  // optional
  "companyNumber": "201411189G"                    // optional, UEN
}
```

If both are given, the UEN wins — it is unambiguous and it also skips a CAPTCHA-guarded endpoint, so it is both more reliable and faster.

**200 response**

```json
{
  "companyName": "ECOMMERCE ENABLERS PTE. LTD.",
  "companyNumber": "201411189G",
  "filings": [
    { "docName": "File notice of resolution - Ordinary / Special", "filingDate": "2025-04-09" },
    { "docName": "File notice of resolution - Ordinary / Special", "filingDate": "2025-04-09" }
  ],
  "scrapedAt": "2026-07-26T16:06:38.999Z"
}
```

Every row the extract table shows is returned, unfiltered, exactly as the brief asks. Pagination is followed to the end, so `filings` is the complete set, not just the first page.

### Errors

All failures return the same envelope, never a stack trace:

```json
{ "error": { "code": "COMPANY_NOT_FOUND", "message": "...", "details": { } } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Neither field supplied, or the UEN is malformed |
| 404 | `COMPANY_NOT_FOUND` | No such entity, or the name matched several and none exactly |
| 502 | `UPSTREAM_ERROR` | BizFile answered with an error of its own |
| 503 | `ANTIBOT_BLOCKED` | BizFile rejected the CAPTCHA token on every retry |
| 504 | `TIMEOUT` | The request exceeded `REQUEST_TIMEOUT_MS` |
| 500 | `BROWSER_ERROR` / `INTERNAL_ERROR` | Chrome would not start, or something genuinely unexpected |

A name that matches several entities returns the candidate list, so the caller can retry with a UEN:

```json
{
  "error": {
    "code": "COMPANY_NOT_FOUND",
    "message": "\"UNFOLD\" did not match a single entity. Pass companyNumber (UEN) to disambiguate.",
    "details": {
      "candidates": [
        { "uen": "202207757M", "name": "STUDIO UNFOLD PTE. LTD.", "status": "LIVECO" },
        { "uen": "201408775N", "name": "UNFOLD PTE. LTD.", "status": "SO" }
      ]
    }
  }
}
```

### `GET /health`

Returns `{ "status": "ok", "config": { ... } }`. The proxy password is never included.

---

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `CHROME_CHANNEL` | `chrome` | Use real Chrome. `chromium` or `msedge` also work but score lower |
| `HEADLESS` | `false` | Headless scores lower with reCAPTCHA v3. On a Linux server run headful under Xvfb |
| `USER_DATA_DIR` | `./.browser-profile` | Persistent profile. Reusing it across runs is a large part of the trust score |
| `PAGE_SETTLE_MS` | `8000` | How long to let the page settle before minting a token. Lower it and scores drop |
| `PROXY_URL` | *(unset)* | `http://user:pass@host:port`. Optional locally, effectively required on a server |
| `LODGEMENT_PERIOD` | `0-5` | `0-5` is "Last 5 years". Also `0-1`…`0-4`, `5-10`, `10-25`, `25` |
| `PAGE_SIZE` | `40` | 40 is BizFile's maximum |
| `MAX_CAPTCHA_RETRIES` | `3` | Retries when a token is rejected |
| `MIN_REQUEST_GAP_MS` | `1500` | Minimum spacing between upstream calls |
| `REQUEST_TIMEOUT_MS` | `300000` | Ceiling for one API request. A company with many filings takes minutes |

There is deliberately **no `CAPTCHA_API_KEY`**. Nothing in this project needs one.

---

## Anti-bot approach

### What BizFile actually uses

The Extracts feature lives in a React micro-frontend served from `/ips/remoteEntry.js`. Reading that bundle shows the protection precisely:

- **reCAPTCHA is invisible v3**, site key `6LfIEuIq…` (a public value, present in the page source).
- The token is sent in the **`g-recaptcha-response`** request header.
- Rejection surfaces as BizFile error code **`CORELIB-VAL-016`** — *"Suspicious attempt detected. Try to use the browser you frequently use or use a different device."*

### Why no solver service is used

reCAPTCHA v3 never shows a puzzle. There is no image grid, no audio challenge, nothing a human or a solver farm can complete on your behalf. It silently returns a **score**, and BizFile refuses anything below its threshold.

So a solving service has nothing to solve here. The only way through is to *earn a good score*, which comes down to three things:

1. **A genuine browser.** The service drives real installed Chrome through Playwright (`channel: "chrome"`), not a downloaded Chromium, and clears the most obvious automation flag. In testing this alone was enough — no stealth plugin was required.
2. **A browser with history.** A persistent `USER_DATA_DIR` means Google sees a returning browser with real cookies rather than a fresh sandbox on every run. One long-lived session is shared across all requests for the same reason.
3. **A reputable IP.** This is the one that actually decides it in practice (see below).

### Do not fake the fingerprint you cannot back up

Worth recording, because it cost real time to find: setting Playwright's `locale` and `timezoneId` to `en-SG` / `Asia/Singapore` — which seems like the obvious thing to do when scraping a Singapore site — made every single token get rejected.

Playwright applies those through CDP emulation, and both the override itself and the contradiction it creates (a page insisting it is in Singapore on a machine that plainly is not) are signals. Removing the two lines took the service from failing every request to passing every request, with nothing else changed.

The browser now inherits the real machine's locale and timezone. Consistency beats a fingerprint you have made up.

### Requests are issued from inside the page

The same request sent from Node with axios or `fetch` is refused at the edge with a bare `403`, no matter which headers you copy across — it is the browser's own TLS and session identity being checked, not the header list. So every call is made with `page.evaluate(() => fetch(...))`, from the loaded BizFile origin. To the server it is simply the site calling its own API, with the real cookies and the real TLS fingerprint.

This also means the CAPTCHA token and the API call it authorises always originate from **the same browser and the same IP**. Splitting them across processes is a good way to fail verification.

### Tokens are single-use

A token that has already been spent is rejected exactly like no token at all. Every request mints a fresh one via `grecaptcha.execute(siteKey, { action: "submit" })`. There is no token cache anywhere in this codebase, on purpose.

### Retries, pacing and failure

- A rejected token is retried up to `MAX_CAPTCHA_RETRIES` with linear backoff, minting a new token each time. Speeding up after a rejection is what deepens a flag on the IP, so backoff widens.
- Every upstream call is serialised through a queue with a `MIN_REQUEST_GAP_MS` floor. Concurrent hammering is the fastest way to get an IP flagged.
- Errors that are *not* CAPTCHA-related are not retried — that would just be noise.
- When retries are exhausted the error says what is actually wrong (IP reputation) rather than a generic failure, because that is the only lead worth acting on.

### IP reputation, and deploying to a server

This is the part that decides whether it works in production.

An IP that has been flagged stays flagged, and **datacenter IPs score worst of all** with reCAPTCHA v3. A build that runs perfectly on a home connection can fail on the first request from a cloud VM.

The fix is a **residential or ISP proxy** via `PROXY_URL`. Prefer sticky sessions over per-request rotation: a stable IP builds reputation, while rotating through fresh IPs throws that away every call. This was verified end-to-end through a residential proxy — token minted, both endpoints returned `200`, filings came back.

Note that a proxy is **not** a CAPTCHA solver. It is explicitly on the brief's allowed list, and it introduces no third-party service into the solving path.

---

## Third-party services used

| Service | Used? |
|---|---|
| CAPTCHA solver (2Captcha, CapSolver, …) | **No** |
| Cloud scraping API | **No** |
| Proxy provider | **Optional**, via `PROXY_URL`. Recommended for server deployment |

The only runtime dependencies are `express`, `dotenv` and `playwright-core`.

---

## Sample output

`./samples` contains real responses.

| File | Company | Filings |
|---|---|---|
| `201411189G.json` | ECOMMERCE ENABLERS PTE. LTD. | 98 |
| `196300440G.json` | FRASERS PROPERTY LIMITED | 30 |
| `202245370D.json` | KODLAND PTE. LTD. | 14 |
| `201408775N.json` | UNFOLD PTE. LTD. | 0 |

`201411189G` spans three pages inside one category alone, so it exercises pagination properly.

`201408775N` legitimately has none — it was struck off and its last filing was in 2018, outside the five-year window. It is kept in the samples to show the empty case is handled rather than hidden. It was also resolved **by name**, from a search that returned six similar entities, which is where name matching usually goes wrong.

---

## How it works

```
POST /api/sgp/filings
        |
        v
 validate input  ---------------------------------> 400 VALIDATION_ERROR
        |
        v
 resolve entity
   UEN given  ->  GET  /api/entity/v1/ez/entityInfoIps      (no CAPTCHA)
   name given ->  POST /api/infoproduct/v2/ez/entities      (CAPTCHA)
        |                                                   |
        |                                                   +-> 404 if no single match
        v
 fetch filings: every category, every page
   POST /api/extract/v1/ez/extracts/ishop                   (CAPTCHA, fresh token per page)
        |
        v
 merge, dedupe by extractId, sort newest first
        |
        v
 map rows -> { docName, filingDate }  and return
```

**Categories must be swept individually.** Sending `extractCategory: ""` looks like "no filter", but it is not — it behaves like a narrow default and silently returns a fraction of the data. For UEN `201411189G` it returns **2** rows; sweeping the six real categories returns **98**. The category list is read from `/api/codes/v2/ez/extract-category` rather than hardcoded, each one is paginated to the end, and the results are merged and deduplicated by `extractId`.

A note on name resolution: BizFile stores an entity's name split into the distinctive part (`UNFOLD`) and a numeric suffix code (`311`). The two have to be rejoined via the `suffix` code table before `UNFOLD PTE. LTD.` can be matched, otherwise every lookup by name either misses or picks the wrong company. That table is fetched once and cached.

### Project structure

```
src/
  server.ts    Express app, route, error mapping
  scraper.ts   the BizFile flow: resolve entity, paginate filings, map rows
  bizfile.ts   API layer: token minting, in-page fetch, retry policy
  browser.ts   the long-lived Chrome session and its request queue
  config.ts    environment parsing
  errors.ts    typed errors -> HTTP status codes
  types.ts     request/response and BizFile payload types
scripts/
  sample.ts    regenerates ./samples
samples/       real captured responses
```

---

## Known limitations

- **A flagged IP cannot be fixed in code.** If `ANTIBOT_BLOCKED` persists, the IP is the cause, and a residential proxy is the remedy. No amount of retrying changes the score.
- **Chrome must be installed.** Deliberate — a downloaded Chromium scores measurably worse. On a server this means installing Chrome and, if running headful, Xvfb.
- **Throughput is modest by design.** Requests are serialised with a spacing floor. It protects the IP, but it means this is not built for high-concurrency bulk scraping as it stands. Sweeping seven categories also means a single lookup costs at least eight CAPTCHA-guarded calls — measured at roughly 30s for a company with 98 filings and 13s for one with 14, including Chrome start-up on the first request. Correctness was the priority over speed here; if BizFile ever exposes a genuine "all categories" value, this collapses back to one call per page.
- **One browser session, one IP.** There is no proxy pool. A single `PROXY_URL` is used for the whole process.
- **Name search returns at most 10 candidates.** A very generic name may not include the intended company; pass the UEN in that case.
- **`LODGEMENT_PERIOD` buckets do not overlap.** `5-10` means five-to-ten years ago, not the last ten years. The default `0-5` is what the brief asks for.

## Possible improvements

- A pool of browser sessions, each pinned to its own sticky residential IP, to lift throughput while keeping per-IP pacing intact.
- Persist the resolved name-to-UEN mapping so repeat lookups skip a CAPTCHA-guarded call entirely.
- Expose `lodgementPeriod` as an optional per-request field rather than a process-wide env var.
- A circuit breaker that pauses the whole process for a cooldown after repeated `ANTIBOT_BLOCKED`, instead of continuing to spend requests from an IP that is currently distrusted.
- Prometheus counters for token rejection rate — the single best early warning that an IP's reputation is degrading.
