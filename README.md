# Singapore BizFile Filing Extract Scraper

This project is an AsiaVerify POC for collecting Singapore BizFile filing extract metadata by UEN or exact company name.

The local service exposes:

```text
POST /api/sgp/filings
```

The scraper opens BizFile in headed Chrome, searches the entity, navigates through `More information` > `Information products` > `Extracts`, selects the last five-year lodgement period, paginates through visible extract result cards, and returns filing records as JSON.

## Approach

The primary approach is browser automation through the live BizFile UI.

Tech stack:

- `Node.js` and `Express` for the local API server.
- `puppeteer-real-browser` for browser automation with a real Chrome connection flow.
- Headed Google Chrome with a persistent Chrome profile for session continuity.
- Plain JavaScript/CommonJS to stay close to the existing `Test1` project setup.

Why this stack:

- BizFile is a JavaScript-heavy single-page app, so static HTML scraping is unreliable.
- Search results, entity details, Extracts controls, cards, and pagination load asynchronously.
- Puppeteer lets us wait for real UI elements, loaders, result cards, and pagination state.
- Express gives a simple API wrapper around the browser workflow.

## Search Coverage

The API supports both UEN and company-name search.

UEN input uses BizFile's exact UEN filter:

```text
UEN (including previous UEN)
```

Company-name input uses BizFile's exact name filter:

```text
Name exact match
```

If the request contains `uen`, `companyNumber`, `companyUen`, or `entityNumber`, the scraper selects the UEN filter. If the request contains `companyName`, `entityName`, or `name`, the scraper selects `Name exact match`.

## Project Files

```text
your-project/
|-- src/
|  |-- server.js             # Express API server
|  |-- scraper.js            # Main BizFile automation and scraper
|  `-- index.js              # Manual/debug browser runner
|-- results/
|  |-- bizfile-api-result.json  # Latest scrape result and result history
|  `-- bizfile-ui-debug.json    # Visible DOM/text snapshot if UI parsing fails
|-- www.bizfile.gov.sg.har   # HAR used to understand expected API/UI data
|-- .env.example             # Runtime configuration examples
|-- package.json
`-- README.md
```

## Setup

Install dependencies:

```powershell
npm install
```

Recommended environment variables:

```powershell
$env:PORT="3000"
$env:BIZFILE_URL="https://www.bizfile.gov.sg/"
$env:CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"
$env:CHROME_USER_DATA_DIR="C:/Users/Fahad Fayyaz/AppData/Local/Google/Chrome/User Data/Profile 2"
$env:ACCEPT_LANGUAGE="en-US,en;q=0.9"
$env:MANUAL_CHALLENGE_WAIT_MS="0"
$env:DISABLE_SEARCH_API="false"
$env:DISABLE_EXTRACT_API="true"
$env:ENABLE_EXTRACT_API_FALLBACK="false"
```

`DISABLE_EXTRACT_API=true` and `ENABLE_EXTRACT_API_FALLBACK=false` keep extraction UI-first. The direct Extract API fallback is intentionally disabled by default.

## Change Chrome Profile Path From Command Line

Set `CHROME_USER_DATA_DIR` before starting the API server:

```powershell
$env:CHROME_USER_DATA_DIR="C:/Users/Fahad Fayyaz/AppData/Local/Google/Chrome/User Data/Profile 4"
npm start
```

Use the same pattern for the manual debug runner:

```powershell
$env:CHROME_USER_DATA_DIR="C:/Users/Fahad Fayyaz/AppData/Local/Google/Chrome/User Data/Profile 4"
node .\src\index.js
```

You can also set the Chrome executable path:

```powershell
$env:CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"
```

Use one stable Chrome profile that can open BizFile normally. Avoid switching profiles repeatedly during testing because inconsistent session history can increase suspicious-activity risk.

## Run The API Server

```powershell
npm start
```

Health check:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

## API Call By UEN

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/sgp/filings `
  -ContentType 'application/json' `
  -Body '{"uen":"202133190E"}' | ConvertTo-Json -Depth 10
```

Equivalent UEN fields:

```json
{
  "uen": "202133190E",
  "companyNumber": "202133190E",
  "companyUen": "202133190E",
  "entityNumber": "202133190E"
}
```

## API Call By Company Name

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/sgp/filings `
  -ContentType 'application/json' `
  -Body '{"companyName":"LNG ALPHA SHIPPING PTE. LTD."}' | ConvertTo-Json -Depth 10
```

Equivalent name fields:

```json
{
  "companyName": "LNG ALPHA SHIPPING PTE. LTD.",
  "entityName": "LNG ALPHA SHIPPING PTE. LTD.",
  "name": "LNG ALPHA SHIPPING PTE. LTD."
}
```

## Manual Debug Runner

`src/index.js` is kept as a manual/debug runner:

```powershell
node .\src\index.js
```

This runner opens BizFile in headed Chrome and gives a manual delay before continuing. During debugging, this helped avoid repeated automated search submissions while testing downstream locators and pagination.

Tune the manual delay:

```powershell
$env:MANUAL_SEARCH_DELAY_MS="60000"
node .\src\index.js
```

To allow a manual recovery window when a visible BizFile challenge appears:

```powershell
$env:MANUAL_CHALLENGE_WAIT_MS="120000"
npm start
```

When enabled, the headed Chrome window stays open for that duration. Solve the visible challenge manually, then the scraper rechecks the page and continues if the challenge is gone.

## Output

The API response is returned to the caller and also written to:

```text
results/bizfile-api-result.json
```

The JSON file keeps the latest result at the top level and stores per-company history in `results[]`, so different UEN/company-name runs do not overwrite previous company results.

### Successful Response Example

Actual successful run for `LNG ALPHA SHIPPING PTE. LTD.` / `202133190E` returned 35 filings. Shortened example:

```json
{
  "companyName": "LNG ALPHA SHIPPING PTE. LTD.",
  "companyNumber": "202133190E",
  "filingCount": 35,
  "filings": [
    {
      "docName": "Appointment of Liquidators/Provisional Liquidator",
      "filingDate": "2026-05-20",
      "transactionNo": "T260613248",
      "transactionDate": "2026-05-20",
      "lodgedDate": "",
      "lodgedBy": "LUM CHI LUP BENNY",
      "price": ""
    },
    {
      "docName": "Notice of resolution",
      "filingDate": "2026-05-20",
      "transactionNo": "T260613229",
      "transactionDate": "2026-05-20",
      "lodgedDate": "",
      "lodgedBy": "LUM CHI LUP BENNY",
      "price": ""
    }
  ],
  "message": "Filings scraped successfully.",
  "scrapedAt": "2026-07-08T06:59:03.027Z"
}
```

### No-Data Response Example

One UEN test returned no extract filings for the selected period. This is logged as a valid API result instead of an exception:

```json
{
  "companyName": "UNFOLD PTE. LTD.",
  "companyNumber": "201408775N",
  "filingCount": 0,
  "filings": [],
  "message": "No filings found for the selected lodgement period.",
  "scrapedAt": "2026-07-08T06:51:35.273Z"
}
```

### Error Response Example

When BizFile presents CAPTCHA, suspicious activity, or a security check, the scraper stops and returns a structured error:

```json
{
  "error": "BizFile access challenge detected",
  "details": {
    "stage": "extracts search",
    "challenge": "suspicious activity message detected",
    "screenshot": "Screenshot/bizfile-api-error.png"
  }
}
```

## UI Automation Flow

The automated browser flow is:

1. Open `https://www.bizfile.gov.sg/`.
2. Enter UEN or company name in the search box.
3. Select keyword match type: UEN selects `UEN (including previous UEN)`, company name selects `Name exact match`.
4. Submit search.
5. Click `More information` on the matching result.
6. Click `Information products`.
7. Click `Extracts`.
8. Wait for SPA loaders to disappear and the Extracts form to be visible.
9. Select `Last 5 Years` in `Lodgement period`.
10. Click `Search extracts`.
11. Wait for result cards and pagination to become visible and stable.
12. Select the maximum `Items per page` value.
13. Scrape visible `.extract-results-card` cards.
14. Paginate through all result pages until the visible pagination total is reached.
15. Return JSON and update `results/bizfile-api-result.json`.

## Important UI Locators

Search:

```css
#input-search-bar
#keyword-match-type-dropdown .cmp-dropdown-menu__select
#keyword-match-type-dropdown .cmp-dropdown-menu-select-button
#keyword-match-type-dropdown .cmp-dropdown-list-button
#federated-search-dropdown-bottom-search-btn
```

Entity details:

```css
#button-1
button.wrapper.L1-tab
button.wrapper.L2-tab
```

Extract cards:

```css
[data-testid="extract-results-card"]
.extract-results-card
.extract-result-main .headline-6--bold
.cmp-information-snippet
.cmp-information-snippet_label
.cmp-information-snippet-value-horizontal-container
.extract-price-attachment .headline-6--bold
```

Pagination:

```css
#cmp-pagination-bar
#cmp-pagination-bar-item-per-page
#cmp-pagination-bar-button-page
.page-number-from-to
.total-items-number
.right-arrow-control
.cmp-dropdown-menu__select
.cmp-dropdown-menu-select-button
.cmp-dropdown-list-button
.cmp-dropdown-list-item
```

## Waiting Strategy For BizFile SPA

BizFile loads most content asynchronously. The scraper does not rely on static scraping.

Implemented waits:

- Wait for page loaders, spinners, skeletons, and `aria-busy` states to disappear.
- Wait for specific dropdowns/buttons before clicking.
- Wait for Extract result cards to be visible.
- Wait for transaction snippets inside cards.
- Wait until result-card count and pagination fingerprint are stable before scraping.
- Wait again after each pagination click before reading the next page.

This avoids reading partially rendered React/SPA content.

## API Fallback

The HAR showed BizFile has backend JSON APIs, including an Extracts endpoint:

```text
POST /api/extract/v1/ez/extracts/ishop
```

However, direct backend calls were more likely to trigger suspicious-attempt responses during testing. Because of that, the primary extraction method is headed browser UI interaction.

The Extract API scraper remains in the code as an opt-in fallback only if the UI changes in the future:

```powershell
$env:ENABLE_EXTRACT_API_FALLBACK="true"
```

By default:

```powershell
$env:DISABLE_EXTRACT_API="true"
$env:ENABLE_EXTRACT_API_FALLBACK="false"
```

## Task Constraints And How They Are Handled

### reCAPTCHA

The Extracts search form can be protected by Google reCAPTCHA. During testing, BizFile also returned suspicious-attempt responses from backend endpoints when the session was risk-flagged.

Current handling:

- The scraper does not include an automated CAPTCHA solver.
- It detects CAPTCHA, suspicious-activity, and security-check screens.
- When `MANUAL_CHALLENGE_WAIT_MS` is set, visible challenges can be resolved manually in the open Chrome window before the scraper rechecks the page.
- If no manual wait is configured, or the challenge remains after the wait, it stops the run, saves a screenshot, and returns a structured error instead of retrying aggressively.

Reasoning:

This is a government portal, so the safer POC approach is graceful challenge detection and manual recovery rather than automated CAPTCHA solving or forced bypass.

### Dynamic Rendering And SPA Behaviour

BizFile is a JavaScript-heavy single-page app. Search results, entity details, Extracts form controls, result cards, and pagination all load asynchronously after user actions.

Current handling:

- The scraper waits for visible elements before clicking.
- It waits for loaders, spinners, skeletons, and `aria-busy` states to disappear.
- It waits for Extract result cards to be visible before scraping.
- It waits for transaction snippets inside result cards.
- It waits until result-card count and pagination fingerprint are stable before reading.
- It waits again after each pagination action before scraping the next page.

Reasoning:

Naive static scraping fails because the DOM can exist before React has rendered the real result content.

### Session And Rate Limiting

BizFile tracks browser sessions. Rapid repeated searches, direct backend calls, or repeated failed automation can trigger rate limiting, suspicious-activity screens, or silent empty results.

Current handling:

- The scraper runs one job at a time through an in-process queue.
- It uses a persistent Chrome profile for a stable browser session.
- It uses realistic delays between important actions.
- It avoids repeated retries after challenge screens.
- It can pause for a human to resolve a visible challenge when `MANUAL_CHALLENGE_WAIT_MS` is enabled.
- It treats genuine no-data pages as valid `200` responses with `filingCount: 0`.
- `src/index.js` includes manual delay support for debugging so searches are not repeatedly submitted while fixing later steps.

Reasoning:

Stable session behavior was preferred over IP rotation or rapid retry loops.

### Bot Detection Signals

Standard automation signals can be detected by BizFile.

Current handling:

- The project uses headed Chrome instead of headless mode.
- It uses `puppeteer-real-browser` with `turnstile: true`.
- It removes Puppeteer's default `--enable-automation` launch argument.
- It keeps a real Chrome profile and consistent language headers.
- It adds human-like mouse movement, random hover warmups, and randomized pauses.
- It primarily uses visible UI interaction instead of direct backend API scraping.

Tradeoff:

These measures reduce obvious automation signals, but they do not guarantee non-detection. BizFile can still evaluate profile history, device/IP reputation, CAPTCHA state, request cadence, and interaction patterns.

## Anti-Bot Approach And Tradeoffs

The first attempt used a more traditional Puppeteer stealth setup with a stealth plugin and was checked against a public bot-detection test site to understand basic automation fingerprints.

That approach can still get caught. Puppeteer stealth plugins do not guarantee non-detected automation, and BizFile can still evaluate session history, request cadence, browser profile, CAPTCHA state, IP/device reputation, and interaction patterns.

Because of that, the current implementation uses `puppeteer-real-browser` instead of relying only on the stealth-plugin approach.

To reduce risk and make the flow more realistic, the project uses:

- Headed Chrome rather than headless mode.
- A persistent real Chrome user profile.
- `puppeteer-real-browser` with `turnstile: true`.
- Removal of Puppeteer's default `--enable-automation` launch argument.
- Human-like mouse movement before key interactions.
- Random hover warmups.
- Randomized pauses between interactions.
- SPA-aware element waits instead of blind fast clicking.
- One scrape at a time through an in-process queue.
- Challenge detection for CAPTCHA, suspicious activity, and security-check screens.

The scraper does not attempt to solve or bypass CAPTCHA. If BizFile flags the session, the code stops and returns a structured error.

## IP Rotation And Session Management

During testing, suspicious-activity and rate-limit style responses were encountered. The safer decision was not to rotate IPs aggressively, because random IP rotation can make a government portal session look less consistent.

Current session strategy:

- Use one stable Chrome profile.
- Keep browser behavior headed and visible.
- Avoid repeated retries.
- Queue requests so only one scrape runs at a time.
- Prefer UI scraping over direct backend API calls.
- Use manual debug delays in `src/index.js` while investigating issues.

`PROXY_URL` exists as a Chrome launch option for environments where a legitimate stable proxy is required, but no proxy/IP rotation is enabled by default.

## Debugging Notes

Debug artifacts:

```text
results/bizfile-api-result.json   # latest result and history
Screenshot/bizfile-api-error.png   # screenshot on API scraper failure
Screenshot/bizfile-error.png       # screenshot on manual runner failure
results/bizfile-ui-debug.json     # visible DOM/text snapshot if UI parsing fails
Screenshot/testresult1.png         # manual runner screenshot
server.log
server.err
```

`src/index.js` was intentionally kept for debugging because it allows manual delay before search. This helped validate downstream steps without repeatedly submitting searches while locators, cards, and pagination were being fixed.

## Testing

Static validation:

```powershell
npm test
```

Run server:

```powershell
npm start
```

Restart the server after code changes:

```powershell
Ctrl+C
npm start
```

## What I Would Do Differently With More Time

- Add fixture-based parser tests using saved Extract card HTML and pagination HTML.
- Add typed request/response contracts with TypeScript.
- Add structured per-stage logs and timings.
- Add persistent cooldown/rate-limit state across server restarts.
- Add a cleaner result store instead of only JSON file output.
- Add a controlled test harness for UEN and company-name search flows.
- Add monitoring for selector drift when BizFile changes UI classes.
- Explore an official/approved data access route if available, since that is preferable to automating a government portal.

## Limitations

- BizFile can still show suspicious-activity or CAPTCHA challenges.
- A successful run depends on the Chrome profile/session being in good standing.
- Company-name search uses exact-name matching, so the input must match BizFile's entity name closely.
- The direct Extract API fallback is disabled by default because UI scraping was safer during testing.
