// puppeteer-extra is a drop-in replacement for puppeteer,
// it augments the installed puppeteer with plugin functionality
const puppeteer = require('puppeteer-extra')
const fs = require('fs')

// add stealth plugin and use defaults (all evasion techniques)
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const humanPause = (min = 250, max = min) => delay(randomBetween(min, max))
const companyNumber = String(process.argv[2] || process.env.COMPANY_NUMBER || '').trim().toUpperCase()
const configuredManualSearchDelayMs = Number(process.env.MANUAL_SEARCH_DELAY_MS || 60000)
const manualSearchDelayMs = Number.isFinite(configuredManualSearchDelayMs) && configuredManualSearchDelayMs > 0
  ? configuredManualSearchDelayMs
  : 60000
const extractPageSize = Number(process.env.EXTRACT_PAGE_SIZE || 10)
const resultJsonPath = 'bizfile-api-result.json'

const loaderSelectors = [
  '[class*="loader" i]',
  '[class*="loading" i]',
  '[class*="spinner" i]',
  '[class*="skeleton" i]',
  '[aria-busy="true"]',
  '[role="progressbar"]'
]

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

async function waitForVisibleSelector(page, selectors, label, timeout = 30000) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const element = await page.$(selector)
      if (!element) continue

      const isVisible = await element.evaluate(node => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
        return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      })

      if (isVisible) return element
    }

    await delay(250)
  }

  throw new Error(`${label} not found. Tried selectors: ${selectors.join(', ')}`)
}

async function humanClick(page, element, label) {
  await element.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }))
  await delay(250)

  try {
    await element.click()
  } catch (error) {
    await element.evaluate(node => node.click())
  }

  await delay(250)
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function preparePageForBizFile(page) {
  await page.setExtraHTTPHeaders({
    'Accept-Language': process.env.ACCEPT_LANGUAGE || 'en-US,en;q=0.9'
  })
}

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

async function randomHoverWarmup(page, label = 'page') {
  console.log(`Running random hover warmup on ${label}.`)

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth || 1200,
    height: window.innerHeight || 800
  })).catch(() => ({ width: 1200, height: 800 }))

  const hoverTargets = await page.evaluate(() => {
    const selectors = [
      '#input-search-bar',
      'header a',
      'header button',
      'nav a',
      'nav button',
      'button',
      'a'
    ]

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
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        }
      })
  }).catch(() => [])

  const moveCount = randomBetween(4, 7)
  for (let index = 0; index < moveCount; index += 1) {
    const target = hoverTargets.length
      ? hoverTargets[randomBetween(0, hoverTargets.length - 1)]
      : {
          x: randomBetween(120, Math.max(121, viewport.width - 120)),
          y: randomBetween(120, Math.max(121, viewport.height - 120))
        }

    const x = Math.max(20, Math.min(viewport.width - 20, target.x + randomBetween(-18, 18)))
    const y = Math.max(20, Math.min(viewport.height - 20, target.y + randomBetween(-12, 12)))

    await moveMouseLikeHuman(page, { x, y }, viewport)
    await delay(randomBetween(450, 1400))

    if (Math.random() < 0.2) {
      await page.mouse.wheel({ deltaY: randomBetween(-80, 120) })
      await delay(randomBetween(250, 700))
    }
  }

  console.log(`Random hover warmup complete on ${label}.`)
}

async function clickFirstVisible(page, selectors, label, timeout = 30000) {
  const element = await waitForVisibleSelector(page, selectors, label, timeout)
  await humanClick(page, element, label)
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
        const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
        return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }

      const candidates = []

      for (const selector of selectors) {
        try {
          candidates.push(...document.querySelectorAll(selector))
        } catch (error) {
          // Ignore selector variants unsupported by the current browser.
        }
      }

      const clickableCandidates = [...new Set(candidates.map(node =>
        node.closest('button, a, [role="button"], [role="tab"]') || node
      ))]

      const scoredCandidates = clickableCandidates
        .filter(isVisible)
        .map(node => {
          const nodeText = normalize(node.innerText || node.textContent)
          const ariaText = normalize(node.getAttribute('aria-label'))
          const targetText = normalize(`${nodeText} ${ariaText}`)

          if (!targetText.includes(expectedText)) return null

          let score = 0
          if (nodeText === expectedText || ariaText === expectedText) score += 100
          if (nodeText.includes(expectedText) || ariaText.includes(expectedText)) score += 50
          if (node.matches('button, a, [role="button"], [role="tab"]')) score += 20
          if (node.matches('[role="tab"], button[class*="tab" i], button.wrapper')) score += 15

          return { node, score }
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)

      const target = scoredCandidates[0]?.node
      if (!target) return false

      target.scrollIntoView({ block: 'center', inline: 'center' })
      target.click()
      return true
    }, locator)

    if (clicked) return
    await delay(250)
  }

  throw new Error(`${label} not found. Expected text: "${locator.text}"`)
}

async function waitForTextLocator(page, locator, label, timeout = 30000) {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const found = await page.evaluate(({ selectors, text }) => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const expectedText = normalize(text)

      const isVisible = node => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
        return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }

      const candidates = []

      for (const selector of selectors) {
        try {
          candidates.push(...document.querySelectorAll(selector))
        } catch (error) {
          // Ignore selector variants unsupported by the current browser.
        }
      }

      return [...new Set(candidates.map(node =>
        node.closest('button, a, [role="button"], [role="tab"]') || node
      ))].some(node => {
        const clickable = node.closest('button, a, [role="button"]') || node
        const targetText = normalize(`${node.innerText || node.textContent} ${clickable.innerText || clickable.textContent} ${clickable.getAttribute('aria-label')}`)
        return isVisible(clickable) && targetText.includes(expectedText)
      })
    }, locator)

    if (found) return
    await delay(250)
  }

  throw new Error(`${label} not found. Expected text: "${locator.text}"`)
}

async function clickOptionByText(page, optionSelectors, optionTexts, label, timeout = 30000) {
  const deadline = Date.now() + timeout
  const texts = Array.isArray(optionTexts) ? optionTexts : [optionTexts]

  while (Date.now() < deadline) {
    const clicked = await page.evaluate(({ optionSelectors, texts }) => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const expectedTexts = texts.map(normalize)

      const isVisible = node => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
        return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
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
    await delay(250)
  }

  throw new Error(`${label} option not found. Expected one of: ${texts.join(', ')}`)
}

async function selectNativeOptionNearLabel(page, dropdown, optionTexts) {
  const texts = Array.isArray(optionTexts) ? optionTexts : [optionTexts]

  return page.evaluate(({ labelText, texts }) => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const expectedTexts = texts.map(normalize)
    const expectedLabel = normalize(labelText)

    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
      return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const contextHasLabel = node => {
      let current = node

      for (let depth = 0; current && depth < 8; depth += 1) {
        const text = normalize(current.innerText || current.textContent)
        if (text.includes(expectedLabel)) return true
        current = current.parentElement
      }

      return false
    }

    const selects = [...document.querySelectorAll('select')].filter(isVisible)
    const select = selects.find(node => contextHasLabel(node)) || selects[0]
    if (!select) return null

    const option = [...select.options].find(item => {
      const optionText = normalize(`${item.textContent} ${item.value}`)
      return expectedTexts.some(expectedText => optionText.includes(expectedText))
    })

    if (!option) return null

    select.value = option.value
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return option.textContent.trim()
  }, { labelText: dropdown.labelText, texts })
}

async function selectNativeMaxValueNearLabel(page, dropdown) {
  return page.evaluate(labelText => {
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const expectedLabel = normalize(labelText)

    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
      return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const contextHasLabel = node => {
      let current = node

      for (let depth = 0; current && depth < 8; depth += 1) {
        const text = normalize(current.innerText || current.textContent)
        if (text.includes(expectedLabel)) return true
        current = current.parentElement
      }

      return false
    }

    const selects = [...document.querySelectorAll('select')].filter(isVisible)
    const select = selects.find(node => contextHasLabel(node)) || selects[0]
    if (!select) return null

    const options = [...select.options]
      .map(option => ({
        option,
        number: Number((option.textContent || option.value || '').match(/\d+/)?.[0] || 0)
      }))
      .filter(item => item.number > 0)
      .sort((a, b) => b.number - a.number)

    if (!options.length) return null

    select.value = options[0].option.value
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    return options[0].option.textContent.trim()
  }, dropdown.labelText)
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
        const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
        return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
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
          return text.includes(expectedLabel) && text.length < 120
        })

      const scoredCandidates = candidates
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

      const target = scoredCandidates.find(item => item.score > 0)?.clickable
      if (!target) return false

      target.scrollIntoView({ block: 'center', inline: 'center' })
      target.click()
      return true
    }, dropdown)

    if (clicked) return
    await delay(250)
  }

  throw new Error(`${label} dropdown not found near label "${dropdown.labelText}"`)
}

async function selectDropdownOption(page, dropdown, optionTexts, label) {
  const selectedNativeOption = await selectNativeOptionNearLabel(page, dropdown, optionTexts)
  if (selectedNativeOption) {
    console.log(`Selected ${label}: ${selectedNativeOption}`)
    await humanPause(250, 700)
    return
  }

  await clickDropdownNearLabel(page, dropdown, label)
  await humanPause(350, 850)
  await clickOptionByText(page, dropdown.optionSelectors, optionTexts, label)
  console.log(`Selected ${label}.`)
}

async function selectDropdownMaxValue(page, dropdown, label) {
  const selectedNativeOption = await selectNativeMaxValueNearLabel(page, dropdown)
  if (selectedNativeOption) {
    console.log(`Selected ${label}: ${selectedNativeOption}`)
    await humanPause(250, 700)
    return
  }

  await clickDropdownNearLabel(page, dropdown, label)
  await humanPause(350, 850)

  const selectedOption = await page.evaluate(optionSelectors => {
      const isVisible = node => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
        return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
      }

    const candidates = []

    for (const selector of optionSelectors) {
      try {
        candidates.push(...document.querySelectorAll(selector))
      } catch (error) {
        // Ignore selector variants unsupported by the current browser.
      }
    }

    const options = candidates
      .filter(isVisible)
      .map(node => ({
        node,
        text: String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
        number: Number(String(node.innerText || node.textContent || '').match(/\d+/)?.[0] || 0)
      }))
      .filter(item => item.number > 0)
      .sort((a, b) => b.number - a.number)

    if (!options.length) return null

    const clickable = options[0].node.closest('button, a, [role="option"], [role="button"], li') || options[0].node
    clickable.scrollIntoView({ block: 'center', inline: 'center' })
    clickable.click()
    return options[0].text
  }, dropdown.optionSelectors)

  if (!selectedOption) {
    throw new Error(`${label} max option not found`)
  }

  console.log(`Selected ${label}: ${selectedOption}`)
  await humanPause(250, 700)
}

async function selectItemsPerPageMax(page) {
  const selectedOption = await page.evaluate(() => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
      return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const wrapper = document.querySelector('#cmp-pagination-bar-item-per-page')
    if (!wrapper) return null

    const clickable = wrapper.querySelector('select, .cmp-dropdown-menu__select, .cmp-dropdown-menu-select-button, [role="button"]')
    if (!clickable || !isVisible(clickable)) return null

    if (clickable.tagName === 'SELECT') {
      const option = [...clickable.options]
        .map(option => ({
          option,
          number: Number((option.textContent || option.value || '').match(/\d+/)?.[0] || 0)
        }))
        .filter(item => item.number > 0)
        .sort((a, b) => b.number - a.number)[0]

      if (!option) return null

      clickable.value = option.option.value
      clickable.dispatchEvent(new Event('input', { bubbles: true }))
      clickable.dispatchEvent(new Event('change', { bubbles: true }))
      return option.option.textContent.trim()
    }

    clickable.scrollIntoView({ block: 'center', inline: 'center' })
    clickable.click()
    return '__opened__'
  })

  if (!selectedOption) {
    throw new Error('Items per page dropdown not found near the results pagination')
  }

  if (selectedOption !== '__opened__') {
    console.log(`Selected Items per page: ${selectedOption}`)
    await humanPause(250, 700)
    return
  }

  await humanPause(350, 850)

  const selectedMaxOption = await page.evaluate(() => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
      return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const wrapper = document.querySelector('#cmp-pagination-bar-item-per-page')
    if (!wrapper) return null

    const options = [...wrapper.querySelectorAll('.cmp-dropdown-list-button, .cmp-dropdown-list-item, [role="option"], button')]
      .filter(isVisible)
      .map(node => ({
        node,
        text: String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(),
        number: Number(String(node.innerText || node.textContent || '').match(/\d+/)?.[0] || 0)
      }))
      .filter(item => item.number > 0)
      .sort((a, b) => b.number - a.number)

    if (!options.length) return null

    const clickable = options[0].node.closest('button, a, [role="option"], [role="button"], li') || options[0].node
    clickable.scrollIntoView({ block: 'center', inline: 'center' })
    clickable.click()
    return options[0].text
  })

  if (!selectedMaxOption) {
    throw new Error('Max Items per page option not found')
  }

  console.log(`Selected Items per page: ${selectedMaxOption}`)
  await humanPause(250, 700)
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

  await waitForVisibleSelector(page, locators.searchButton, 'Search button')
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

  await waitForVisibleSelector(page, locators.searchButton, 'Search button')
}

async function typeCompanyNumber(page) {
  await clickFirstVisible(page, locators.searchInput, 'Search input')
  await humanPause(250, 700)

  const currentValue = await page.$eval(locators.searchInput[0], input => input.value)
  if (currentValue === companyNumber) return

  await page.keyboard.down('Control')
  await humanPause(80, 180)
  await page.keyboard.press('A')
  await page.keyboard.up('Control')
  await humanPause(80, 220)
  await page.keyboard.press('Backspace')
  await humanPause(120, 350)
  await page.keyboard.type(companyNumber, { delay: 50 })
  await humanPause(250, 700)
}

async function waitForSearchResults(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText || ''
    return location.href.includes('/buy-info/search/results') || bodyText.includes('More information')
  }, { timeout }).catch(() => {
    throw new Error('Search results did not load after submitting the UEN search')
  })

  await waitForLoaderCycle(page, 'Search results', timeout)
}

async function submitUenSearch(page) {
  await clickFirstVisible(page, locators.searchButton, 'Search button')

  const loadedAfterClick = await waitForSearchResults(page, 45000)
    .then(() => true)
    .catch(() => false)

  if (loadedAfterClick) return

  await page.screenshot({ path: 'bizfile-search-not-submitted.png', fullPage: true }).catch(() => {})
  throw new Error('Search did not navigate after one click. Stopped without retries; check bizfile-search-not-submitted.png before continuing manually.')
}

async function waitForEntityDetails(page) {
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText || ''
    return location.href.includes('/buy-info/entity-details/') || bodyText.includes('Information products')
  }, { timeout: 60000 })

  await waitForLoaderCycle(page, 'Entity details')
  await waitForTextLocator(page, locators.informationProductsTab, 'Information products tab')
}

async function waitForExtractsForm(page) {
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText || ''
    return bodyText.includes('Lodgement period') && bodyText.includes('Search extracts')
  }, { timeout: 60000 })
}

async function waitForLoadersToDisappear(page, label = 'page', timeout = 60000) {
  await page.waitForFunction(selectors => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    return !selectors.some(selector =>
      [...document.querySelectorAll(selector)].some(isVisible)
    )
  }, { timeout }, loaderSelectors).catch(() => {
    throw new Error(`Timed out waiting for ${label} loaders to disappear`)
  })
}

async function waitForLoaderCycle(page, label = 'page', timeout = 60000) {
  await page.waitForFunction(selectors => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    return selectors.some(selector =>
      [...document.querySelectorAll(selector)].some(isVisible)
    )
  }, { timeout: 2000 }, loaderSelectors).catch(() => {})

  await waitForLoadersToDisappear(page, label, timeout)
}

async function waitForHomeSearchReady(page) {
  await waitForLoaderCycle(page, 'Home page')
  await waitForVisibleSelector(page, locators.searchInput, 'Search input')
}

async function waitForAdvancedSearchReady(page) {
  await waitForLoaderCycle(page, 'Advanced search panel')
  await waitForVisibleSelector(page, locators.keywordMatchDropdownButton, 'Keyword match type dropdown')
  await waitForVisibleSelector(page, locators.searchButton, 'Search button')
}

async function waitForInformationProductsReady(page) {
  await waitForLoaderCycle(page, 'Information products tab')
  await waitForTextLocator(page, locators.extractsTab, 'Extracts tab', 60000)
}

async function openInformationProductsTab(page) {
  await clickByText(page, locators.informationProductsTab, 'Information products tab')
  await waitForInformationProductsReady(page)
}

async function waitForExtractsFormReady(page) {
  await waitForLoaderCycle(page, 'Extracts form')
  await waitForExtractsForm(page)
  await waitForVisibleSelector(page, locators.lodgementPeriodDropdown.dropdownSelectors, 'Lodgement period dropdown')
}

async function waitForSearchExtractsFinished(page) {
  await waitForLoaderCycle(page, 'Extracts search')
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText || ''
    const lowerBodyText = bodyText.toLowerCase()

    return (
      lowerBodyText.includes('items per page') ||
      lowerBodyText.includes('transaction no') ||
      lowerBodyText.includes('transaction date') ||
      lowerBodyText.includes('page 1 of') ||
      lowerBodyText.includes('no matching results found') ||
      lowerBodyText.includes('0 matching extract') ||
      document.querySelector('[class*="pagination" i], table, [role="table"], [class*="table" i]')
    )
  }, { timeout: 60000 })
}

async function waitForItemsPerPageReady(page) {
  await waitForLoaderCycle(page, 'Items per page')
  await page.waitForFunction(() => {
    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      const disabled = node.disabled || node.getAttribute('aria-disabled') === 'true'
      return !disabled && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
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
    throw new Error('Items per page control did not become ready after Extracts search')
  })
}

async function waitForExtractsSearchResult(page) {
  const stateHandle = await page.waitForFunction(() => {
    const bodyText = document.body?.innerText || ''
    const lowerBodyText = bodyText.toLowerCase()

    if (
      lowerBodyText.includes('file annual returns') ||
      lowerBodyText.includes('transaction no.') ||
      lowerBodyText.includes('transaction date') ||
      lowerBodyText.includes('page 1 of') ||
      document.querySelector('[class*="pagination" i], table, [role="table"], [class*="table" i]')
    ) {
      return 'has_results'
    }

    if (
      lowerBodyText.includes('no matching results found') ||
      lowerBodyText.includes('0 matching extract') ||
      lowerBodyText.includes('no record found') ||
      lowerBodyText.includes('no filing found') ||
      lowerBodyText.includes('no results found')
    ) {
      return 'no_results'
    }

    if (lowerBodyText.includes('items per page')) {
      return 'has_items_per_page'
    }

    return false
  }, { timeout: 60000 })

  return stateHandle.jsonValue()
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

  throw new Error(`Timed out waiting for ${label} to become visible and stable`)
}

async function getAccessChallenge(page) {
  return page.evaluate(() => {
    const text = String(document.body?.innerText || '').toLowerCase()

    const isVisible = node => {
      const style = window.getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }

    const visibleChallengeFrame = [...document.querySelectorAll('iframe')]
      .filter(isVisible)
      .find(frame => {
        const src = String(frame.getAttribute('src') || '').toLowerCase()
        const title = String(frame.getAttribute('title') || '').toLowerCase()
        return (
          src.includes('/recaptcha/api2/bframe') ||
          title.includes('challenge') ||
          title.includes('captcha')
        )
      })

    if (visibleChallengeFrame) return 'visible captcha challenge detected'
    if (text.includes('suspicious activity')) return 'suspicious activity message detected'
    if (text.includes('verify you are human')) return 'human verification message detected'
    if (text.includes('security check')) return 'security check message detected'

    return ''
  }).catch(() => '')
}

async function assertNoAccessChallenge(page, stage) {
  const challenge = await getAccessChallenge(page)
  if (!challenge) return

  throw new Error(`BizFile access challenge detected at ${stage}: ${challenge}`)
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

function getSafeExtractPageSize() {
  if (!Number.isFinite(extractPageSize) || extractPageSize <= 0) return 10
  return Math.min(Math.max(Math.floor(extractPageSize), 1), 10)
}

function isExtractApiFallbackEnabled() {
  return process.env.ENABLE_EXTRACT_API_FALLBACK === 'true' && process.env.DISABLE_EXTRACT_API !== 'true'
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

async function getEntityContextFromPage(page) {
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
    companyNumber: companyNumber || (fromUrl ? decodeURIComponent(fromUrl[1]).toUpperCase() : pageDetails.companyNumber),
    companyName: pageDetails.companyName || ''
  }
}

async function fetchExtractsApiPage(page, uen, pageNumber, pageSize) {
  await assertNoAccessChallenge(page, `before Extracts API page ${pageNumber}`)

  const response = await page.evaluate(async payload => {
    const res = await fetch('/api/extract/v1/ez/extracts/ishop', {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const text = await res.text()
    let data = null

    try {
      data = JSON.parse(text)
    } catch (error) {
      // Keep a body preview for the Node-side error message.
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      bodyPreview: text.slice(0, 500)
    }
  }, {
    pageNumber,
    pageSize,
    uen,
    period: '0-5'
  })

  if (!response.ok || !response.data) {
    throw new Error(`BizFile Extracts API request failed (${response.status}): ${response.bodyPreview}`)
  }

  if (response.data.status && response.data.status !== 'SUCCESS') {
    throw new Error(`BizFile Extracts API returned ${response.data.status}: ${response.data.message || 'no message'}`)
  }

  return response.data.result || {}
}

async function collectFilingsViaExtractApi(page, uen) {
  if (!uen) {
    throw new Error('Cannot scrape Extracts API because the current entity UEN could not be determined')
  }

  const pageSize = getSafeExtractPageSize()
  const filings = []
  const seenExtractKeys = new Set()
  let totalRecords = null

  console.log(`Scraping Extracts API for UEN ${uen} with page size ${pageSize}.`)

  for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
    const result = await fetchExtractsApiPage(page, uen, pageNumber, pageSize)
    const reportedTotal = getTotalRecords(result)

    if (!Array.isArray(result.extracts)) {
      if (pageNumber === 1 && (reportedTotal === 0 || !Object.keys(result || {}).length)) {
        console.log('Extracts API returned no records for this UEN/period.')
        break
      }

      throw new Error(`BizFile Extracts API returned unexpected data. Result keys: ${Object.keys(result || {}).join(', ')}`)
    }

    const extracts = result.extracts

    if (totalRecords === null) {
      totalRecords = reportedTotal
      if (totalRecords !== null) console.log(`Extracts API reports ${totalRecords} total record(s).`)
    }

    const newExtracts = extracts.filter(item => {
      const key = getExtractKey(item)
      if (!key || seenExtractKeys.has(key)) return false
      seenExtractKeys.add(key)
      return true
    })

    filings.push(...newExtracts.map(mapExtractToFiling))
    console.log(`Scraped API page ${pageNumber}: ${newExtracts.length} new record(s).`)

    if (totalRecords !== null && seenExtractKeys.size >= totalRecords) break
    if (!extracts.length || !newExtracts.length || extracts.length < pageSize) break
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

async function collectFilingsFromVisibleUi(page, entityContext = {}) {
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
        companyName: entityContext.companyName || '',
        companyNumber: entityContext.companyNumber || '',
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

  return dedupeFilings(filings)
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

// puppeteer usage as normal
puppeteer.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  userDataDir: 'C:/Users/Fahad Fayyaz/AppData/Local/Google/Chrome/User Data/Default',
  defaultViewport: null,
  ignoreDefaultArgs: ['--enable-automation'],
  args: [
    '--start-maximized',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--no-default-browser-check',
    '--no-first-run'
  ]
}).then(async browser => {
  console.log('Running tests..')
  const page = await browser.newPage()
  await preparePageForBizFile(page)
  page.setDefaultTimeout(60000)
  page.setDefaultNavigationTimeout(90000)

  try {
    await humanPause(800, 2200)
    await page.goto('https://www.bizfile.gov.sg/', {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    })

    await waitForHomeSearchReady(page)
    await assertNoAccessChallenge(page, 'home page')
    await randomHoverWarmup(page, 'UEN search page')

    console.log(`Manual search mode enabled. Please complete the BizFile search manually within ${Math.round(manualSearchDelayMs / 1000)} seconds.`)
    await delay(manualSearchDelayMs)
    await waitForLoaderCycle(page, 'Manual search handoff')
    await assertNoAccessChallenge(page, 'manual search handoff')

    /*
      Temporary manual handoff:
      await waitForHomeSearchReady(page)
      await delay(500)
      await randomHoverWarmup(page, 'UEN search page')
      await typeCompanyNumber(page)
      await waitForAdvancedSearchReady(page)
      await selectUenFilter(page)
      await typeCompanyNumber(page)
      await submitUenSearch(page)
    */

    const currentStage = await page.waitForFunction(() => {
      const bodyText = document.body?.innerText || ''

      if (location.href.includes('/buy-info/entity-details/') || bodyText.includes('Information products')) {
        return 'entity_details'
      }

      if (bodyText.includes('More information')) {
        return 'search_results'
      }

      return false
    }, { timeout: 30000 }).then(handle => handle.jsonValue()).catch(() => null)

    if (!currentStage) {
      throw new Error('Manual search handoff did not reach search results or entity details. Complete the search within the delay, then rerun.')
    }

    if (currentStage === 'search_results') {
      await clickByText(page, locators.moreInformationButton, 'More information button')
    }

    await waitForEntityDetails(page)
    await assertNoAccessChallenge(page, 'entity details')

    await openInformationProductsTab(page)
    await assertNoAccessChallenge(page, 'information products')

    await clickByText(page, locators.extractsTab, 'Extracts tab')
    await waitForExtractsFormReady(page)
    await assertNoAccessChallenge(page, 'extracts form')
    await humanPause(500, 1200)
    await randomHoverWarmup(page, 'Extracts form')

    await selectDropdownOption(
      page,
      locators.lodgementPeriodDropdown,
      ['Last 5 Years', 'Last 5 years', '5 Years', '5 years'],
      'Lodgement period'
    )

    await waitForLoaderCycle(page, 'Lodgement period selection')
    await humanPause(700, 1600)
    await randomHoverWarmup(page, 'Extracts search')
    await clickByText(page, locators.searchExtractsButton, 'Search extracts button')
    await waitForSearchExtractsFinished(page)
    await assertNoAccessChallenge(page, 'extracts search')
    const extractsResultState = await waitForExtractResultsStable(page, 'Extracts search results')
    const entityContext = await getEntityContextFromPage(page)
    console.log(`Current entity resolved as ${entityContext.companyNumber || 'unknown UEN'}.`)

    let filings = []

    if (extractsResultState === 'no_results') {
      console.log('No matching extracts found, so Items per page is not available.')
    } else {
      await waitForItemsPerPageReady(page)
      await selectItemsPerPageMax(page)
      await waitForLoaderCycle(page, 'Items per page update')
      await waitForExtractResultsStable(page, 'Items per page result update')

      filings = await collectFilingsFromVisibleUi(page, entityContext)
      console.log(`Collected ${filings.length} filing(s) from visible Extracts UI.`)
    }

    if (!filings.length && extractsResultState !== 'no_results' && isExtractApiFallbackEnabled()) {
      try {
        await saveVisibleExtractDebug(page).catch(() => {})
        console.warn('Visible Extracts UI had results but no rows could be parsed. Trying BizFile Extracts API fallback once.')
        filings = await collectFilingsViaExtractApi(page, entityContext.companyNumber)
      } catch (error) {
        console.warn(`BizFile Extracts API fallback failed: ${error.message}. Returning visible UI result set.`)
      }
    } else if (!filings.length && extractsResultState !== 'no_results') {
      await saveVisibleExtractDebug(page).catch(() => {})
      console.warn('Visible Extracts UI had results but no rows could be parsed. Extracts API fallback is disabled.')
    }

    const scrapeResult = {
      companyName: entityContext.companyName,
      companyNumber: entityContext.companyNumber,
      filingCount: filings.length,
      filings,
      message: filings.length
        ? 'Filings scraped successfully.'
        : 'No filings found for the selected lodgement period.',
      scrapedAt: new Date().toISOString()
    }

    writeScrapeResult(scrapeResult)
    console.log(`Scraped ${filings.length} filing(s). Result written to bizfile-api-result.json.`)

    await humanPause(2500, 3800)

    await page.screenshot({ path: 'testresult1.png', fullPage: true })
    console.log('All done, check bizfile-api-result.json and testresult1.png.')
  } catch (error) {
    await page.screenshot({ path: 'bizfile-error.png', fullPage: true }).catch(() => {})
    console.error(`Automation failed: ${error.message}`)
    process.exitCode = 1
  } finally {
    await browser.close()
  }
})
