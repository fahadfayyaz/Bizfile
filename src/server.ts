import express, { type NextFunction, type Request, type Response } from 'express';
import { session } from './browser';
import { config, describeConfig } from './config';
import { AppError, TimeoutError } from './errors';
import { getFilings } from './scraper';
import type { FilingsRequest } from './types';

const app = express();
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', config: describeConfig() });
});

/** Fail the request rather than hang forever if BizFile stops responding. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(`Request exceeded ${ms}ms`)),
      ms,
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

app.post(
  '/api/sgp/filings',
  async (req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    const body = (req.body ?? {}) as FilingsRequest;
    const label = body.companyNumber || body.companyName || '(empty)';
    console.log(`[filings] -> ${label}`);

    try {
      const result = await withTimeout(getFilings(body), config.requestTimeoutMs);
      console.log(
        `[filings] <- ${result.companyNumber} ${result.filings.length} filing(s) in ${Date.now() - started}ms`,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

app.use((req, res) => {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  });
});

// Structured errors, never a bare stack trace.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    console.warn(`[filings] !! ${err.code}: ${err.message}`);
    res.status(err.httpStatus).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('[filings] !! unhandled:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message } });
});

const server = app.listen(config.port, () => {
  console.log(`BizFile filings service listening on http://localhost:${config.port}`);
  console.log('Config:', describeConfig());
  console.log('POST /api/sgp/filings  { "companyName": "..." }  or  { "companyNumber": "..." }');
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, shutting down.`);
  server.close();
  await session.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
