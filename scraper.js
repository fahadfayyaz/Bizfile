const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const fs = require('fs')

puppeteer.use(StealthPlugin())

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const resultJsonPath = 'bizfile-api-result.json'

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

const humanPause = (min = 250, max = min) => delay(randomBetween(min, max))

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2
}

function cubicBezier(start, controlA, controlB, end, t) {
  const inverse = 1 - t

  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * controlA.x +
      3 * inverse * t ** 2 * controlB.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * controlA.y +
      3 * inverse * t ** 2 * controlB.y +
      t ** 3 * end.y
  }
}

let lastMousePosition = null

// Moves the mouse to `target` along a curved, eased path instead of
// teleporting there — ported from index.js so the production path
// (server.js -> scraper.js) gets the same treatment the manual test
// script already had.
async function moveMouseLikeHuman(page, target, viewport) {
  const start = lastMousePosition || {
    x: randomBetween(80, Math.max(81, viewport.width - 160)),
    y: randomBetween(80, Math.max(81, viewport.height - 160))
  }

  const distance = Math.hypot(target.x - start.x, target.y - start.y)
  const pointCount = clamp(Math.floor(distance / randomBetween(18, 34)), 14, 48)
  const bend = clamp(distance / randomBetween(4, 8), 25, 160)
  const direction = Math.random() > 0.5 ? 1 : -1
  const perpendicular = {
    x: target.y - start.y,
    y: start.x - target.x
  }
  const magnitude = Math.hypot(perpendicular.x, perpendicular.y) || 1
  const normal = {
    x: (perpendicular.x / magnitude) * bend * direction,
    y: (perpendicular.y / magnitude) * bend * direction
  }
  const controlA = {
    x: start.x + (target.x - start.x) * randomBetween(20, 40) / 100 + normal.x,
    y: start.y + (target.y - start.y) * randomBetween(20, 40) / 100 + normal.y
  }
  const controlB = {
    x: start.x + (target.x - start.x) * randomBetween(60, 85) / 100 - normal.x / 2,
    y: start.y + (target.y - start.y) * randomBetween(60, 85) / 100 - normal.y / 2
  }

  for (let index = 1; index <= pointCount; index += 1) {
    const t = easeInOutSine(index / pointCount)
    const point = cubicBezier(start, controlA, controlB, target, t)
    const jitter = index === pointCount ? 0 : randomBetween(-2, 2)

    await page.mouse.move(
      clamp(point.x + jitter, 10, viewport.width - 10),
      clamp(point.y + jitter, 10, viewport.height - 10)
    )

    await delay(randomBetween(8, 26))
  }

  if (Math.random() < 0.45) {
    await page.mouse.move(
      clamp(target.x + randomBetween(-4, 4), 10, viewport.width - 10),
      clamp(target.y + randomBetween(-3, 3), 10, viewport.height - 10)
    )
  }

  lastMousePosition = target
}

async function getViewportSize(page) {
  return page.evaluate(() => ({
    width: window.innerWidth || 1200,
    height: window.innerHeight || 800
  })).catch(() => ({ width: 1200, height: 800 }))
}

// Wanders the mouse over a handful of visible, plausible elements before the
// "real" action. Used at a few checkpoints (home page load, extracts form)
// to avoid every session looking like: land -> click -> click -> submit.
async function randomHoverWarmup(page, label = 'page') {
  const viewport = await getViewportSize(page)

  const hoverTargets = await page.evaluate(() => {
    const selectors = ['#input-search-bar', 'header a', 'header button', 'nav a', 'nav button', 'button', 'a']

    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const seen = new Set()
    return selectors
      .flatMap(selector => [...document.querySelectorAll(selector)])
      .filter(node => {
        if (!isVisible(node)) return false
        const key = `${node.tagName}:${node.id}:${node.className}:${node.textContent}`.slice(0, 120)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 20)
      .map(node => {
        const rect = node.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      })
  }).catch(() => [])

  const moveCount = randomBetween(4, 7)
  for (let index = 0; index < moveCount; index += 1) {
    const target = hoverTargets.length
      ? hoverTargets[randomBetween(0, hoverTargets.length - 1)]
      : { x: randomBetween(120, Math.max(121, viewport.width - 120)), y: randomBetween(120, Math.max(121, viewport.height - 120)) }

    const x = Math.max(20, Math.min(viewport.width - 20, target.x + randomBetween(-18, 18)))
    const y = Math.max(20, Math.min(viewport.height - 20, target.y + randomBetween(-12, 12)))

    await moveMouseLikeHuman(page, { x, y }, viewport)
    await delay(randomBetween(450, 1400))

    if (Math.random() < 0.2) {
      await page.mouse.wheel({ deltaY: randomBetween(-80, 120) })
      await delay(randomBetween(250, 700))
    }
  }
}

const locators = {
  searchInput: ['#input-search-bar'],
  keywordMatchDropdownButton: [
    '#keyword-match-type-dropdown .cmp-dropdown-menu__select',
    '#keyword-match-type-dropdown .cmp-dropdown-menu-select-button'
  ],
  keywordMatchOptions: ['#keyword-match-type-dropdown .cmp-dropdown-list-button'],
  keywordMatchDropdownValue: ['#keyword-match-type-dropdown .dropdown-value'],
  searchButton: ['#federated-search-dropdown-bottom-search-btn'],
  moreInformationButton: {
    selectors: [
      '#button-1',
      'button#button-1',
      'a#button-1',
      'button.cmp-button.cmp-button--quiet',
      'a.cmp-button.cmp-button--quiet'
    ],
    text: 'More information'
  },
  informationProductsTab: {
    selectors: [
      'button.wrapper.L1-tab',
      'button.L1-tab',
      'button[class*="L1-tab"]',
      '[role="tab"]',
      'button[type="button"]',
      'button .icon-sys-document-document'
    ],
    text: 'Information products'
  },
  extractsTab: {
    selectors: [
      'button.wrapper.L2-tab',
      'button.L2-tab',
      'button[class*="L2-tab"]',
      '[role="tab"]',
      'button[type="button"]'
    ],
    text: 'Extracts'
  },
  lodgementPeriodDropdown: {
    labelText: 'Lodgement period',
    dropdownSelectors: [
      '[id*="lodgement" i] .cmp-dropdown-menu__select',
      '[id*="lodgement" i] .cmp-dropdown-menu-select-button',
      '[class*="lodgement" i] .cmp-dropdown-menu__select',
      'select',
      '.cmp-dropdown-menu__select',
      '.cmp-dropdown-menu-select-button',
      '[role="combobox"]',
      'button[aria-haspopup="listbox"]'
    ],
    optionSelectors: [
      '.cmp-dropdown-list-button',
      '.cmp-dropdown-list-item',
      '[role="option"]',
      'li',
      'button'
    ]
  },
  searchExtractsButton: {
    selectors: [
      '#search-extracts-button',
      '#extracts-search-button',
      'button.cmp-button.cmp-button--primary',
      'button[type="button"]'
    ],
    text: 'Search extracts'
  },
  itemsPerPageDropdown: {
    labelText: 'Items per page',
    dropdownSelectors: [
      '#cmp-pagination-bar-item-per-page .cmp-dropdown-menu__select',
      '#cmp-pagination-bar-item-per-page .cmp-dropdown-menu-select-button',
      '#cmp-pagination-bar .items-per-page .cmp-dropdown-menu__select',
      '#cmp-pagination-bar .items-per-page .cmp-dropdown-menu-select-button',
      '[aria-label*="items per page" i]',
      '[aria-label*="page size" i]',
      '[id*="items" i] .cmp-dropdown-menu__select',
      '[id*="page-size" i] .cmp-dropdown-menu__select',
      '[id*="pagination" i] .cmp-dropdown-menu__select',
      '[class*="pagination" i] .cmp-dropdown-menu__select',
      '[class*="pagination" i] button',
      'select',
      '.cmp-dropdown-menu__select',
      '.cmp-dropdown-menu-select-button',
      '[role="combobox"]',
      'button[aria-haspopup="listbox"]'
    ],
    optionSelectors: [
      '#cmp-pagination-bar-item-per-page .cmp-dropdown-list-button',
      '#cmp-pagination-bar-item-per-page .cmp-dropdown-list-item',
      '.cmp-dropdown-list-button',
      '.cmp-dropdown-list-item',
      '[role="option"]',
      'li',
      'button'
    ]
  }
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeDate(value) {
  const rawValue = String(value || '').trim()
  const match = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`

  const dmyMatch = rawValue.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`

  const monthLookup = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12'
  }

  const dmyMonthMatch = rawValue.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})/)
  if (dmyMonthMatch) {
    const month = monthLookup[dmyMonthMatch[2].toLowerCase()]
    if (month) return `${dmyMonthMatch[3]}-${month}-${dmyMonthMatch[1].padStart(2, '0')}`
  }

  const mdyMonthMatch = rawValue.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/)
  if (mdyMonthMatch) {
    const month = monthLookup[mdyMonthMatch[1].toLowerCase()]
    if (month) return `${mdyMonthMatch[3]}-${month}-${mdyMonthMatch[2].padStart(2, '0')}`
  }

  return ''
}

function getExtractPageSize() {
  const configured = Number(process.env.EXTRACT_PAGE_SIZE || 10)
  if (!Number.isFinite(configured) || configured <= 0) return 10
  return Math.min(Math.max(Math.floor(configured), 1), 10)
}

function isExtractApiFallbackEnabled() {
  return process.env.ENABLE_EXTRACT_API_FALLBACK === 'true' && process.env.DISABLE_EXTRACT_API !== 'true'
}

function normalizeScrapeInput(input = {}) {
  const companyName = normalizeText(input.companyName || input.entityName || input.name)
  const companyNumber = normalizeText(input.companyNumber || input.uen || input.companyUen || input.entityNumber).toUpperCase()

  return {
    companyName,
    companyNumber
  }
}

function dedupeFilings(filings) {
  const seen = new Set()

  return filings
    .map(filing => ({
      ...filing,
      docName: normalizeText(filing.docName),
      filingDate: normalizeDate(filing.filingDate),
      transactionDate: normalizeDate(filing.transactionDate),
      lodgedDate: normalizeDate(filing.lodgedDate)
    }))
    .filter(filing => filing.docName && filing.filingDate)
    .filter(filing => {
      const key = getFilingKey(filing)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function getFilingKey(filing = {}) {
  return filing.extractId || filing.transactionNo || `${normalizeText(filing.docName)}|${normalizeDate(filing.filingDate)}`
}

function mergeFilings(existingFilings = [], newFilings = []) {
  const merged = new Map()

  for (const filing of [...existingFilings, ...newFilings]) {
    const normalized = {
      ...filing,
      docName: normalizeText(filing.docName),
      filingDate: normalizeDate(filing.filingDate),
      transactionDate: normalizeDate(filing.transactionDate),
      lodgedDate: normalizeDate(filing.lodgedDate)
    }
    const key = getFilingKey(normalized)
    if (!key || !normalized.docName || !normalized.filingDate) continue

    merged.set(key, {
      ...(merged.get(key) || {}),
      ...normalized
    })
  }

  return [...merged.values()]
}

function mapExtractToFiling(item = {}) {
  return {
    docName: item.transactionDescWithAddInfo || item.transactionDesc || '',
    filingDate: item.transactionDate || item.lodgedDate || '',
    extractId: item.extractId || '',
    entityName: item.entityName || '',
    uen: item.uen || '',
    transactionNo: item.transactionNo || '',
    transactionDesc: item.transactionDesc || '',
    transactionDescWithAddInfo: item.transactionDescWithAddInfo || '',
    transactionDate: item.transactionDate || '',
    transactionSubType: item.transactionSubType || '',
    lodgedDate: item.lodgedDate || '',
    lodgedBy: item.lodgedBy || '',
    pageCount: Number.isFinite(Number(item.pageCount)) ? Number(item.pageCount) : null,
    hasAttachments: Boolean(item.hasAttachments),
    attachmentCount: Number.isFinite(Number(item.attachmentCount)) ? Number(item.attachmentCount) : 0,
    isCensoredExtractAvailable: Boolean(item.isCensoredExtractAvailable),
    isUnCensoredExtractAvailable: Boolean(item.isUnCensoredExtractAvailable)
  }
}

function mapExtractsToFilings(extracts) {
  return dedupeFilings(extracts.map(mapExtractToFiling))
}

function getTotalRecords(result = {}) {
  const value = [
    result.totalRecords,
    result.totalRecord,
    result.totalRecordCount,
    result.totalCount,
    result.totalElements,
    result.totalItems,
    result.recordCount
  ].find(item => Number.isFinite(Number(item)) && Number(item) >= 0)

  return value === undefined ? null : Number(value)
}

function getExtractKey(item = {}) {
  return item.extractId || item.transactionNo || `${item.transactionDescWithAddInfo || item.transactionDesc || ''}|${item.transactionDate || item.lodgedDate || ''}`
}

function createHttpError(statusCode, message, details) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.details = details
  return error
}

// Confirmed from a HAR capture of the real flow: exactly two endpoints in
// all of BizFile require a g-recaptcha-response token —
// POST /api/infoproduct/v2/ez/entities (entity search) and
// POST /api/extract/v1/ez/extracts/ishop (extracts). Every other GET/POST
// (entity details, fees, filing history, cart, codes) goes through with no
// token at all. The site loads reCAPTCHA via
// `recaptcha/api.js?render=<siteKey>`, which is the programmatic-execute
// integration — grecaptcha.execute(siteKey, { action }) returns a Promise
// with the token directly, no widget click needed. This DOES need the real
// page context though, which is why a bare fetch() from page.evaluate()
// (the previous implementation) could never produce a valid token on its
// own — nothing on the page ever asked reCAPTCHA for one.
const RECAPTCHA_SITE_KEY = '6LfIEuIqAAAAAPGiSbBEzmpmoZvlNX50t2rtUiow'

// NOTE: the `action` value is a guess. Google's reload payload is an opaque
// binary blob, so the exact action string BizFile's JS actually passes
// couldn't be recovered from the HAR. If BizFile validates the action
// server-side and this gets rejected, open the live site's dev tools,
// search the bundled JS for `grecaptcha.execute(`, and swap in the real
// value here — same verify-against-the-live-site step as the other
// ASSUMPTION-flagged selectors in this file.
async function getRecaptchaToken(page, action = 'submit') {
  let token

  try {
    token = await page.evaluate(({ siteKey, action }) => new Promise((resolve, reject) => {
      if (!window.grecaptcha || typeof window.grecaptcha.execute !== 'function') {
        reject(new Error('grecaptcha is not loaded on this page'))
        return
      }

      window.grecaptcha.ready(() => {
        window.grecaptcha.execute(siteKey, { action }).then(resolve).catch(reject)
      })
    }), { siteKey: RECAPTCHA_SITE_KEY, action })
  } catch (error) {
    throw createHttpError(502, 'Failed to obtain a reCAPTCHA token from the page', { reason: error.message, action })
  }

  if (!token) {
    throw createHttpError(502, 'reCAPTCHA token request returned empty', { action })
  }

  return token
}

// HTTP status codes that indicate the request never reached the app at all —
// it was stopped by a WAF/CDN in front of it. 429 specifically means "you are
// going too fast", which is a signal to slow down, not to disguise the traffic.
const CHALLENGE_HTTP_STATUS = {
  429: 'rate_limit',
  403: 'waf_block',
  503: 'waf_block'
}

// Known block/challenge page fingerprints for common WAF/anti-bot vendors.
// Matching by vendor lets the caller log *what* stopped the request instead of
// just "something did", which is what you actually need when deciding whether
// to back off, alert a human, or escalate.
const WAF_SIGNATURES = [
  { vendor: 'Cloudflare', source: 'checking your browser before accessing|attention required.{0,20}cloudflare|cf-browser-verification|ray id\\s*:', flags: 'i' },
  { vendor: 'Akamai', source: 'access denied[\\s\\S]{0,80}reference #\\d', flags: 'i' },
  { vendor: 'Imperva/Incapsula', source: 'incapsula incident id|request unsuccessful\\. incapsula', flags: 'i' },
  { vendor: 'PerimeterX/HUMAN', source: 'please verify you are a human|px-captcha', flags: 'i' },
  { vendor: 'DataDome', source: 'datadome', flags: 'i' }
]

const CAPTCHA_IFRAME_SIGNATURES = [
  { vendor: 'reCAPTCHA', source: '/recaptcha/api2/bframe', flags: 'i' },
  { vendor: 'hCaptcha', source: 'hcaptcha\\.com/captcha', flags: 'i' },
  { vendor: 'Arkose/FunCaptcha', source: 'arkoselabs\\.com|funcaptcha', flags: 'i' }
]

// Same challenge vocabulary as classifyPageChallenge below, but for raw JSON
// error bodies returned by fetch() calls — classifyPageChallenge only reads
// document.body.innerText, so it never sees these. This was the actual gap:
// BizFile's real message is "Suspicious attempt detected", which is NOT the
// same string as 'suspicious activity' that was already being checked for,
// so neither matcher ever caught it.
const API_CHALLENGE_PHRASES = [
  'suspicious attempt',
  'suspicious activity',
  'verify you are human',
  'security check'
]

function classifyApiErrorBody(bodyText = '') {
  const lower = String(bodyText || '').toLowerCase()
  const phrase = API_CHALLENGE_PHRASES.find(candidate => lower.includes(candidate))
  if (!phrase) return null

  return {
    type: 'captcha',
    vendor: 'reCAPTCHA',
    detail: `API error body matched "${phrase}"`,
    retryable: false
  }
}

async function classifyPageChallenge(page) {
  return page.evaluate(({ wafSignatures, captchaSignatures }) => {
    const toRegExp = sig => new RegExp(sig.source, sig.flags)
    const text = String(document.body?.innerText || '')
    const lowerText = text.toLowerCase()

    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const visibleChallengeFrame = [...document.querySelectorAll('iframe')]
      .filter(isVisible)
      .find(frame => {
        const src = String(frame.getAttribute('src') || '')
        const title = String(frame.getAttribute('title') || '').toLowerCase()
        if (title.includes('challenge') || title.includes('captcha challenge')) return true
        return captchaSignatures.some(sig => toRegExp(sig).test(src))
      })

    if (visibleChallengeFrame) {
      const src = String(visibleChallengeFrame.getAttribute('src') || '')
      const match = captchaSignatures.find(sig => toRegExp(sig).test(src))
      return { type: 'captcha', vendor: match ? match.vendor : null, detail: 'visible captcha challenge iframe' }
    }

    const wafMatch = wafSignatures.find(sig => toRegExp(sig).test(text))
    if (wafMatch) return { type: 'waf_block', vendor: wafMatch.vendor, detail: 'WAF/CDN block page text matched' }

    if (lowerText.includes('suspicious attempt')) return { type: 'captcha', vendor: 'reCAPTCHA', detail: 'suspicious attempt message detected' }
    if (lowerText.includes('suspicious activity')) return { type: 'unknown_block', vendor: null, detail: 'suspicious activity message detected' }
    if (lowerText.includes('verify you are human')) return { type: 'captcha', vendor: null, detail: 'human verification message detected' }
    if (lowerText.includes('security check')) return { type: 'unknown_block', vendor: null, detail: 'security check message detected' }

    return null
  }, { wafSignatures: WAF_SIGNATURES, captchaSignatures: CAPTCHA_IFRAME_SIGNATURES }).catch(() => null)
}

async function assertNoAccessChallenge(page, stage) {
  const domChallenge = await classifyPageChallenge(page)
  const lastResponse = page.__lastMainFrameResponse

  let challenge = domChallenge

  // Only fall back to the HTTP-status signal if the DOM didn't already give us
  // a clearer answer (a block page is sometimes served with a 200).
  if (!challenge && lastResponse && CHALLENGE_HTTP_STATUS[lastResponse.status]) {
    challenge = {
      type: CHALLENGE_HTTP_STATUS[lastResponse.status],
      vendor: null,
      detail: `main document response returned HTTP ${lastResponse.status}`
    }
  }

  if (!challenge) return

  throw createHttpError(403, 'BizFile access challenge detected', {
    stage,
    type: challenge.type, // 'captcha' | 'rate_limit' | 'waf_block' | 'unknown_block'
    vendor: challenge.vendor,
    detail: challenge.detail,
    httpStatus: lastResponse?.status ?? null,
    // Only a plain rate-limit response is safe to retry automatically after a
    // cooldown. CAPTCHA/WAF blocks mean "stop and have a human look at this" —
    // hammering them with retries is exactly the wrong response.
    retryable: challenge.type === 'rate_limit',
    screenshot: 'bizfile-api-error.png'
  })
}

function getLaunchOptions() {
  const args = [
    '--start-maximized',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-default-browser-check',
    '--no-first-run'
  ]

  if (process.env.PROXY_URL) {
    args.push(`--proxy-server=${process.env.PROXY_URL}`)
  }

  return {
    headless: false,
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: process.env.CHROME_USER_DATA_DIR || 'C:/Users/Fahad Fayyaz/AppData/Local/Google/Chrome/User Data/Profile 2',
    defaultViewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args
  }
}

async function preparePageForBizFile(page) {
  await page.setExtraHTTPHeaders({
    'Accept-Language': process.env.ACCEPT_LANGUAGE || 'en-US,en;q=0.9'
  })

  page.__lastMainFrameResponse = null
  page.on('response', response => {
    try {
      if (response.request().resourceType() !== 'document') return
      if (response.frame() !== page.mainFrame()) return

      page.__lastMainFrameResponse = {
        status: response.status(),
        url: response.url(),
        headers: response.headers()
      }
    } catch (error) {
      // Frame/response can be torn down mid-navigation; the next successful
      // navigation will overwrite this, so it's safe to ignore.
    }
  })
}

async function waitForVisibleSelector(page, selectors, label, timeout = 30000) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const element = await page.$(selector)
      if (!element) continue

      const visible = await element.evaluate(node => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      })

      if (visible) return element
    }

    await humanPause(220, 520)
  }

  throw createHttpError(502, `${label} not found`, { selectors })
}

async function clickFirstVisible(page, selectors, label, timeout = 30000) {
  const element = await waitForVisibleSelector(page, selectors, label, timeout)
  await element.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }))
  await humanPause(300, 900)

  const box = await element.boundingBox().catch(() => null)
  if (box) {
    const viewport = await getViewportSize(page)
    await moveMouseLikeHuman(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, viewport)
    await humanPause(80, 220)
  }

  try {
    await element.click({ delay: randomBetween(45, 140) })
  } catch (error) {
    await element.evaluate(node => node.click())
  }
}

async function clickByText(page, locator, label, timeout = 30000) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const clicked = await page.evaluate(({ selectors, text }) => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const expectedText = normalize(text)

      const isVisible = node => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }

      const candidates = []

      for (const selector of selectors) {
        try {
          candidates.push(...document.querySelectorAll(selector))
        } catch (error) {
          // Ignore selector variants unsupported by the current browser.
        }
      }

      const target = candidates.find(node => {
        const clickable = node.closest('button, a, [role="button"]') || node
        const targetText = normalize(`${node.innerText || node.textContent} ${clickable.innerText || clickable.textContent}`)
        return isVisible(clickable) && targetText.includes(expectedText)
      })

      if (!target) return false

      const clickable = target.closest('button, a, [role="button"]') || target
      clickable.scrollIntoView({ block: 'center', inline: 'center' })
      clickable.click()
      return true
    }, locator)

    if (clicked) return
    await humanPause(220, 520)
  }

  throw createHttpError(502, `${label} not found`, { text: locator.text })
}

async function clickOptionByText(page, optionSelectors, optionTexts, label, timeout = 30000) {
  const texts = Array.isArray(optionTexts) ? optionTexts : [optionTexts]
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const clicked = await page.evaluate(({ optionSelectors, texts }) => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const expectedTexts = texts.map(normalize)

      const isVisible = node => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }

      const candidates = []

      for (const selector of optionSelectors) {
        try {
          candidates.push(...document.querySelectorAll(selector))
        } catch (error) {
          // Ignore selector variants unsupported by the current browser.
        }
      }

      const target = candidates.find(node => {
        const text = normalize(node.innerText || node.textContent)
        return isVisible(node) && expectedTexts.some(expectedText => text.includes(expectedText))
      })

      if (!target) return false

      const clickable = target.closest('button, a, [role="option"], [role="button"], li') || target
      clickable.scrollIntoView({ block: 'center', inline: 'center' })
      clickable.click()
      return true
    }, { optionSelectors, texts })

    if (clicked) return
    await humanPause(220, 520)
  }

  throw createHttpError(502, `${label} option not found`, { optionTexts: texts })
}

async function clickDropdownNearLabel(page, dropdown, label, timeout = 30000) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const clicked = await page.evaluate(dropdown => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const expectedLabel = normalize(dropdown.labelText)

      const isVisible = node => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }

      const candidates = []

      for (const selector of dropdown.dropdownSelectors) {
        try {
          candidates.push(...document.querySelectorAll(selector))
        } catch (error) {
          // Ignore selector variants unsupported by the current browser.
        }
      }

      const labelNodes = [...document.querySelectorAll('label, span, div, p')]
        .filter(isVisible)
        .filter(node => {
          const text = normalize(node.innerText || node.textContent)
          return text.includes(expectedLabel) && text.length < 140
        })

      const scored = candidates
        .map(node => {
          const clickable = node.closest('button, [role="button"], [role="combobox"], select') || node
          if (!isVisible(clickable)) return null

          const rect = clickable.getBoundingClientRect()
          let score = 0
          let current = clickable

          for (let depth = 0; current && depth < 8; depth += 1) {
            const text = normalize(current.innerText || current.textContent)
            if (text.includes(expectedLabel)) score += 400 - depth * 25
            current = current.parentElement
          }

          for (const labelNode of labelNodes) {
            const labelRect = labelNode.getBoundingClientRect()
            const verticalDistance = Math.abs(rect.top - labelRect.bottom)
            const horizontalDistance = Math.abs(rect.left - labelRect.left)

            if (verticalDistance < 180) {
              score += Math.max(0, 300 - verticalDistance - horizontalDistance / 10)
            }
          }

          return { clickable, score }
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)

      const target = scored.find(item => item.score > 0)?.clickable
      if (!target) return false

      target.scrollIntoView({ block: 'center', inline: 'center' })
      target.click()
      return true
    }, dropdown)

    if (clicked) return
    await humanPause(220, 520)
  }

  throw createHttpError(502, `${label} dropdown not found`, { labelText: dropdown.labelText })
}

async function selectDropdownOption(page, dropdown, optionTexts, label) {
  await clickDropdownNearLabel(page, dropdown, label)
  await humanPause(450, 1200)
  await clickOptionByText(page, dropdown.optionSelectors, optionTexts, label)
}

async function selectItemsPerPageMax(page) {
  const opened = await page.evaluate(() => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const wrapper = document.querySelector('#cmp-pagination-bar-item-per-page')
    if (!wrapper) return false

    const target = wrapper.querySelector('select, .cmp-dropdown-menu__select, .cmp-dropdown-menu-select-button, [role="button"]')
    if (!target || !isVisible(target)) return false

    if (target.tagName === 'SELECT') {
      const option = [...target.options]
        .map(option => ({
          option,
          number: Number((option.textContent || option.value || '').match(/\d+/)?.[0] || 0)
        }))
        .filter(item => item.number > 0)
        .sort((a, b) => b.number - a.number)[0]

      if (!option) return false

      target.value = option.option.value
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }

    target.scrollIntoView({ block: 'center', inline: 'center' })
    target.click()
    return true
  })

  if (!opened) return false

  await humanPause(450, 1200)

  const selected = await page.evaluate(() => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const wrapper = document.querySelector('#cmp-pagination-bar-item-per-page')
    if (!wrapper) return ''

    const options = [...wrapper.querySelectorAll('.cmp-dropdown-list-button, .cmp-dropdown-list-item, [role="option"], button')]
      .filter(isVisible)
      .map(node => ({
        node,
        text: String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
        number: Number(String(node.innerText || node.textContent || '').match(/\d+/)?.[0] || 0)
      }))
      .filter(item => item.number > 0)
      .sort((a, b) => b.number - a.number)

    if (!options.length) return ''

    const clickable = options[0].node.closest('button, a, [role="option"], [role="button"], li') || options[0].node
    clickable.scrollIntoView({ block: 'center', inline: 'center' })
    clickable.click()
    return options[0].text
  })

  return Boolean(selected)
}

async function typeSearchValue(page, value) {
  await clickFirstVisible(page, locators.searchInput, 'BizFile search input', 60000)

  const currentValue = await page.$eval(locators.searchInput[0], input => input.value)
  if (currentValue === value) return

  await page.keyboard.down('Control')
  await page.keyboard.press('A')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(value, { delay: randomBetween(55, 145) })
}

async function selectUenFilter(page) {
  await clickFirstVisible(page, locators.keywordMatchDropdownButton, 'Keyword match type dropdown')
  await clickByText(
    page,
    { selectors: locators.keywordMatchOptions, text: 'UEN (including previous UEN)' },
    'UEN filter option'
  )

  await page.waitForFunction(
    selector => document.querySelector(selector)?.innerText.includes('UEN'),
    { timeout: 10000 },
    locators.keywordMatchDropdownValue[0]
  )
}

async function selectNameExactMatchFilter(page) {
  await clickFirstVisible(page, locators.keywordMatchDropdownButton, 'Keyword match type dropdown')
  await clickByText(
    page,
    { selectors: locators.keywordMatchOptions, text: 'Name exact match' },
    'Name exact match filter option'
  )

  await page.waitForFunction(
    selector => /name\s+exact\s+match/i.test(document.querySelector(selector)?.innerText || ''),
    { timeout: 10000 },
    locators.keywordMatchDropdownValue[0]
  )
}

async function ensureUenFilterSelected(page) {
  const selectedValue = await page.$eval(
    locators.keywordMatchDropdownValue[0],
    element => String(element.innerText || element.textContent || '')
  ).catch(() => '')

  if (selectedValue.includes('UEN')) return

  await selectUenFilter(page)
}

async function ensureNameExactMatchFilterSelected(page) {
  const selectedValue = await page.$eval(
    locators.keywordMatchDropdownValue[0],
    element => String(element.innerText || element.textContent || '')
  ).catch(() => '')

  if (/name\s+exact\s+match/i.test(selectedValue)) return

  await selectNameExactMatchFilter(page)
}

function normalizeEntityNameForMatch(value) {
  return normalizeText(value)
    .replace(/[.,]/g, '')
    .replace(/\bPRIVATE\s+LIMITED\b/gi, 'PTE LTD')
    .replace(/\bPTE\s+LTD\b/gi, 'PTE LTD')
    .replace(/\bLIMITED\b/gi, 'LTD')
    .toUpperCase()
}

function getEntityDisplayName(entity = {}) {
  return normalizeText([
    entity.entityName,
    entity.suffixDescription,
    entity.entityNameSuffixDesc,
    entity.entityNameSuffixDescription
  ].filter(Boolean).join(' '))
}

async function getEntityMatchTypeOptions(page) {
  const response = await page.evaluate(async () => {
    const res = await fetch('/api/infoproduct/v2/ez/configurations/entities', {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' }
    })

    const text = await res.text()
    let data = null

    try {
      data = JSON.parse(text)
    } catch (error) {
      // Return body preview for diagnostics.
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      bodyPreview: text.slice(0, 500)
    }
  })

  if (!response.ok || !response.data) return []

  const result = response.data.result
  if (Array.isArray(result)) return result
  if (Array.isArray(result?.matchTypeOptions)) return result.matchTypeOptions
  if (Array.isArray(result?.matchTypes)) return result.matchTypes
  if (Array.isArray(result?.keywordMatchTypes)) return result.keywordMatchTypes
  if (Array.isArray(result?.entityMatchType)) return result.entityMatchType

  return Object.values(result || {}).flatMap(value => Array.isArray(value) ? value : [])
}

function getOptionCode(option = {}) {
  return normalizeText(option.code || option.value || option.id || option.key || option.matchType)
}

function getOptionText(option = {}) {
  return normalizeText([
    option.desc,
    option.description,
    option.label,
    option.name,
    option.text,
    option.displayName,
    getOptionCode(option)
  ].filter(Boolean).join(' '))
}

async function resolveSearchMatchType(page, input) {
  if (input.companyNumber) return 'UEN-EXACT-MATCH'

  const configured = normalizeText(process.env.COMPANY_NAME_MATCH_TYPE)
  if (configured) return configured

  const options = await getEntityMatchTypeOptions(page).catch(() => [])
  const scored = options
    .map(option => {
      const code = getOptionCode(option)
      const text = getOptionText(option)
      const searchable = `${code} ${text}`.toLowerCase()
      let score = 0

      if (!code) return null
      if (searchable.includes('uen')) score -= 100
      if (searchable.includes('name')) score += 40
      if (searchable.includes('entity')) score += 20
      if (searchable.includes('company')) score += 20
      if (searchable.includes('exact')) score += 60
      if (searchable.includes('including previous')) score -= 20

      return { code, score, text }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)

  const selected = scored.find(item => item.score > 0)
  if (selected) {
    console.log(`Using BizFile company-name match type: ${selected.code} (${selected.text})`)
    return selected.code
  }

  return 'ENTITY_NAME'
}

async function searchEntityViaApi(page, input) {
  const searchKey = input.companyNumber || input.companyName
  if (!searchKey) throw createHttpError(502, 'BizFile search API fallback requires a UEN or company name')

  // This endpoint requires a fresh g-recaptcha-response token (see
  // RECAPTCHA_SITE_KEY comment above) — this was previously missing, which
  // is why this fallback was getting rejected as a "suspicious attempt"
  // regardless of how the browser session looked.
  const recaptchaToken = await getRecaptchaToken(page, 'search')
  const matchType = await resolveSearchMatchType(page, input)

  const response = await page.evaluate(async ({ searchKey, matchType, recaptchaToken }) => {
    const res = await fetch('/api/infoproduct/v2/ez/entities', {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'g-recaptcha-response': recaptchaToken
      },
      body: JSON.stringify({
        matchType,
        filingAgentNo: '',
        entityStatus: '',
        entityType: '',
        searchKey,
        issuanceAgency: ['ACRA'],
        ssic: [],
        pageSize: 10,
        pageNumber: 1
      })
    })

    const text = await res.text()
    let data = null

    try {
      data = JSON.parse(text)
    } catch (error) {
      // Return body preview below for diagnostics.
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      bodyPreview: text.slice(0, 500)
    }
  }, { searchKey, matchType, recaptchaToken })

  if (!response.ok || !response.data) {
    const challenge = classifyApiErrorBody(response.bodyPreview)
    if (challenge) {
      throw createHttpError(403, 'BizFile access challenge detected', {
        stage: 'entity search api fallback',
        ...challenge,
        httpStatus: response.status,
        bodyPreview: response.bodyPreview
      })
    }

    throw createHttpError(502, 'BizFile entity search API request failed', {
      httpStatus: response.status,
      bodyPreview: response.bodyPreview
    })
  }

  const entities = response.data.result?.entities || []
  const expectedName = normalizeEntityNameForMatch(input.companyName)
  const exactEntity = input.companyNumber
    ? entities.find(entity => entity.uen === input.companyNumber) || entities[0]
    : entities.find(entity => normalizeEntityNameForMatch(getEntityDisplayName(entity)) === expectedName) ||
      entities.find(entity => normalizeEntityNameForMatch(entity.entityName) === expectedName)

  if (!exactEntity) {
    throw createHttpError(404, 'Company not found in BizFile search API results')
  }

  return {
    companyNumber: exactEntity.uen,
    companyName: getEntityDisplayName(exactEntity) || normalizeText(exactEntity.entityName)
  }
}

async function gotoEntityDetails(page, companyNumber) {
  const baseUrl = String(process.env.BIZFILE_URL || 'https://www.bizfile.gov.sg/').replace(/\/+$/, '')
  await page.goto(`${baseUrl}/buy-info/entity-details/${encodeURIComponent(companyNumber)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  })
  await waitForEntityDetails(page)
}

async function searchEntity(page, input) {
  const searchValue = input.companyNumber || input.companyName
  await page.goto(process.env.BIZFILE_URL || 'https://www.bizfile.gov.sg/', {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  })

  await assertNoAccessChallenge(page, 'home')
  await delay(5000)
  await randomHoverWarmup(page, 'home page')
  await typeSearchValue(page, searchValue)
  await humanPause(900, 2200)

  if (input.companyNumber) {
    await ensureUenFilterSelected(page)
    await typeSearchValue(page, input.companyNumber)
    await ensureUenFilterSelected(page)
  } else if (input.companyName) {
    await ensureNameExactMatchFilterSelected(page)
    await typeSearchValue(page, input.companyName)
    await ensureNameExactMatchFilterSelected(page)
  }

  try {
    await clickFirstVisible(page, locators.searchButton, 'BizFile search button')
    await assertNoAccessChallenge(page, 'search submit')
    await waitForSearchResults(page)
    await assertNoAccessChallenge(page, 'search results')
    return { directEntityDetails: false }
  } catch (error) {
    if (error.statusCode === 403 || !input.companyNumber || process.env.DISABLE_SEARCH_API === 'true') {
      throw error
    }

    console.warn(`BizFile UI search failed: ${error.message}. Falling back to BizFile entity search API.`)
    const entity = await searchEntityViaApi(page, input)
    await gotoEntityDetails(page, entity.companyNumber)

    return {
      directEntityDetails: true,
      entity
    }
  }
}

async function waitForSearchResults(page) {
  try {
    await page.waitForFunction(() => {
      const text = document.body?.innerText || ''
      const lowerText = text.toLowerCase()

      return (
        location.href.includes('/buy-info/search/results') ||
        text.includes('More information') ||
        lowerText.includes('no result') ||
        lowerText.includes('suspicious attempt') ||
        lowerText.includes('suspicious activity') ||
        lowerText.includes('verify you are human') ||
        lowerText.includes('security check')
      )
    }, { timeout: 60000 })
  } catch (error) {
    throw createHttpError(502, 'Timed out waiting for BizFile search results')
  }

  const noResults = await page.evaluate(() => {
    const text = String(document.body?.innerText || '').toLowerCase()
    return text.includes('no result') || text.includes('no matching')
  })

  if (noResults) {
    throw createHttpError(404, 'Company not found in BizFile search results')
  }
}

async function clickMatchingMoreInformation(page, input) {
  await assertNoAccessChallenge(page, 'before more information')
  const clicked = await page.evaluate(input => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const companyNumber = normalize(input.companyNumber)
    const companyName = normalize(input.companyName)

    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const containers = [...document.querySelectorAll('article, li, section, div')]
      .filter(isVisible)
      .filter(node => {
        const text = normalize(node.innerText || node.textContent)
        return (
          (companyNumber && text.includes(companyNumber)) ||
          (companyName && text.includes(companyName))
        )
      })

    const container = containers[0] || document.body
    const buttons = [...container.querySelectorAll('button, a')]
    const moreInformation = buttons.find(node => normalize(node.innerText || node.textContent).includes('more information'))

    if (!moreInformation) return false

    moreInformation.scrollIntoView({ block: 'center', inline: 'center' })
    moreInformation.click()
    return true
  }, input)

  if (clicked) return

  await clickByText(page, locators.moreInformationButton, 'More information button')
}

async function waitForEntityDetails(page) {
  try {
    await page.waitForFunction(() => {
      const text = document.body?.innerText || ''
      const lowerText = text.toLowerCase()

      return (
        location.href.includes('/buy-info/entity-details/') ||
        text.includes('Information products') ||
        lowerText.includes('suspicious attempt') ||
        lowerText.includes('suspicious activity') ||
        lowerText.includes('verify you are human') ||
        lowerText.includes('security check')
      )
    }, { timeout: 60000 })
  } catch (error) {
    throw createHttpError(502, 'Timed out waiting for Entity Details page')
  }

  await assertNoAccessChallenge(page, 'entity details')
}

async function openExtracts(page) {
  await assertNoAccessChallenge(page, 'before information products')
  await clickByText(page, locators.informationProductsTab, 'Information products tab')
  await page.waitForFunction(() => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    return [...document.querySelectorAll('button, [role="tab"], [role="button"]')]
      .some(node => isVisible(node) && /extracts/i.test(node.innerText || node.textContent || ''))
  }, { timeout: 60000 }).catch(() => {
    throw createHttpError(502, 'Information products tab opened, but Extracts tab did not appear')
  })

  await clickByText(page, locators.extractsTab, 'Extracts tab')

  await waitForLoadersToDisappear(page, 'Extracts form')
  await assertNoAccessChallenge(page, 'extracts form')

  try {
    await page.waitForFunction(() => {
      const text = document.body?.innerText || ''
      return text.includes('Lodgement period') || text.includes('Extract category') || text.includes('Search extracts')
    }, { timeout: 60000 })
  } catch (error) {
    throw createHttpError(502, 'Timed out waiting for Extracts search form')
  }
}

async function waitForLoadersToDisappear(page, label = 'page', timeout = 60000) {
  await page.waitForFunction(() => {
    const loaderSelectors = [
      '[class*="loader" i]',
      '[class*="loading" i]',
      '[class*="spinner" i]',
      '[class*="skeleton" i]',
      '[aria-busy="true"]',
      '[role="progressbar"]'
    ]

    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    return !loaderSelectors.some(selector =>
      [...document.querySelectorAll(selector)].some(isVisible)
    )
  }, { timeout }).catch(() => {
    throw createHttpError(502, `Timed out waiting for ${label} loaders to disappear`)
  })
}

async function getEntityContext(page, input) {
  const fromUrl = page.url().match(/\/entity-details\/([^/?#]+)/)

  const pageDetails = await page.evaluate(() => {
    const text = String(document.body?.innerText || '')
    const uenMatch = text.match(/\b\d{8,9}[A-Z]\b/i)
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
    const resolvedUen = uenMatch ? uenMatch[0].toUpperCase() : ''

    const isLikelyEntityName = line => {
      const value = String(line || '').trim()
      const lowerValue = value.toLowerCase()

      if (!value || value.length > 140) return false
      if (/technical issues|live chat|helpdesk|government|bizfile|breadcrumb|home|search results|entity details|back to/i.test(value)) return false
      if (resolvedUen && value.toUpperCase() === resolvedUen) return false
      if (/\b(PTE\.?\s+LTD\.?|PRIVATE\s+LIMITED|LIMITED|LTD\.?|LLP|LLC|INC\.?)\b/i.test(value)) return true
      return /^[A-Z0-9&'().,\-/ ]{4,}$/.test(value) && value.split(/\s+/).length >= 2 && !lowerValue.includes('available products')
    }

    const uenIndex = resolvedUen
      ? lines.findIndex(line => line.toUpperCase() === resolvedUen)
      : -1

    const nameNearUen = uenIndex > 0
      ? lines.slice(Math.max(0, uenIndex - 4), uenIndex).reverse().find(isLikelyEntityName)
      : ''

    const entityIndex = lines.findIndex(line => line.toLowerCase() === 'entity details')
    const nameAfterEntityHeading = entityIndex >= 0
      ? lines.slice(entityIndex + 1, entityIndex + 8).find(isLikelyEntityName)
      : ''

    return {
      companyNumber: resolvedUen,
      companyName: nameNearUen || nameAfterEntityHeading || ''
    }
  })

  return {
    companyNumber: input.companyNumber || (fromUrl ? decodeURIComponent(fromUrl[1]).toUpperCase() : pageDetails.companyNumber),
    companyName: pageDetails.companyName || input.companyName || ''
  }
}

async function waitForExtractResults(page) {
  const stateHandle = await page.waitForFunction(() => {
    const text = String(document.body?.innerText || '').toLowerCase()

    if (
      text.includes('suspicious attempt') ||
      text.includes('suspicious activity') ||
      text.includes('verify you are human') ||
      text.includes('security check')
    ) {
      return 'access_challenge'
    }

    if (
      text.includes('extract search result(s) - 0 matching extract') ||
      text.includes('no matching results found') ||
      text.includes('0 matching extract') ||
      text.includes('0 matching extracts') ||
      text.includes('no record found') ||
      text.includes('no filing found') ||
      text.includes('no extract found') ||
      text.includes('no results found')
    ) {
      return 'no_results'
    }

    const hasPagination = Boolean(document.querySelector('#cmp-pagination-bar, [class*="pagination" i]'))
    const hasVisibleResultCard = [...document.querySelectorAll('article, li, tr, [class*="card" i], [class*="extract" i], [class*="result" i], [class*="product" i]')]
      .some(node => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        const nodeText = String(node.innerText || node.textContent || '').toLowerCase()

        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0 &&
          /(?:transaction|lodgement|lodged|filing)\s*date/.test(nodeText) &&
          /\d{1,4}[/-]\d{1,2}[/-]\d{1,4}/.test(nodeText) &&
          !nodeText.includes('search extracts') &&
          !nodeText.includes('lodgement period')
        )
      })

    if (
      text.includes('page 1 of') ||
      hasPagination ||
      hasVisibleResultCard
    ) {
      return 'has_results'
    }

    return false
  }, { timeout: 60000 })

  return stateHandle.jsonValue()
}

async function hasNoExtractResults(page) {
  return page.evaluate(() => {
    const text = String(document.body?.innerText || '').toLowerCase()
    return (
      text.includes('extract search result(s) - 0 matching extract') ||
      text.includes('no matching results found') ||
      text.includes('0 matching extract') ||
      text.includes('0 matching extracts') ||
      text.includes('no record found') ||
      text.includes('no filing found') ||
      text.includes('no extract found') ||
      text.includes('no results found')
    )
  }).catch(() => false)
}

async function waitForItemsPerPageReady(page) {
  await page.waitForFunction(() => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const pagination = document.querySelector('#cmp-pagination-bar')
    const wrapper = document.querySelector('#cmp-pagination-bar-item-per-page')
    const control = wrapper?.querySelector('select, .cmp-dropdown-menu__select, .cmp-dropdown-menu-select-button, [role="button"]')
    const dropdownValue = wrapper?.querySelector('.dropdown-value')
    const contentValue = wrapper?.querySelector('.content-value')
    const visiblePageSize = [
      dropdownValue?.innerText,
      dropdownValue?.textContent,
      contentValue?.getAttribute('data-item-page'),
      contentValue?.innerText,
      contentValue?.textContent,
      control?.getAttribute('data-item-page'),
      control?.innerText,
      control?.textContent,
      control?.value
    ].filter(Boolean).join(' ')

    return Boolean(
      pagination &&
      wrapper &&
      control &&
      isVisible(pagination) &&
      isVisible(control) &&
      /\d+/.test(visiblePageSize)
    )
  }, { timeout: 60000 }).catch(() => {
    throw createHttpError(502, 'Timed out waiting for Items per page pagination control')
  })
}

async function getVisibleExtractReadiness(page) {
  return page.evaluate(() => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const text = String(document.body?.innerText || '').toLowerCase()
    const noResults = (
      text.includes('extract search result(s) - 0 matching extract') ||
      text.includes('no matching results found') ||
      text.includes('0 matching extract') ||
      text.includes('0 matching extracts') ||
      text.includes('no record found') ||
      text.includes('no filing found') ||
      text.includes('no extract found') ||
      text.includes('no results found')
    )
    const cards = [...document.querySelectorAll('[data-testid="extract-results-card"], .extract-results-card')]
      .filter(isVisible)
    const pagination = document.querySelector('#cmp-pagination-bar')
    const rangeText = clean(pagination?.querySelector('.page-number-from-to')?.textContent)
    const totalText = clean(pagination?.querySelector('.total-items-number')?.textContent)
    const cardFingerprint = cards
      .map(node => clean(node.innerText || node.textContent).slice(0, 220))
      .join('|')
    const hasTransactionSnippet = cards.some(node => /transaction\s*no\.?|transaction\s*date/i.test(node.innerText || node.textContent || ''))

    return {
      noResults,
      cardCount: cards.length,
      hasTransactionSnippet,
      hasPagination: Boolean(pagination && isVisible(pagination)),
      rangeText,
      total: Number(totalText.match(/\d+/)?.[0] || 0),
      fingerprint: `${rangeText}|${totalText}|${cardFingerprint}`
    }
  }).catch(() => ({
    noResults: false,
    cardCount: 0,
    hasTransactionSnippet: false,
    hasPagination: false,
    rangeText: '',
    total: 0,
    fingerprint: ''
  }))
}

async function waitForExtractResultsStable(page, label = 'Extract results', timeout = 60000) {
  const deadline = Date.now() + timeout
  let lastFingerprint = ''
  let stableSince = 0

  while (Date.now() < deadline) {
    await waitForLoadersToDisappear(page, label, Math.max(1000, deadline - Date.now()))
    await assertNoAccessChallenge(page, label)

    const readiness = await getVisibleExtractReadiness(page)
    if (readiness.noResults) return 'no_results'

    const hasRenderableResults = readiness.cardCount > 0 && readiness.hasTransactionSnippet
    const hasResultShell = readiness.hasPagination || readiness.total > 0 || readiness.rangeText

    if (hasRenderableResults && hasResultShell) {
      if (readiness.fingerprint === lastFingerprint) {
        if (!stableSince) stableSince = Date.now()
        if (Date.now() - stableSince >= 1200) return 'has_results'
      } else {
        lastFingerprint = readiness.fingerprint
        stableSince = Date.now()
      }
    }

    await humanPause(250, 650)
  }

  throw createHttpError(502, `Timed out waiting for ${label} to become visible and stable`)
}

async function fetchExtractsApiPage(page, uen, pageNumber, pageSize) {
  // Fresh token per page: reCAPTCHA tokens are short-lived and typically
  // single-use, so one token minted for page 1 can't safely be reused for
  // pages 2..N. This endpoint requires the token (see RECAPTCHA_SITE_KEY
  // comment) — it was previously missing entirely, which is the confirmed
  // cause of the "Suspicious attempt detected" error from BizFile.
  const recaptchaToken = await getRecaptchaToken(page, 'extract')

  const response = await page.evaluate(async ({ payload, recaptchaToken }) => {
    const res = await fetch('/api/extract/v1/ez/extracts/ishop', {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'g-recaptcha-response': recaptchaToken
      },
      body: JSON.stringify(payload)
    })

    const text = await res.text()
    let data = null

    try {
      data = JSON.parse(text)
    } catch (error) {
      // Return the raw body preview so the caller can produce a useful fallback reason.
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      bodyPreview: text.slice(0, 500)
    }
  }, {
    payload: { pageNumber, pageSize, uen, period: '0-5' },
    recaptchaToken
  })

  if (!response.ok || !response.data) {
    const challenge = classifyApiErrorBody(response.bodyPreview)
    if (challenge) {
      throw createHttpError(403, 'BizFile access challenge detected', {
        stage: 'extracts api fallback',
        ...challenge,
        httpStatus: response.status,
        bodyPreview: response.bodyPreview
      })
    }

    throw createHttpError(502, 'BizFile Extracts API request failed', {
      httpStatus: response.status,
      bodyPreview: response.bodyPreview
    })
  }

  if (response.data.status && response.data.status !== 'SUCCESS') {
    throw createHttpError(502, 'BizFile Extracts API returned a non-success status', {
      status: response.data.status,
      message: response.data.message
    })
  }

  return response.data.result || {}
}

function waitForExtractsApiResponse(page, timeout = 45000) {
  return new Promise(resolve => {
    let settled = false
    let timer = null

    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      page.off('response', onResponse)
      resolve(value)
    }

    const onResponse = async response => {
      if (!response.url().includes('/api/extract/v1/ez/extracts/ishop')) return

      try {
        const data = await response.json()
        finish(data?.result || null)
      } catch (error) {
        finish(null)
      }
    }

    timer = setTimeout(() => finish(null), timeout)
    page.on('response', onResponse)
  })
}

async function collectFilingsViaExtractApi(page, uen) {
  if (!uen) {
    throw createHttpError(502, 'Cannot use BizFile Extracts API without a UEN')
  }

  const pageSize = getExtractPageSize()
  const filings = []
  const seenExtractKeys = new Set()
  let totalRecords = null

  for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
    const result = await fetchExtractsApiPage(page, uen, pageNumber, pageSize)
    if (!Array.isArray(result.extracts)) {
      throw createHttpError(502, 'BizFile Extracts API returned an unexpected extracts shape', {
        resultKeys: Object.keys(result || {})
      })
    }

    const extracts = result.extracts

    if (totalRecords === null) {
      totalRecords = getTotalRecords(result)
    }

    const newExtracts = extracts.filter(item => {
      const key = getExtractKey(item)
      if (!key || seenExtractKeys.has(key)) return false
      seenExtractKeys.add(key)
      return true
    })

    filings.push(...newExtracts.map(mapExtractToFiling))

    if (totalRecords !== null && seenExtractKeys.size >= totalRecords) break
    if (!extracts.length || !newExtracts.length || extracts.length < pageSize) break
    await humanPause(320, 900)
  }

  return dedupeFilings(filings)
}

async function collectFilingsFromExtractApiResult(page, uen, firstResult) {
  if (!Array.isArray(firstResult?.extracts)) return []

  const pageSize = Number(firstResult.pageSize || getExtractPageSize())
  const filings = []
  const seenExtractKeys = new Set()
  const totalRecords = getTotalRecords(firstResult)

  const addExtracts = extracts => {
    const newExtracts = extracts.filter(item => {
      const key = getExtractKey(item)
      if (!key || seenExtractKeys.has(key)) return false
      seenExtractKeys.add(key)
      return true
    })

    filings.push(...newExtracts.map(mapExtractToFiling))
    return newExtracts.length
  }

  addExtracts(firstResult.extracts)

  for (let pageNumber = 2; pageNumber <= 50; pageNumber += 1) {
    if (totalRecords !== null && seenExtractKeys.size >= totalRecords) break

    const result = await fetchExtractsApiPage(page, uen, pageNumber, pageSize)
    const extracts = Array.isArray(result.extracts) ? result.extracts : []
    const newCount = addExtracts(extracts)

    if (!extracts.length || !newCount || extracts.length < pageSize) break
    await humanPause(320, 900)
  }

  return dedupeFilings(filings)
}

async function collectVisibleFilings(page) {
  const rows = await page.evaluate(() => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
    const datePattern = /(\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4})/i
    const dateLabelPattern = /(?:transaction|lodgement|lodged|filing)\s*date\.?/i
    const transactionNoPattern = /\b[A-Z]\d{6,}\b/i
    const labelBreakPattern = /\b(Transaction\s*(?:no\.?|number|date\.?)|Lodgement\s*date\.?|Lodged\s*date\.?|Filing\s*date\.?|PDF Sample|Add to cart|View sample|Buy|\$\d)/gi
    const stopLinePattern = /^(transaction\s*(no\.?|number|date\.?)|lodgement\s*date\.?|lodged\s*date\.?|filing\s*date\.?|pdf sample|view sample|add to cart|buy|\$|amount|price|actions?)$/i
    const containerSelector = [
      '[data-testid="extract-results-card"]',
      '.extract-results-card',
      'tr',
      'article',
      'li',
      '[class*="card" i]',
      '[class*="extract" i]',
      '[class*="result" i]',
      '[class*="product" i]',
      '[class*="item" i]',
      '[class*="listing" i]'
    ].join(',')

    const getLabelValue = (lines, labelPattern, valuePattern) => {
      for (let index = 0; index < lines.length; index += 1) {
        if (!labelPattern.test(lines[index])) continue

        const sameLineValue = lines[index].match(valuePattern)
        if (sameLineValue) return sameLineValue[0]

        for (let offset = 1; offset <= 3 && index + offset < lines.length; offset += 1) {
          const nextLineValue = lines[index + offset].match(valuePattern)
          if (nextLineValue) return nextLineValue[0]
        }
      }

      return ''
    }

    const getDocName = (lines, text, cells = []) => {
      const validTitleLine = line => {
        const value = clean(line)
        if (!value || value.length < 3 || value.length > 260) return false
        if (/^(extracts?|extract search result\(s\)|items per page|page \d+|business profile|certificates?|registers?|uen|entity name)$/i.test(value)) return false
        if (stopLinePattern.test(value)) return false
        if (dateLabelPattern.test(value)) return false
        if (datePattern.test(value)) return false
        if (transactionNoPattern.test(value)) return false
        if (/^(yes|no|true|false|\d+|add|remove)$/i.test(value)) return false
        return /[A-Za-z]/.test(value)
      }

      const cellTitle = cells
        .map(clean)
        .filter(validTitleLine)
        .sort((a, b) => b.length - a.length)[0]
      if (cellTitle) return cellTitle

      const stopIndex = lines.findIndex(line => stopLinePattern.test(line) || dateLabelPattern.test(line) || transactionNoPattern.test(line))
      const titleLines = (stopIndex > 0 ? lines.slice(0, stopIndex) : lines)
        .filter(validTitleLine)
        .filter(line => !dateLabelPattern.test(line))
        .filter(line => !datePattern.test(line))
        .filter(line => !transactionNoPattern.test(line))

      const fromLines = clean(titleLines.join(' '))
      if (fromLines) return fromLines

      return clean(text
        .replace(transactionNoPattern, ' ')
        .replace(datePattern, ' ')
        .replace(labelBreakPattern, ' ')
        .split(/\$|PDF Sample|Add to cart|View sample|Buy/i)[0])
    }

    const extractFromNode = node => {
      const rawText = String(node.innerText || node.textContent || '')
      const text = clean(rawText)
      if (!text || text.length < 20 || text.length > 3500) return null
      if (!datePattern.test(text)) return null
      if (!transactionNoPattern.test(text) && !dateLabelPattern.test(text)) return null
      if (/items per page|page \d+ of|search extracts|lodgement period/i.test(text)) return null

      const snippets = [...node.querySelectorAll('.cmp-information-snippet')]
        .map(snippet => ({
          label: clean(snippet.querySelector('.cmp-information-snippet_label, label')?.innerText || snippet.querySelector('label')?.textContent),
          value: clean(snippet.querySelector('.cmp-information-snippet-value-horizontal-container')?.innerText || snippet.querySelector('.cmp-information-snippet-value-horizontal-container')?.textContent)
        }))
        .filter(item => item.label && item.value)

      const getSnippetValue = labelPattern => snippets.find(item => labelPattern.test(item.label))?.value || ''
      const cardDocName = clean(node.querySelector('.extract-result-main .headline-6--bold, .extract-result-main [class*="headline" i]')?.innerText)
      const cardTransactionNo = getSnippetValue(/transaction\s*no\.?/i)
      const cardTransactionDate = getSnippetValue(/transaction\s*date/i)
      const cardLodgerName = getSnippetValue(/lodger\s*name/i)
      const cardPrice = clean(node.querySelector('.extract-price-attachment .headline-6--bold')?.innerText)

      const cells = node.matches('tr')
        ? [...node.querySelectorAll('th,td')].map(cell => clean(cell.innerText || cell.textContent)).filter(Boolean)
        : []

      const lines = rawText
        .replace(labelBreakPattern, '\n$1\n')
        .split(/\n+/)
        .map(clean)
        .filter(Boolean)

      const transactionNo = cardTransactionNo.match(transactionNoPattern)?.[0] || text.match(transactionNoPattern)?.[0] || ''
      const transactionDate = cardTransactionDate.match(datePattern)?.[0] || getLabelValue(lines, /transaction\s*date\.?/i, datePattern)
      const lodgedDate = getLabelValue(lines, /(?:lodgement|lodged|filing)\s*date\.?/i, datePattern)
      const firstDate = text.match(datePattern)?.[0] || ''
      const docName = (cardDocName || getDocName(lines, text, cells))
        .replace(/\bTransaction\s*(no\.?|number|date\.?)\b.*$/i, '')
        .replace(/\bLodgement\s*date\.?\b.*$/i, '')
        .replace(/\bLodged\s*date\.?\b.*$/i, '')
        .replace(/\bFiling\s*date\.?\b.*$/i, '')
        .replace(/Extract search result\(s\).*$/i, '')
        .replace(/\$[\d,.]+.*$/i, '')
        .replace(/\bPDF Sample\b.*$/i, '')
        .replace(/\bAdd to cart\b.*$/i, '')
        .trim()

      if (!docName) return null

      return {
        docName,
        filingDate: transactionDate || lodgedDate || firstDate,
        transactionNo,
        transactionDate,
        lodgedDate,
        lodgedBy: cardLodgerName,
        price: cardPrice
      }
    }

    const nodes = [...document.querySelectorAll(containerSelector)]
      .filter(isVisible)
      .map(node => ({
        node,
        result: extractFromNode(node),
        area: node.getBoundingClientRect().width * node.getBoundingClientRect().height,
        top: node.getBoundingClientRect().top
      }))
      .filter(item => item.result)
      .sort((a, b) => a.area - b.area || a.top - b.top)

    const seen = new Set()
    return nodes
      .filter(({ result }) => {
        const key = result.transactionNo || `${result.docName}|${result.filingDate}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map(({ result }) => result)
  })

  return dedupeFilings(rows)
}

async function clickNextExtractPage(page) {
  return page.evaluate(() => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const pagination = document.querySelector('#cmp-pagination-bar')
    if (!pagination) return false

    const target = [...pagination.querySelectorAll('button, a, [role="button"]')]
      .map(node => {
        const className = String(node.getAttribute('class') || node.className || '').toLowerCase()
        const ariaLabel = String(node.getAttribute('aria-label') || '').toLowerCase()
        const text = String(node.innerText || node.textContent || '').toLowerCase()
        let score = 0

        if (className.includes('right-arrow-control')) score += 100
        if (ariaLabel.includes('next')) score += 80
        if (text.includes('next')) score += 60
        if (className.includes('left-arrow-control') || ariaLabel.includes('back')) score -= 200

        return { node, score, className }
      })
      .filter(item => item.score > 0)
      .filter(({ node, className }) => {
        const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true' || className.includes('disabled')
        return !disabled && isVisible(node)
      })
      .sort((a, b) => b.score - a.score)[0]?.node

    if (!target) return false

    target.scrollIntoView({ block: 'center', inline: 'center' })
    target.click()
    return true
  })
}

async function selectNextExtractPageFromDropdown(page) {
  const currentPage = await page.evaluate(() => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const wrapper = document.querySelector('#cmp-pagination-bar-button-page')
    const control = wrapper?.querySelector('.cmp-dropdown-menu__select, .cmp-dropdown-menu-select-button, [role="button"], select')
    if (!wrapper || !control || !isVisible(control)) return 0

    const current = Number(clean(wrapper.querySelector('.dropdown-value')?.textContent || control.textContent || control.value).match(/\d+/)?.[0] || 0)
    if (control.tagName === 'SELECT') {
      const option = [...control.options].find(item => Number(clean(item.textContent || item.value).match(/\d+/)?.[0] || 0) === current + 1)
      if (!option) return 0
      control.value = option.value
      control.dispatchEvent(new Event('input', { bubbles: true }))
      control.dispatchEvent(new Event('change', { bubbles: true }))
      return current
    }

    control.scrollIntoView({ block: 'center', inline: 'center' })
    control.click()
    return current
  })

  if (!currentPage) return false
  await humanPause(250, 700)

  return page.evaluate(nextPage => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const wrapper = document.querySelector('#cmp-pagination-bar-button-page')
    if (!wrapper) return false

    const option = [...wrapper.querySelectorAll('.cmp-dropdown-list-button, .cmp-dropdown-list-item, [role="option"], button')]
      .filter(isVisible)
      .find(node => Number(clean(node.innerText || node.textContent).match(/\d+/)?.[0] || 0) === nextPage)

    if (!option) return false

    const clickable = option.closest('button, a, [role="option"], [role="button"], li') || option
    clickable.scrollIntoView({ block: 'center', inline: 'center' })
    clickable.click()
    return true
  }, currentPage + 1)
}

async function getExtractPaginationState(page) {
  return page.evaluate(() => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
    const pagination = document.querySelector('#cmp-pagination-bar')
    const rangeText = clean(pagination?.querySelector('.page-number-from-to')?.textContent)
    const totalText = clean(pagination?.querySelector('.total-items-number')?.textContent)
    const pageText = clean(pagination?.querySelector('#cmp-pagination-bar-button-page .dropdown-value')?.textContent)
    const rangeMatch = rangeText.match(/(\d+)\s*-\s*(\d+)/)

    return {
      rangeText,
      from: rangeMatch ? Number(rangeMatch[1]) : 0,
      to: rangeMatch ? Number(rangeMatch[2]) : 0,
      total: Number(totalText.match(/\d+/)?.[0] || 0),
      pageNumber: Number(pageText.match(/\d+/)?.[0] || 0)
    }
  }).catch(() => ({ rangeText: '', from: 0, to: 0, total: 0, pageNumber: 0 }))
}

async function getExtractPageFingerprint(page) {
  return page.evaluate(() => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
    const pagination = document.querySelector('#cmp-pagination-bar')
    const range = clean(pagination?.querySelector('.page-number-from-to')?.textContent)
    const total = clean(pagination?.querySelector('.total-items-number')?.textContent)
    const pageNumber = clean(pagination?.querySelector('#cmp-pagination-bar-button-page .dropdown-value')?.textContent)
    const firstResult = clean([...document.querySelectorAll('[data-testid="extract-results-card"], .extract-results-card, article, li, tr, [class*="card" i], [class*="extract" i], [class*="result" i], [class*="product" i]')]
      .map(node => node.innerText || node.textContent || '')
      .find(text => /(?:transaction|lodgement|filing)\s*date|\b[A-Z]\d{6,}\b/i.test(text)))

    return `${range}|${total}|${pageNumber}|${firstResult.slice(0, 250)}`
  })
}

async function waitForExtractPageChanged(page, previousFingerprint) {
  await waitForLoadersToDisappear(page, 'Extracts pagination')

  await page.waitForFunction(previous => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
    const pagination = document.querySelector('#cmp-pagination-bar')
    const range = clean(pagination?.querySelector('.page-number-from-to')?.textContent)
    const total = clean(pagination?.querySelector('.total-items-number')?.textContent)
    const pageNumber = clean(pagination?.querySelector('#cmp-pagination-bar-button-page .dropdown-value')?.textContent)
    const firstResult = clean([...document.querySelectorAll('[data-testid="extract-results-card"], .extract-results-card, article, li, tr, [class*="card" i], [class*="extract" i], [class*="result" i], [class*="product" i]')]
      .map(node => node.innerText || node.textContent || '')
      .find(text => /(?:transaction|lodgement|filing)\s*date|\b[A-Z]\d{6,}\b/i.test(text)))

    return `${range}|${total}|${pageNumber}|${firstResult.slice(0, 250)}` !== previous
  }, { timeout: 60000 }, previousFingerprint).catch(() => {})
}

async function prepareExtractSearch(page, uen) {
  await waitForLoadersToDisappear(page, 'Extracts form')

  await selectDropdownOption(
    page,
    locators.lodgementPeriodDropdown,
    ['Last 5 Years', 'Last 5 years', '5 Years', '5 years'],
    'Lodgement period'
  )

  await waitForLoadersToDisappear(page, 'Lodgement period selection')
  await humanPause(700, 1600)
  await randomHoverWarmup(page, 'extracts form')
  await clickByText(page, locators.searchExtractsButton, 'Search extracts button')
  await waitForLoadersToDisappear(page, 'Extracts search')
  await assertNoAccessChallenge(page, 'extracts search')
  const resultState = await waitForExtractResultsStable(page, 'Extracts search results')

  if (resultState === 'no_results') {
    return {
      state: 'no_results',
      filings: []
    }
  }

  if (resultState === 'access_challenge') {
    await assertNoAccessChallenge(page, 'extracts search results')
  }

  try {
    await waitForItemsPerPageReady(page)
  } catch (error) {
    if (await hasNoExtractResults(page)) {
      return {
        state: 'no_results',
        filings: []
      }
    }
    throw error
  }

  const pageSizeSelected = await selectItemsPerPageMax(page)
  if (!pageSizeSelected) {
    if (await hasNoExtractResults(page)) {
      return {
        state: 'no_results',
        filings: []
      }
    }
    throw createHttpError(502, 'Items per page dropdown was visible but max option could not be selected')
  }

  await waitForLoadersToDisappear(page, 'Items per page update')
  await waitForExtractResultsStable(page, 'Items per page result update')
  await humanPause(900, 1800)
  return {
    state: 'has_results',
    filings: []
  }
}

async function collectFilingsFromDom(page, uen) {
  const prepared = await prepareExtractSearch(page, uen)
  if (prepared.filings.length) return prepared.filings
  if (prepared.state === 'no_results') return []

  const filings = []
  const seen = new Set()

  for (let pageIndex = 0; pageIndex < 25; pageIndex += 1) {
    const pageState = await waitForExtractResultsStable(page, `Extracts page ${pageIndex + 1}`)
    if (pageState === 'no_results') break

    const paginationState = await getExtractPaginationState(page)
    const visibleFilings = await collectVisibleFilings(page)

    for (const filing of visibleFilings) {
      const key = filing.extractId || filing.transactionNo || `${filing.docName}|${filing.filingDate}`
      if (seen.has(key)) continue
      seen.add(key)
      filings.push(filing)
    }

    console.log(`Collected ${visibleFilings.length} visible filing(s) on Extracts page ${paginationState.pageNumber || pageIndex + 1}${paginationState.total ? ` (${paginationState.rangeText} of ${paginationState.total})` : ''}.`)

    if (visibleFilings.length) {
      writeScrapeResult({
        companyNumber: uen,
        filingCount: filings.length,
        filings,
        message: 'Filings scraped successfully.',
        scrapedAt: new Date().toISOString()
      })
    }

    if (paginationState.total && filings.length >= paginationState.total) break
    if (paginationState.total && paginationState.to >= paginationState.total) break

    const previousFingerprint = await getExtractPageFingerprint(page)
    let clickedNext = await clickNextExtractPage(page)
    if (!clickedNext) {
      clickedNext = await selectNextExtractPageFromDropdown(page)
    }

    if (!clickedNext) {
      console.warn(`Could not find an enabled next pagination control after collecting ${filings.length}${paginationState.total ? ` of ${paginationState.total}` : ''} filing(s).`)
      break
    }

    await waitForExtractPageChanged(page, previousFingerprint)
    await waitForExtractResultsStable(page, `Extracts page ${pageIndex + 2}`)
    await humanPause(700, 1600)
  }

  return filings
}

async function saveVisibleExtractDebug(page, path = 'bizfile-ui-debug.json') {
  const debug = await page.evaluate(() => {
    const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const selectors = [
      '#cmp-pagination-bar',
      'tr',
      'article',
      'li',
      '[class*="card" i]',
      '[class*="extract" i]',
      '[class*="result" i]',
      '[class*="product" i]',
      '[class*="item" i]'
    ]

    const seen = new Set()
    return selectors
      .flatMap(selector => {
        try {
          return [...document.querySelectorAll(selector)]
        } catch (error) {
          return []
        }
      })
      .filter(isVisible)
      .map(node => ({
        tagName: node.tagName,
        id: node.id || '',
        className: String(node.className || ''),
        text: clean(node.innerText || node.textContent).slice(0, 2000)
      }))
      .filter(item => {
        if (!item.text || seen.has(item.text)) return false
        seen.add(item.text)
        return true
      })
      .slice(0, 120)
  }).catch(error => [{ error: error.message }])

  fs.writeFileSync(path, `${JSON.stringify({
    url: page.url(),
    capturedAt: new Date().toISOString(),
    nodes: debug
  }, null, 2)}\n`)
}

function writeScrapeResult(result) {
  let existingResult = null

  if (fs.existsSync(resultJsonPath)) {
    try {
      existingResult = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'))
    } catch (error) {
      existingResult = null
    }
  }

  const resultKey = entry => normalizeText(entry?.companyNumber || entry?.uen || entry?.companyName || '').toUpperCase()
  const normalizeResultEntry = entry => {
    const filings = mergeFilings([], entry?.filings || [])

    return {
      ...entry,
      companyName: normalizeText(entry?.companyName),
      companyNumber: normalizeText(entry?.companyNumber).toUpperCase(),
      filingCount: filings.length,
      filings,
      message: filings.length
        ? 'Filings scraped successfully.'
        : (entry?.message || 'No filings found for the selected lodgement period.'),
      scrapedAt: entry?.scrapedAt || new Date().toISOString()
    }
  }

  const existingEntries = []
  if (Array.isArray(existingResult?.results)) {
    existingEntries.push(...existingResult.results)
  } else if (existingResult?.companyNumber || existingResult?.companyName || Array.isArray(existingResult?.filings)) {
    existingEntries.push(existingResult)
  }

  const entriesByKey = new Map()
  for (const entry of existingEntries.map(normalizeResultEntry)) {
    const key = resultKey(entry)
    if (!key) continue
    entriesByKey.set(key, entry)
  }

  const incomingEntry = normalizeResultEntry(result)
  const incomingKey = resultKey(incomingEntry)
  const previousEntry = incomingKey ? entriesByKey.get(incomingKey) : null

  const mergedFilings = mergeFilings(previousEntry?.filings || [], incomingEntry.filings || [])

  const mergedResult = {
    ...(previousEntry || {}),
    ...incomingEntry,
    companyName: incomingEntry.companyName || previousEntry?.companyName || '',
    companyNumber: incomingEntry.companyNumber || previousEntry?.companyNumber || '',
    filingCount: mergedFilings.length,
    filings: mergedFilings,
    message: mergedFilings.length
      ? 'Filings scraped successfully.'
      : incomingEntry.message,
    scrapedAt: new Date().toISOString()
  }

  if (incomingKey) {
    entriesByKey.set(incomingKey, mergedResult)
  }

  const history = [...entriesByKey.values()]
    .sort((a, b) => String(b.scrapedAt || '').localeCompare(String(a.scrapedAt || '')))

  const output = {
    ...mergedResult,
    results: history
  }

  fs.writeFileSync(resultJsonPath, `${JSON.stringify(output, null, 2)}\n`)
  return output
}

async function collectFilings(page, uen) {
  const uiFilings = await collectFilingsFromDom(page, uen)
  console.log(`Collected ${uiFilings.length} filing(s) from visible Extracts UI.`)

  if (uiFilings.length) return uiFilings
  if (await hasNoExtractResults(page)) return []

  if (!isExtractApiFallbackEnabled()) {
    console.warn('BizFile Extracts API fallback is disabled. Set ENABLE_EXTRACT_API_FALLBACK=true to opt in.')
    return uiFilings
  }

  try {
    await saveVisibleExtractDebug(page).catch(() => {})
    console.warn('Visible Extracts UI had results but no rows could be parsed. Trying BizFile Extracts API fallback once.')
    const apiFilings = await collectFilingsViaExtractApi(page, uen)
    console.log(`Collected ${apiFilings.length} filing(s) using BizFile Extracts API fallback.`)
    return apiFilings
  } catch (error) {
    console.warn(`BizFile Extracts API fallback failed: ${error.message}. Returning visible UI result set.`)
    return uiFilings
  }
}

async function scrapeBizfileFilings(input) {
  const normalizedInput = normalizeScrapeInput(input)

  if (!normalizedInput.companyName && !normalizedInput.companyNumber) {
    throw createHttpError(400, 'Provide companyName/companyNumber or entityName/uen')
  }

  const maxRetries = Number(process.env.RATE_LIMIT_MAX_RETRIES ?? 1)
  const retryDelayMs = Number(process.env.RATE_LIMIT_RETRY_DELAY_MS || 30000)

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runScrapeAttempt(normalizedInput)
    } catch (error) {
      const retryable = error?.details?.retryable === true
      if (!retryable || attempt >= maxRetries) throw error

      console.warn(`BizFile rate limit hit (attempt ${attempt + 1}/${maxRetries + 1}). Backing off ${retryDelayMs}ms before retry.`)
      await delay(retryDelayMs)
    }
  }
}

async function runScrapeAttempt(normalizedInput) {
  const browser = await puppeteer.launch(getLaunchOptions())
  const page = await browser.newPage()
  await preparePageForBizFile(page)
  page.setDefaultTimeout(60000)
  page.setDefaultNavigationTimeout(90000)

  try {
    await humanPause(800, 2200)
    const searchResult = await searchEntity(page, normalizedInput)

    if (!searchResult.directEntityDetails) {
      await clickMatchingMoreInformation(page, normalizedInput)
      await waitForEntityDetails(page)
    }

    const context = await getEntityContext(page, normalizedInput)
    if (!context.companyNumber) {
      throw createHttpError(502, 'Could not determine company UEN from Entity Details page')
    }

    await openExtracts(page)
    const filings = await collectFilings(page, context.companyNumber)
    await page.screenshot({ path: 'bizfile-api-result.png', fullPage: true }).catch(() => {})

    const result = {
      companyName: context.companyName || searchResult.entity?.companyName || normalizedInput.companyName,
      companyNumber: context.companyNumber,
      filingCount: filings.length,
      filings,
      message: filings.length
        ? 'Filings scraped successfully.'
        : 'No filings found for the selected lodgement period.',
      scrapedAt: new Date().toISOString()
    }

    return writeScrapeResult(result)
  } catch (error) {
    await page.screenshot({ path: 'bizfile-api-error.png', fullPage: true }).catch(() => {})
    throw error
  } finally {
    await browser.close()
  }
}

module.exports = {
  scrapeBizfileFilings
}
