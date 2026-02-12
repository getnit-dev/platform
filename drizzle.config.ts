import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/worker/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: "./drizzle/local.db"
  },
  strict: true,
  verbose: true
});
