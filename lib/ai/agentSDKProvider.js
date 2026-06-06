/**
 * Agent SDK provider — uses local Claude Code subprocess via @anthropic-ai/claude-agent-sdk.
 *
 * Requirements:
 *   - User has Claude Code installed and logged in on this machine.
 *   - Next.js route MUST run on Node runtime (NOT Edge).
 *
 * Constraints:
 *   - Subprocess boot ~3-8s overhead per call.
 *   - Burns user's Claude Code session quota.
 *   - Single-machine only — does not work in deployed multi-user app.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { ProviderError } from './provider.js';

const DEFAULT_MAX_TURNS = 1;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

function createPromptIterable(text) {
  async function* gen() {
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    };
  }
  return gen();
}

export class AgentSDKProvider {
  constructor(options = {}) {
    this.model = options.model || DEFAULT_MODEL;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.cwd = options.cwd || process.cwd();
  }

  /**
   * @param {{systemPrompt: string, userPrompt: string, abortSignal?: AbortSignal, model?: string}} input
   */
  async generate({ systemPrompt, userPrompt, abortSignal, model }) {
    if (!systemPrompt || !userPrompt) {
      throw new ProviderError('systemPrompt and userPrompt required', { code: 'BAD_INPUT' });
    }

    const abortController = new AbortController();
    if (abortSignal) {
      if (abortSignal.aborted) abortController.abort();
      else abortSignal.addEventListener('abort', () => abortController.abort(), { once: true });
    }

    let result;
    try {
      const q = query({
        prompt: createPromptIterable(userPrompt),
        options: {
          systemPrompt,
          model: model || this.model,
          maxTurns: this.maxTurns,
          cwd: this.cwd,
          permissionMode: 'bypassPermissions',
          allowedTools: [],
          abortController,
        },
      });

      for await (const message of q) {
        if (message.type === 'result') {
          result = message;
          break;
        }
      }
    } catch (err) {
      throw new ProviderError(`Agent SDK query failed: ${err.message}`, {
        cause: err,
        code: 'SDK_QUERY_FAILED',
      });
    }

    if (!result) {
      throw new ProviderError('Agent SDK returned no result message', { code: 'NO_RESULT' });
    }

    if (result.subtype !== 'success' || result.is_error) {
      throw new ProviderError(
        `Agent SDK returned error: ${result.result || result.subtype}`,
        { code: 'SDK_ERROR' }
      );
    }

    // Surface cache stats so callers can verify prompt caching is working.
    // The Anthropic Agent SDK enables caching automatically for system
    // prompts large enough to qualify (≥1024 tokens on Sonnet). Caching
    // requires that the system prompt is byte-identical across calls —
    // currently true within retries for the same locale (system prompt is
    // built once outside the retry loop) and identical across locales that
    // share brand/category/preLaunch. To improve cross-locale cache hit
    // rate further, move locale-specific bits (lang/country) into the user
    // prompt instead of system prompt.
    const usage = result.usage || {};
    const cacheReadTokens =
      usage.cache_read_input_tokens ??
      usage.cacheReadInputTokens ??
      0;
    const cacheCreationTokens =
      usage.cache_creation_input_tokens ??
      usage.cacheCreationInputTokens ??
      0;
    const inputTokens = usage.input_tokens ?? usage.inputTokens ?? 0;
    const outputTokens = usage.output_tokens ?? usage.outputTokens ?? 0;

    return {
      text: result.result || '',
      costUsd: result.total_cost_usd,
      durationMs: result.duration_ms,
      model: model || this.model,
      usage: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        cacheHitRatio: inputTokens > 0
          ? cacheReadTokens / (inputTokens + cacheReadTokens)
          : 0,
      },
    };
  }
}
