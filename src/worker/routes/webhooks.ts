import { Hono } from "hono";
import { safeEqual } from "../lib/crypto";
import type { AppEnv } from "../types";

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function computeGithubSignature(secret: string, payload: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign("HMAC", key, payload);
  return `sha256=${toHex(digest)}`;
}

export const webhookRoutes = new Hono<AppEnv>();

webhookRoutes.post("/github", async (c) => {
  const secret = c.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: "GitHub webhook secret not configured" }, 503);
  }

  const signature = c.req.header("x-hub-signature-256");
  if (!signature) {
    return c.json({ error: "Missing GitHub signature" }, 401);
  }

  const payloadBuffer = await c.req.arrayBuffer();
  const expectedSignature = await computeGithubSignature(secret, payloadBuffer);
  if (!safeEqual(signature, expectedSignature)) {
    return c.json({ error: "Invalid GitHub signature" }, 401);
  }

  const eventName = c.req.header("x-github-event") ?? "unknown";
  const deliveryId = c.req.header("x-github-delivery") ?? crypto.randomUUID();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const objectKey = `webhooks/github/${day}/${eventName}-${deliveryId}.json`;

  await c.env.R2.put(objectKey, payloadBuffer, {
    httpMetadata: {
      contentType: "application/json"
    }
  });

  return c.json({
    accepted: true,
    event: eventName,
    deliveryId
  });
});
