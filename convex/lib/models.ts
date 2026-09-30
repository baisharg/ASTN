// Central model configuration — change here to update everywhere
// FAST: structured extraction, classification, simple tasks
export const MODEL_FAST = 'claude-haiku-4-5'
// QUALITY: user-facing conversation, career actions
export const MODEL_QUALITY = 'claude-sonnet-4-6'
// SOCIAL_SUGGESTIONS: who should meet whom at in-person events
// Routed through the Vercel AI Gateway (needs AI_GATEWAY_API_KEY)
export const MODEL_SOCIAL_SUGGESTIONS = 'openai/gpt-6-luna'
// GEMINI_FAST: matching (structured JSON output, cheap)
export const MODEL_GEMINI_FAST = 'gemini-3-flash-preview'

// --- Provider-aware conversation model config ---

export type ModelProvider = 'anthropic' | 'openai-compatible'

export type ConversationModelConfig = {
  model: string
  provider: ModelProvider
  baseUrl: string
  apiKeyEnv: string
  maxTokens: number
}

const _SONNET_4_6: ConversationModelConfig = {
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com/v1/messages',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  maxTokens: 500,
}

const KIMI_K2_5: ConversationModelConfig = {
  model: 'kimi-k2.5',
  provider: 'openai-compatible',
  baseUrl: 'https://api.moonshot.cn/v1/chat/completions',
  apiKeyEnv: 'KIMI_API_KEY',
  maxTokens: 500,
}

// Swap this one line to change the conversation model
// export const MODEL_CONVERSATION: ConversationModelConfig = _SONNET_4_6
export const MODEL_CONVERSATION: ConversationModelConfig = KIMI_K2_5

// Suppress unused-variable lint for the inactive config
void _SONNET_4_6
