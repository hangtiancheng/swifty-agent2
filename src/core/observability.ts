// Langfuse observability: OTEL-based tracing that degrades to a no-op when unconfigured.
// Traces are recorded at turn end with session id, intent tag, output and token usage.
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

import { settings } from "@/config.ts";
import { childLogger } from "@/logger.ts";

const log = childLogger("observability");

let sdk: NodeSDK | null = null;

export function langfuseEnabled(): boolean {
  return Boolean(settings.langfusePublicKey && settings.langfuseSecretKey && settings.langfuseBaseUrl);
}

export function initObservability(): void {
  if (!langfuseEnabled() || sdk !== null) {
    return;
  }
  try {
    sdk = new NodeSDK({
      spanProcessors: [
        new LangfuseSpanProcessor({
          publicKey: settings.langfusePublicKey,
          secretKey: settings.langfuseSecretKey,
          baseUrl: settings.langfuseBaseUrl,
        }),
      ],
    });
    sdk.start();
    log.info({ base_url: settings.langfuseBaseUrl }, "langfuse tracing enabled");
  } catch (error) {
    log.warn({ err: error }, "failed to start langfuse tracing; continuing without it");
    sdk = null;
  }
}

export async function shutdownObservability(): Promise<void> {
  if (sdk !== null) {
    await sdk.shutdown();
    sdk = null;
  }
}

export interface TurnRecord {
  sessionId: number;
  input: unknown;
  intent?: string | undefined;
  intentConfidence?: number | undefined;
  output?: string | undefined;
  totalTokens?: number | undefined;
}

export function recordTurn(record: TurnRecord): void {
  // Observability is an enhancement: every failure is swallowed.
  if (!langfuseEnabled()) {
    return;
  }
  const metadata: Record<string, string> = {};
  const tags: string[] = [];
  if (record.intent) {
    metadata.intent = record.intent;
    metadata.intent_confidence = (record.intentConfidence ?? 0).toFixed(2);
    tags.push(`intent:${record.intent}`);
  }
  try {
    propagateAttributes({ sessionId: String(record.sessionId), metadata, tags }, () => {
      startActiveObservation(
        "chat-turn",
        (generation) => {
          generation.update({
            input: record.input,
            output: record.output ?? "",
            model: settings.chatModel,
            usageDetails: { total: record.totalTokens ?? 0 },
          });
        },
        { asType: "generation" },
      );
    });
  } catch (error) {
    log.warn({ err: error }, "langfuse record_turn failed (ignored)");
  }
}

export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

export function langfuseConfig(): LangfuseConfig | null {
  if (!langfuseEnabled()) {
    return null;
  }
  return {
    publicKey: settings.langfusePublicKey,
    secretKey: settings.langfuseSecretKey,
    baseUrl: settings.langfuseBaseUrl,
  };
}
