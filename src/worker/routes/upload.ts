import { Hono } from "hono";
import { canAccessProject, resolveProjectForWrite } from "../lib/access";
import { asNonEmptyString } from "../lib/validation";
import type { AppEnv } from "../types";

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function extractProjectIdFromKey(key: string): string | null {
  const segments = key.split("/").filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  return segments[1] ?? null;
}

export const uploadRoutes = new Hono<AppEnv>();

uploadRoutes.post("/", async (c) => {
  const queryProjectId = asNonEmptyString(c.req.query("projectId"));
  const resolved = await resolveProjectForWrite(c, queryProjectId);
  if (!resolved) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength === 0) {
    return c.json({ error: "Upload body is empty" }, 400);
  }

  const filename = sanitizeFilename(asNonEmptyString(c.req.query("filename")) ?? `${crypto.randomUUID()}.json`);
  const contentType =
    asNonEmptyString(c.req.header("content-type")) ?? "application/octet-stream";

  const objectKey = `uploads/${resolved.projectId}/${crypto.randomUUID()}-${filename}`;

  await c.env.R2.put(objectKey, body, {
    httpMetadata: {
      contentType
    }
  });

  return c.json(
    {
      key: objectKey,
      projectId: resolved.projectId,
      size: body.byteLength,
      contentType
    },
    201
  );
});

uploadRoutes.get("/", async (c) => {
  const key = asNonEmptyString(c.req.query("key"));
  if (!key) {
    return c.json({ error: "Missing key query parameter" }, 400);
  }

  const projectId = extractProjectIdFromKey(key);
  if (!projectId || !(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  const object = await c.env.R2.get(key);
  if (!object) {
    return c.json({ error: "File not found" }, 404);
  }

  const headers = new Headers();
  if (object.httpMetadata?.contentType) {
    headers.set("content-type", object.httpMetadata.contentType);
  }

  return new Response(object.body, {
    status: 200,
    headers
  });
});

uploadRoutes.delete("/", async (c) => {
  const key = asNonEmptyString(c.req.query("key"));
  if (!key) {
    return c.json({ error: "Missing key query parameter" }, 400);
  }

  const projectId = extractProjectIdFromKey(key);
  if (!projectId || !(await canAccessProject(c, projectId))) {
    return c.json({ error: "Project access denied" }, 403);
  }

  await c.env.R2.delete(key);
  return c.json({ deleted: true });
});
