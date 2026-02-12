import { Hono, type Context } from "hono";
import { getRequestActor, userOwnsProject } from "../lib/access";
import type { AppEnv } from "../types";

interface VirtualKeyRow {
  id: string;
  keyHash: string;
  projectId: string | null;
  name: string | null;
  modelsAllowed: string | null;
  maxBudget: number | null;
  budgetDuration: string | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
  spendTotal: number;
  expiresAt: string | null;
  revoked: number;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asPositiveInteger(value: unknown): number | null {
  const numeric = asFiniteNumber(value);
  if (numeric === null || numeric <= 0) {
    return null;
  }

  return Math.floor(numeric);
}

function normalizeModelsAllowed(value: unknown): string | null {
  if (Array.isArray(value)) {
    const models = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);

    return models.length > 0 ? JSON.stringify(models) : null;
  }

  if (typeof value === "string" && value.trim()) {
    const models = value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    return models.length > 0 ? JSON.stringify(models) : null;
  }

  return null;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    return lowered === "1" || lowered === "true" || lowered === "yes";
  }

  return false;
}

function createPlatformKey(): string {
  return `nit_pk_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseModelsAllowed(modelsAllowed: string | null): string[] {
  if (!modelsAllowed) {
    return [];
  }

  try {
    const parsed = JSON.parse(modelsAllowed);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function requireSessionUserId(c: Context<AppEnv>): Promise<string | null> {
  const actor = getRequestActor(c);
  if (!actor || actor.mode !== "session") {
    return null;
  }

  return actor.userId;
}

export const llmKeyRoutes = new Hono<AppEnv>();

llmKeyRoutes.get("/", async (c) => {
  const userId = await requireSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  if (projectId && !(await userOwnsProject(c.env, userId, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  let sql = `
    SELECT
      id,
      key_hash AS keyHash,
      project_id AS projectId,
      name,
      models_allowed AS modelsAllowed,
      max_budget AS maxBudget,
      budget_duration AS budgetDuration,
      rpm_limit AS rpmLimit,
      tpm_limit AS tpmLimit,
      spend_total AS spendTotal,
      expires_at AS expiresAt,
      revoked AS revoked,
      created_at AS createdAt
    FROM virtual_keys
    WHERE user_id = ?
  `;

  const binds: Array<string | number> = [userId];
  if (projectId) {
    sql += " AND project_id = ?";
    binds.push(projectId);
  }

  sql += " ORDER BY created_at DESC";

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<VirtualKeyRow>();

  return c.json({
    keys: rows.results.map((row) => ({
      id: row.id,
      keyHash: row.keyHash,
      keyHashPrefix: row.keyHash.slice(0, 12),
      projectId: row.projectId,
      name: row.name,
      modelsAllowed: parseModelsAllowed(row.modelsAllowed),
      maxBudget: row.maxBudget,
      budgetDuration: row.budgetDuration,
      rpmLimit: row.rpmLimit,
      tpmLimit: row.tpmLimit,
      spendTotal: row.spendTotal,
      expiresAt: row.expiresAt,
      revoked: row.revoked !== 0,
      createdAt: row.createdAt
    }))
  });
});

llmKeyRoutes.post("/", async (c) => {
  const userId = await requireSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const projectId = asNonEmptyString(payload.projectId);
  if (projectId && !(await userOwnsProject(c.env, userId, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const plainKey = createPlatformKey();
  const keyHash = await sha256Hex(plainKey);

  const id = crypto.randomUUID();
  const name = asNonEmptyString(payload.name);
  const modelsAllowed = normalizeModelsAllowed(payload.modelsAllowed);
  const maxBudget = asFiniteNumber(payload.maxBudget);
  const budgetDuration = asNonEmptyString(payload.budgetDuration);
  const rpmLimit = asPositiveInteger(payload.rpmLimit);
  const tpmLimit = asPositiveInteger(payload.tpmLimit);
  const expiresAt = asNonEmptyString(payload.expiresAt);

  await c.env.DB.prepare(
    `
      INSERT INTO virtual_keys (
        id,
        key_hash,
        user_id,
        project_id,
        name,
        models_allowed,
        max_budget,
        budget_duration,
        rpm_limit,
        tpm_limit,
        spend_total,
        expires_at,
        revoked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)
    `
  )
    .bind(
      id,
      keyHash,
      userId,
      projectId,
      name,
      modelsAllowed,
      maxBudget,
      budgetDuration,
      rpmLimit,
      tpmLimit,
      expiresAt
    )
    .run();

  return c.json(
    {
      key: plainKey,
      keyId: id,
      keyHash,
      projectId,
      expiresAt
    },
    201
  );
});

llmKeyRoutes.post("/:keyId/revoke", async (c) => {
  const userId = await requireSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const keyId = c.req.param("keyId");
  const result = await c.env.DB.prepare(
    "UPDATE virtual_keys SET revoked = 1 WHERE id = ? AND user_id = ?"
  )
    .bind(keyId, userId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Key not found" }, 404);
  }

  return c.json({ revoked: true });
});

llmKeyRoutes.post("/:keyId/rotate", async (c) => {
  const userId = await requireSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const keyId = c.req.param("keyId");

  const existing = await c.env.DB.prepare(
    `
      SELECT
        id,
        project_id AS projectId,
        name,
        models_allowed AS modelsAllowed,
        max_budget AS maxBudget,
        budget_duration AS budgetDuration,
        rpm_limit AS rpmLimit,
        tpm_limit AS tpmLimit,
        expires_at AS expiresAt
      FROM virtual_keys
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `
  )
    .bind(keyId, userId)
    .first<{
      id: string;
      projectId: string | null;
      name: string | null;
      modelsAllowed: string | null;
      maxBudget: number | null;
      budgetDuration: string | null;
      rpmLimit: number | null;
      tpmLimit: number | null;
      expiresAt: string | null;
    }>();

  if (!existing) {
    return c.json({ error: "Key not found" }, 404);
  }

  await c.env.DB.prepare("UPDATE virtual_keys SET revoked = 1 WHERE id = ? AND user_id = ?")
    .bind(keyId, userId)
    .run();

  const newPlainKey = createPlatformKey();
  const newHash = await sha256Hex(newPlainKey);
  const newKeyId = crypto.randomUUID();

  await c.env.DB.prepare(
    `
      INSERT INTO virtual_keys (
        id,
        key_hash,
        user_id,
        project_id,
        name,
        models_allowed,
        max_budget,
        budget_duration,
        rpm_limit,
        tpm_limit,
        spend_total,
        expires_at,
        revoked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0)
    `
  )
    .bind(
      newKeyId,
      newHash,
      userId,
      existing.projectId,
      existing.name,
      existing.modelsAllowed,
      existing.maxBudget,
      existing.budgetDuration,
      existing.rpmLimit,
      existing.tpmLimit,
      existing.expiresAt
    )
    .run();

  return c.json({
    revokedKeyId: keyId,
    keyId: newKeyId,
    key: newPlainKey,
    keyHash: newHash
  });
});

llmKeyRoutes.patch("/:keyId", async (c) => {
  const userId = await requireSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const keyId = c.req.param("keyId");
  const payload = await c.req.json<unknown>();

  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const updates: string[] = [];
  const binds: Array<string | number | null> = [];

  if ("name" in payload) {
    updates.push("name = ?");
    binds.push(asNonEmptyString(payload.name));
  }

  if ("modelsAllowed" in payload) {
    updates.push("models_allowed = ?");
    binds.push(normalizeModelsAllowed(payload.modelsAllowed));
  }

  if ("maxBudget" in payload) {
    updates.push("max_budget = ?");
    binds.push(asFiniteNumber(payload.maxBudget));
  }

  if ("budgetDuration" in payload) {
    updates.push("budget_duration = ?");
    binds.push(asNonEmptyString(payload.budgetDuration));
  }

  if ("rpmLimit" in payload) {
    updates.push("rpm_limit = ?");
    binds.push(asPositiveInteger(payload.rpmLimit));
  }

  if ("tpmLimit" in payload) {
    updates.push("tpm_limit = ?");
    binds.push(asPositiveInteger(payload.tpmLimit));
  }

  if ("expiresAt" in payload) {
    updates.push("expires_at = ?");
    binds.push(asNonEmptyString(payload.expiresAt));
  }

  if ("revoked" in payload) {
    updates.push("revoked = ?");
    binds.push(parseBoolean(payload.revoked) ? 1 : 0);
  }

  if (updates.length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  const result = await c.env.DB.prepare(
    `
      UPDATE virtual_keys
      SET ${updates.join(", ")}
      WHERE id = ? AND user_id = ?
    `
  )
    .bind(...binds, keyId, userId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Key not found" }, 404);
  }

  return c.json({ updated: true });
});
