import { NextResponse } from 'next/server';
import { AgentSDKProvider } from '@/lib/ai/agentSDKProvider';
import { synthesizeAso } from '@/lib/ai/asoAgent';
import { ProviderError } from '@/lib/ai/provider';

export const runtime = 'nodejs';
export const maxDuration = 90;

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body.' }, { status: 400 });
  }

  const { asoPlanJson, locale } = body;
  if (!asoPlanJson || typeof asoPlanJson !== 'object') {
    return NextResponse.json({ error: 'asoPlanJson is required.' }, { status: 400 });
  }

  const provider = new AgentSDKProvider();

  try {
    const result = await synthesizeAso({
      provider,
      asoPlanJson,
      locale: locale || asoPlanJson.locale,
    });

    return NextResponse.json(result);
  } catch (err) {
    const isProviderErr = err instanceof ProviderError;
    const status = isProviderErr && err.code === 'BAD_INPUT' ? 400 : 502;
    return NextResponse.json(
      {
        error: err.message || 'Synthesis failed.',
        code: isProviderErr ? err.code : 'UNKNOWN',
      },
      { status }
    );
  }
}
