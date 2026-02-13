import { Hono, type Context } from "hono";
import { getRequestActor, userOwnsProject } from "../lib/access";
import { sha256Hex } from "../lib/crypto";
import { asNonEmptyString, isRecord } from "../lib/validation";
import type { AppEnv } from "../types";

interface PlatformKeyRow {
  id: string;
  keyHash: string;
  projectId: string | null;
  name: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revoked: number;
  createdAt: string;
}

function createPlatformKey(): string {
  return `nit_platform_${crypto.randomUUID().replace(/-/g, "")}`;
}

async function requireSessionUserId(c: Context<AppEnv>): Promise<string | null> {
  const actor = getRequestActor(c);
  if (!actor || actor.mode !== "session") {
    return null;
  }

  return actor.userId;
}

export const platformKeyRoutes = new Hono<AppEnv>();

platformKeyRoutes.get("/", async (c) => {
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
      last_used_at AS lastUsedAt,
      expires_at AS expiresAt,
      revoked AS revoked,
      created_at AS createdAt
    FROM platform_api_keys
    WHERE user_id = ?
  `;

  const binds: Array<string | number> = [userId];
  if (projectId) {
    sql += " AND project_id = ?";
    binds.push(projectId);
  }

  sql += " ORDER BY created_at DESC";

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<PlatformKeyRow>();

  return c.json({
    keys: rows.results.map((row) => ({
      id: row.id,
      keyHashPrefix: row.keyHash.slice(0, 12),
      projectId: row.projectId,
      name: row.name,
      lastUsedAt: row.lastUsedAt,
      expiresAt: row.expiresAt,
      revoked: row.revoked !== 0,
      createdAt: row.createdAt
    }))
  });
});

platformKeyRoutes.post("/", async (c) => {
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
  const expiresAt = asNonEmptyString(payload.expiresAt);

  await c.env.DB.prepare(
    `
      INSERT INTO platform_api_keys (
        id,
        key_hash,
        user_id,
        project_id,
        name,
        last_used_at,
        expires_at,
        revoked
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, 0)
    `
  )
    .bind(
      id,
      keyHash,
      userId,
      projectId,
      name,
      expiresAt
    )
    .run();

  return c.json(
    {
      key: plainKey,
      keyId: id,
      keyHash,
      projectId,
      name,
      expiresAt
    },
    201
  );
});

platformKeyRoutes.post("/:keyId/revoke", async (c) => {
  const userId = await requireSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const keyId = c.req.param("keyId");
  const result = await c.env.DB.prepare(
    "UPDATE platform_api_keys SET revoked = 1 WHERE id = ? AND user_id = ?"
  )
    .bind(keyId, userId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Key not found" }, 404);
  }

  return c.json({ revoked: true });
});

platformKeyRoutes.delete("/:keyId", async (c) => {
  const userId = await requireSessionUserId(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const keyId = c.req.param("keyId");
  const result = await c.env.DB.prepare(
    "DELETE FROM platform_api_keys WHERE id = ? AND user_id = ?"
  )
    .bind(keyId, userId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return c.json({ error: "Key not found" }, 404);
  }

  return c.json({ deleted: true });
});
