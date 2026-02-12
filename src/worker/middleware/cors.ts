import { cors } from "hono/cors";

const ALLOWED_ORIGINS = [
  "https://getnit.dev",
  "https://platform.getnit.dev",
  "http://localhost:5173"
];

export const corsMiddleware = cors({
  origin: ALLOWED_ORIGINS,
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-Nit-Platform-Key",
    "X-Api-Key",
    "X-Nit-Byok-Alias",
    "X-Nit-Provider-Authorization",
    "X-Nit-Estimated-Prompt-Tokens",
    "X-Nit-Estimated-Completion-Tokens"
  ],
  credentials: true,
  maxAge: 86400
});
