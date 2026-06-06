import { NextResponse } from 'next/server';
import { synthesizeAso } from '@/lib/ai/asoAgent';
import { ProviderError } from '@/lib/ai/provider';
import { createAIProvider } from '@/lib/ai/providerFactory';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Hard cap to prevent runaway requests. Tune as needed.
const MAX_BATCH_ITEMS = 20;
const BATCH_CONCURRENCY = 3;

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Batch synthesis endpoint. Runs per-locale synthesizeAso calls with bounded
 * concurrency and returns results in input order. Per-item failures are
 * captured — one bad locale does not fail the whole batch.
 *
 * Request:
 *   { items: [{ asoPlanJson, locale }, ...] }
 *
 * Response:
 *   { results: [{ ok: true, ...synthesizeAsoResult } | { ok: false, error, code }, ...] }
 *
 * Server-side bounded concurrency wins twice:
 *   1. Locales overlap on latency without flooding the local Agent SDK.
 *   2. Concept-cache in-flight dedup means shared extraction is reused,
 *      instead of N parallel HTTP calls each doing their own.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body.' }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    return NextResponse.json({ error: 'items array is required.' }, { status: 400 });
  }
  if (items.length > MAX_BATCH_ITEMS) {
    return NextResponse.json(
      { error: `Batch too large. Max ${MAX_BATCH_ITEMS} items.` },
      { status: 400 }
    );
  }

  for (const [i, item] of items.entries()) {
    if (!item || typeof item !== 'object' || !item.asoPlanJson) {
      return NextResponse.json(
        { error: `items[${i}] missing asoPlanJson.` },
        { status: 400 }
      );
    }
  }

  const provider = createAIProvider();

  const results = await mapWithConcurrency(
    items,
    BATCH_CONCURRENCY,
    async (item) => {
      try {
        const result = await synthesizeAso({
          provider,
          asoPlanJson: item.asoPlanJson,
          locale: item.locale || item.asoPlanJson.locale,
        });
        return { ok: true, locale: item.locale || item.asoPlanJson.locale, ...result };
      } catch (err) {
        const isProviderErr = err instanceof ProviderError;
        return {
          ok: false,
          locale: item.locale || item.asoPlanJson?.locale,
          error: err.message || 'Synthesis failed.',
          code: isProviderErr ? err.code : 'UNKNOWN',
        };
      }
    }
  );

  return NextResponse.json({ results });
}
