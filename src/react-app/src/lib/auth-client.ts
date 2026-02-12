import { createAuthClient } from "better-auth/client";
import { cloudflareClient } from "better-auth-cloudflare/client";

const baseURL = import.meta.env.VITE_PLATFORM_API_BASE_URL ?? window.location.origin;

const client = createAuthClient({
  baseURL,
  plugins: [cloudflareClient()]
});

export const authClient: unknown = client;

export default authClient;
