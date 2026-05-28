/**
 * Provider abstraction for AI synthesis. Swap engines without touching agents.
 *
 * Contract:
 *   generate({ systemPrompt, userPrompt, abortSignal }) → { text, usage?, costUsd? }
 *
 * Current impls:
 *   - AgentSDKProvider — local Claude Code subprocess via @anthropic-ai/claude-agent-sdk
 *
 * Future:
 *   - AnthropicAPIProvider — direct API key path (production)
 *   - OllamaProvider — local LLM fallback
 */

export class ProviderError extends Error {
  constructor(message, { cause, code } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code || 'PROVIDER_ERROR';
    if (cause) this.cause = cause;
  }
}

/**
 * @typedef {Object} GenerateInput
 * @property {string} systemPrompt
 * @property {string} userPrompt
 * @property {AbortSignal} [abortSignal]
 * @property {string} [model]
 *
 * @typedef {Object} GenerateOutput
 * @property {string} text
 * @property {number} [costUsd]
 * @property {number} [durationMs]
 * @property {string} [model]
 */

/**
 * @returns {Promise<GenerateOutput>}
 */
export async function generate(provider, input) {
  if (!provider || typeof provider.generate !== 'function') {
    throw new ProviderError('Invalid provider — missing generate()', { code: 'BAD_PROVIDER' });
  }
  return provider.generate(input);
}
