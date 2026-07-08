const express = require('express')
const { scrapeBizfileFilings } = require('./scraper')

const app = express()
const port = Number(process.env.PORT || 3000)
const buildId = 'bizfile-api-stealth-coherence-v8-recaptcha-fix'

app.use(express.json({ limit: '64kb' }))

let scrapeQueue = Promise.resolve()

function enqueueScrape(task) {
  const run = scrapeQueue.then(task, task)
  scrapeQueue = run.catch(() => {})
  return run
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', buildId })
})

app.post('/api/sgp/filings', async (req, res) => {
  const body = req.body || {}
  const companyName = body.companyName || body.entityName || body.name || ''
  const companyNumber = body.companyNumber || body.uen || body.companyUen || body.entityNumber || ''

  if (!companyName && !companyNumber) {
    return res.status(400).json({
      error: 'Provide companyName/companyNumber or entityName/uen'
    })
  }

  try {
    const result = await enqueueScrape(() => scrapeBizfileFilings({ companyName, companyNumber }))
    res.json(result)
  } catch (error) {
    const statusCode = error.statusCode || 500

    if (error.details?.retryable) {
      const retryAfterSeconds = Math.ceil(Number(process.env.RATE_LIMIT_RETRY_DELAY_MS || 30000) / 1000)
      res.set('Retry-After', String(retryAfterSeconds))
    }

    res.status(statusCode).json({
      error: error.message || 'BizFile scrape failed',
      details: error.details
    })
  }
})

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.listen(port, () => {
  console.log(`BizFile filings API listening on http://localhost:${port} (${buildId})`)
})
