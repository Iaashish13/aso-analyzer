import { NextResponse } from 'next/server';
import { AgentSDKProvider } from '@/lib/ai/agentSDKProvider';
import { synthesizeAso } from '@/lib/ai/asoAgent';
import { ProviderError } from '@/lib/ai/provider';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Hard cap to prevent runaway requests. Tune as needed.
const MAX_BATCH_ITEMS = 20;

/**
 * Batch synthesis endpoint. Fans out per-locale synthesizeAso calls in
 * parallel and returns results in input order. Per-item failures are
 * captured — one bad locale does not fail the whole batch.
 *
 * Request:
 *   { items: [{ asoPlanJson, locale }, ...] }
 *
 * Response:
 *   { results: [{ ok: true, ...synthesizeAsoResult } | { ok: false, error, code }, ...] }
 *
 * Server-side parallelism wins twice:
 *   1. Concurrent locales overlap on latency (single roundtrip for caller).
 *   2. Concept-cache in-flight dedup means the first locale's concept
 *      extraction is reused by all others, instead of N parallel HTTP calls
 *      each doing their own.
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

  const provider = new AgentSDKProvider();

  const results = await Promise.all(
    items.map(async (item) => {
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
    })
  );

  return NextResponse.json({ results });
}
