import { Hono } from "hono";
import { canAccessProject, getRequestActor, resolveProjectForWrite } from "../lib/access";
import { asNonEmptyString, asNumber, isRecord, parseLimit } from "../lib/validation";
import type { AppEnv } from "../types";

interface FixRow {
  id: string;
  bugId: string;
  projectId: string;
  patch: string | null;
  explanation: string | null;
  confidence: number | null;
  safetyNotes: string | null;
  verificationStatus: string | null;
  r2Key: string | null;
  createdAt: string;
}

export const fixRoutes = new Hono<AppEnv>();

fixRoutes.post("/", async (c) => {
  const payload = await c.req.json<unknown>();
  if (!isRecord(payload)) {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const resolved = await resolveProjectForWrite(c, asNonEmptyString(payload.projectId));
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const bugId = asNonEmptyString(payload.bugId);
  if (!bugId) {
    return c.json({ error: "bugId is required" }, 400);
  }

  const id = crypto.randomUUID();
  const safetyNotes = Array.isArray(payload.safetyNotes)
    ? JSON.stringify(payload.safetyNotes)
    : asNonEmptyString(payload.safetyNotes);

  let r2Key: string | null = null;
  const fixedCode = asNonEmptyString(payload.fixedCode);
  if (fixedCode) {
    r2Key = `fixes/${resolved.projectId}/${id}.txt`;
    await c.env.R2.put(r2Key, fixedCode, {
      httpMetadata: { contentType: "text/plain" }
    });
  }

  await c.env.DB.prepare(
    `INSERT INTO bug_fixes (id, bug_id, project_id, patch, explanation, confidence, safety_notes, verification_status, r2_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    bugId,
    resolved.projectId,
    asNonEmptyString(payload.patch),
    asNonEmptyString(payload.explanation),
    asNumber(payload.confidence),
    safetyNotes,
    asNonEmptyString(payload.verificationStatus),
    r2Key
  ).run();

  return c.json({ fixId: id }, 201);
});

fixRoutes.get("/", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const projectId = asNonEmptyString(c.req.query("projectId"));
  const bugId = asNonEmptyString(c.req.query("bugId"));
  const limit = parseLimit(c.req.query("limit"), 50);

  let sql = `
    SELECT
      bf.id AS id, bf.bug_id AS bugId, bf.project_id AS projectId,
      bf.patch, bf.explanation, bf.confidence,
      bf.safety_notes AS safetyNotes, bf.verification_status AS verificationStatus,
      bf.r2_key AS r2Key, bf.created_at AS createdAt
    FROM bug_fixes bf
    INNER JOIN projects p ON p.id = bf.project_id
    WHERE p.user_id = ?
  `;
  const binds: Array<string | number> = [actor.userId];

  if (projectId) {
    if (!(await canAccessProject(c, projectId))) {
      return c.json({ error: "Project access denied" }, 403);
    }
    sql += " AND bf.project_id = ?";
    binds.push(projectId);
  }

  if (bugId) {
    sql += " AND bf.bug_id = ?";
    binds.push(bugId);
  }

  sql += " ORDER BY bf.created_at DESC LIMIT ?";
  binds.push(limit);

  const rows = await c.env.DB.prepare(sql).bind(...binds).all<FixRow>();
  return c.json({ fixes: rows.results });
});

fixRoutes.get("/:fixId", async (c) => {
  const actor = getRequestActor(c);
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const fixId = c.req.param("fixId");

  const row = await c.env.DB.prepare(
    `SELECT
       bf.id AS id, bf.bug_id AS bugId, bf.project_id AS projectId,
       bf.patch, bf.explanation, bf.confidence,
       bf.safety_notes AS safetyNotes, bf.verification_status AS verificationStatus,
       bf.r2_key AS r2Key, bf.created_at AS createdAt
     FROM bug_fixes bf
     INNER JOIN projects p ON p.id = bf.project_id
     WHERE bf.id = ? AND p.user_id = ?
     LIMIT 1`
  ).bind(fixId, actor.userId).first<FixRow>();

  if (!row) {
    return c.json({ error: "Fix not found" }, 404);
  }

  let fixedCode: string | null = null;
  if (row.r2Key) {
    const object = await c.env.R2.get(row.r2Key);
    fixedCode = object ? await object.text() : null;
  }

  return c.json({ fix: row, fixedCode });
});
