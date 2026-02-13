import { normalizeUsageEvent } from "../lib/usage-events";
import type { AppBindings, UsageEvent } from "../types";

function buildInsertStatement(env: Pick<AppBindings, "DB">, event: UsageEvent): D1PreparedStatement {
  return env.DB.prepare(
    `
      INSERT INTO usage_events (
        id,
        user_id,
        project_id,
        key_hash,
        model,
        provider,
        prompt_tokens,
        completion_tokens,
        cost_usd,
        cache_hit,
        source,
        timestamp,
        session_id,
        duration_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).bind(
    crypto.randomUUID(),
    event.userId,
    event.projectId,
    event.keyHash,
    event.model,
    event.provider,
    event.promptTokens,
    event.completionTokens,
    event.costUsd,
    event.cacheHit ? 1 : 0,
    event.source,
    event.timestamp,
    event.sessionId,
    event.durationMs
  );
}

export async function consumeUsageEventsBatch(
  batch: MessageBatch<unknown>,
  env: Pick<AppBindings, "DB">
): Promise<void> {
  const validMessages: Array<Message<unknown>> = [];
  const statements: D1PreparedStatement[] = [];

  for (const message of batch.messages) {
    const normalized = normalizeUsageEvent(message.body, "byok");
    if (!normalized) {
      message.ack();
      continue;
    }

    validMessages.push(message);
    statements.push(buildInsertStatement(env, normalized));
  }

  if (statements.length === 0) {
    return;
  }

  try {
    await env.DB.batch(statements);

    for (const message of validMessages) {
      message.ack();
    }
  } catch {
    for (const message of validMessages) {
      message.retry();
    }
  }
}
