import type { ChatMessage, ChatModel, ModelTurn, ToolSpec } from "./model.js";

type Fetch = typeof fetch;

/**
 * Adaptador de OpenAI Chat Completions con herramientas. El modelo se configura
 * (p. ej. OPENAI_CHAT_MODEL); la clave va en OPENAI_API_KEY, nunca en el Vault.
 */
export class OpenAIChatModel implements ChatModel {
  constructor(
    private readonly apiKey: string,
    readonly name: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    if (!apiKey) throw new Error("Falta la clave de OpenAI");
    if (!name) throw new Error("Falta el nombre del modelo");
  }

  async complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelTurn> {
    const response = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.name,
        messages: messages.map(toOpenAI),
        ...(tools.length
          ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
          : {}),
      }),
    });
    if (!response.ok) throw new Error(`OpenAI chat: HTTP ${response.status}`);
    const body = (await response.json()) as {
      choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    const message = body.choices[0]?.message;
    if (!message) throw new Error("OpenAI chat: respuesta sin mensaje");
    return {
      content: message.content,
      toolCalls: (message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
      ...(body.usage ? { usage: { inputTokens: body.usage.prompt_tokens, outputTokens: body.usage.completion_tokens } } : {}),
    };
  }
}

function toOpenAI(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  if (m.role === "assistant") {
    return {
      role: "assistant",
      content: m.content,
      ...(m.toolCalls?.length
        ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) }
        : {}),
    };
  }
  return { role: m.role, content: m.content };
}
