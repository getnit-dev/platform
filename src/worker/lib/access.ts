import type { Context } from "hono";
import type { AppBindings, AppEnv, AuthSession, VirtualKeyContext } from "../types";

export interface RequestActor {
  mode: "session" | "api-key";
  userId: string;
  projectId: string | null;
  keyHash: string | null;
}

function getSession(c: Context<AppEnv>): AuthSession | null {
  const session = (c.var as Partial<AppEnv["Variables"]>).auth;
  if (!session?.userId) {
    return null;
  }

  return session;
}

function getApiKey(c: Context<AppEnv>): VirtualKeyContext | null {
  const apiKey = (c.var as Partial<AppEnv["Variables"]>).apiKey;
  if (!apiKey?.userId || !apiKey.keyHash) {
    return null;
  }

  return apiKey;
}

export function getRequestActor(c: Context<AppEnv>): RequestActor | null {
  const apiKey = getApiKey(c);
  if (apiKey) {
    return {
      mode: "api-key",
      userId: apiKey.userId,
      projectId: apiKey.projectId,
      keyHash: apiKey.keyHash
    };
  }

  const session = getSession(c);
  if (!session) {
    return null;
  }

  return {
    mode: "session",
    userId: session.userId,
    projectId: null,
    keyHash: null
  };
}

export async function userOwnsProject(
  env: Pick<AppBindings, "DB">,
  userId: string,
  projectId: string
): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id FROM projects WHERE id = ? AND user_id = ? LIMIT 1"
  )
    .bind(projectId, userId)
    .first<{ id: string }>();

  return Boolean(row?.id);
}

export async function resolveProjectForWrite(
  c: Context<AppEnv>,
  requestedProjectId: string | null
): Promise<{ actor: RequestActor; projectId: string } | null> {
  const actor = getRequestActor(c);
  if (!actor) {
    return null;
  }

  if (actor.mode === "api-key") {
    if (actor.projectId && requestedProjectId && actor.projectId !== requestedProjectId) {
      return null;
    }

    const projectId = actor.projectId ?? requestedProjectId;
    if (!projectId) {
      return null;
    }

    return { actor, projectId };
  }

  if (!requestedProjectId) {
    return null;
  }

  const authorized = await userOwnsProject(c.env, actor.userId, requestedProjectId);
  if (!authorized) {
    return null;
  }

  return {
    actor,
    projectId: requestedProjectId
  };
}

export async function canAccessProject(
  c: Context<AppEnv>,
  projectId: string
): Promise<boolean> {
  const actor = getRequestActor(c);
  if (!actor) {
    return false;
  }

  if (actor.mode === "api-key") {
    return actor.projectId === null || actor.projectId === projectId;
  }

  return userOwnsProject(c.env, actor.userId, projectId);
}
