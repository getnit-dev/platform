import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import type { AppBindings } from "../types";

export type PlatformDatabase = DrizzleD1Database<typeof schema>;

export function getDb(env: Pick<AppBindings, "DB">): PlatformDatabase {
  return drizzle(env.DB, { schema });
}
