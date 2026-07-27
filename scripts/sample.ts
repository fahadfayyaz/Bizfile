/**
 * Generates the sample JSON files in ./samples.
 *
 *   npm run sample                       -- runs the default set
 *   npm run sample -- 196300440G UNFOLD  -- runs specific UENs / names
 */
import fs from 'node:fs';
import path from 'node:path';
import { session } from '../src/browser';
import { getFilings } from '../src/scraper';
import type { FilingsRequest } from '../src/types';

const DEFAULTS: FilingsRequest[] = [
  { companyNumber: '196300440G' },              // FRASERS PROPERTY LIMITED
  { companyName: 'UNFOLD PTE. LTD.' },          // resolves by name
  { companyNumber: '202245370D' },              // KODLAND PTE. LTD.
  { companyNumber: '201411189G' },              // ECOMMERCE ENABLERS PTE. LTD.
];

function parseArgs(): FilingsRequest[] {
  const args = process.argv.slice(2);
  if (args.length === 0) return DEFAULTS;
  return args.map((a) =>
    /^[0-9]{8,9}[A-Z]$/i.test(a) ? { companyNumber: a } : { companyName: a },
  );
}

async function main(): Promise<void> {
  const outDir = path.resolve(__dirname, '..', 'samples');
  fs.mkdirSync(outDir, { recursive: true });

  for (const input of parseArgs()) {
    const label = input.companyNumber ?? input.companyName ?? 'unknown';
    process.stdout.write(`\n=== ${label} ===\n`);
    try {
      const result = await getFilings(input);
      const file = path.join(outDir, `${result.companyNumber}.json`);
      fs.writeFileSync(file, JSON.stringify(result, null, 2));
      console.log(`${result.companyName} -> ${result.filings.length} filing(s)`);
      console.log(`written: ${path.relative(process.cwd(), file)}`);
      for (const f of result.filings.slice(0, 5)) {
        console.log(`  ${f.filingDate}  ${f.docName}`);
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      console.error(`FAILED  ${e.code ?? 'ERROR'}: ${e.message ?? String(err)}`);
    }
  }

  await session.close();
}

void main();
