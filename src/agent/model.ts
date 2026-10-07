/** Contrato mínimo de un modelo con llamadas a herramientas (independiente del proveedor). */
export interface ToolCall {
  id: string;
  name: string;
  /** JSON con los argumentos, tal como lo emite el modelo. */
  arguments: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema de los argumentos. */
  parameters: Record<string, unknown>;
}

export interface ModelTurn {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ChatModel {
  readonly name: string;
  complete(messages: ChatMessage[], tools: ToolSpec[]): Promise<ModelTurn>;
}
