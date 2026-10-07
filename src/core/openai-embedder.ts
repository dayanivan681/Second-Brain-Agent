import type { Embedder } from "./semantic.js";

type Fetch = typeof fetch;

/**
 * Embeddings de OpenAI. La clave va en una variable de entorno del servidor
 * (OPENAI_API_KEY), nunca en el Vault. Verificar privacidad y precios antes de usar.
 */
export class OpenAIEmbedder implements Embedder {
  readonly dimensions = 1536;

  constructor(
    private readonly apiKey: string,
    readonly model = "text-embedding-3-small",
    private readonly fetchImpl: Fetch = fetch,
  ) {
    if (!apiKey) throw new Error("Falta la clave de OpenAI");
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.fetchImpl("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts, dimensions: this.dimensions }),
    });
    if (!response.ok) throw new Error(`OpenAI embeddings: HTTP ${response.status}`);
    const body = (await response.json()) as { data: Array<{ index: number; embedding: number[] }> };
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== texts.length || vectors.some((v) => v.length !== this.dimensions)) {
      throw new Error("OpenAI embeddings: respuesta con forma inesperada");
    }
    return vectors;
  }
}
