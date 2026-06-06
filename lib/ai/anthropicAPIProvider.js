/**
 * Direct Anthropic Messages API provider.
 *
 * Uses regular text generation by default. When `tool` is supplied, forces a
 * client tool call and returns the tool input as JSON text, giving callers a
 * structured-output path while preserving the existing provider contract.
 */

import { ProviderError } from './provider.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 12000;
const ANTHROPIC_VERSION = '2023-06-01';
const API_URL = 'https://api.anthropic.com/v1/messages';

function classifyStatus(status, payload) {
  const text = JSON.stringify(payload || {}).toLowerCase();

  if (status === 401 || status === 403 || text.includes('authentication')) {
    return 'ANTHROPIC_AUTH_FAILED';
  }
  if (status === 429 || text.includes('rate_limit') || text.includes('quota')) {
    return 'ANTHROPIC_QUOTA_EXHAUSTED';
  }
  if (status >= 500) {
    return 'ANTHROPIC_API_UNAVAILABLE';
  }

  return 'ANTHROPIC_API_ERROR';
}

function extractText(content) {
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function extractToolInput(content, toolName) {
  return (Array.isArray(content) ? content : []).find(
    (block) => block?.type === 'tool_use' && block.name === toolName
  )?.input;
}

export class AnthropicAPIProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = options.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
    this.maxTokens = options.maxTokens || Number(process.env.ANTHROPIC_MAX_TOKENS) || DEFAULT_MAX_TOKENS;
  }

  /**
   * @param {{systemPrompt: string, userPrompt: string, abortSignal?: AbortSignal, model?: string, tool?: {name: string, description: string, inputSchema: object}}} input
   */
  async generate({ systemPrompt, userPrompt, abortSignal, model, tool }) {
    if (!this.apiKey) {
      throw new ProviderError('ANTHROPIC_API_KEY is required for Anthropic API provider', {
        code: 'ANTHROPIC_API_KEY_MISSING',
      });
    }
    if (!systemPrompt || !userPrompt) {
      throw new ProviderError('systemPrompt and userPrompt required', { code: 'BAD_INPUT' });
    }

    const body = {
      model: model || this.model,
      max_tokens: this.maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    };

    if (tool) {
      body.tools = [
        {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        },
      ];
      body.tool_choice = { type: 'tool', name: tool.name };
    }

    const started = Date.now();
    let response;
    let payload;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
        signal: abortSignal,
      });
      payload = await response.json();
    } catch (err) {
      throw new ProviderError(`Anthropic API request failed: ${err.message}`, {
        cause: err,
        code: String(err?.name).toLowerCase() === 'aborterror'
          ? 'ABORTED'
          : 'ANTHROPIC_API_UNAVAILABLE',
      });
    }

    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || response.statusText;
      throw new ProviderError(`Anthropic API error: ${message}`, {
        code: classifyStatus(response.status, payload),
      });
    }

    const toolInput = tool ? extractToolInput(payload.content, tool.name) : null;
    if (tool && !toolInput) {
      throw new ProviderError('Anthropic API response did not include expected tool output', {
        code: 'ANTHROPIC_TOOL_OUTPUT_MISSING',
      });
    }

    const usage = payload.usage || {};
    return {
      text: tool ? JSON.stringify(toolInput) : extractText(payload.content),
      costUsd: undefined,
      durationMs: Date.now() - started,
      model: payload.model || model || this.model,
      usage: {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
        cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      },
    };
  }
}
