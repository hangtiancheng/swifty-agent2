// Direct connection to the embeddings upstream (OpenAI-compatible).
import OpenAI from "openai";

import { settings } from "#/config.ts";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  // Process-wide singleton: reuse one HTTP connection pool for all embed calls.
  if (client === null) {
    client = new OpenAI({ baseURL: settings.embedBaseUrl, apiKey: settings.embedApiKey });
  }
  return client;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const resp = await getClient().embeddings.create({ model: settings.embedModel, input: texts });
  return resp.data.map((d) => d.embedding);
}

export async function embedQuery(text: string): Promise<number[]> {
  return (await embedTexts([text]))[0];
}
