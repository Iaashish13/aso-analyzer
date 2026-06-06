import { AgentSDKProvider } from './agentSDKProvider.js';
import { AnthropicAPIProvider } from './anthropicAPIProvider.js';

export function createAIProvider() {
  const requested = (process.env.AI_PROVIDER || '').toLowerCase();

  if (requested === 'agent' || requested === 'agent-sdk') {
    return new AgentSDKProvider();
  }
  if (requested === 'anthropic' || requested === 'api') {
    return new AnthropicAPIProvider();
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicAPIProvider();
  }

  return new AgentSDKProvider();
}
