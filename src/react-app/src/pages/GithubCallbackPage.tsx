import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Panel } from "../components/ui";
import { api, type DashboardUser } from "../lib/api";

export function GithubCallbackPage(props: { onAuthenticated: (user: DashboardUser) => void }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveSession() {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const me = await api.dashboard.me();
          if (cancelled) {
            return;
          }

          props.onAuthenticated(me);
          navigate("/", { replace: true });
          return;
        } catch {
          await new Promise((resolve) => {
            setTimeout(resolve, 350);
          });
        }
      }

      if (!cancelled) {
        setError("Unable to confirm GitHub session. Please try signing in again.");
      }
    }

    void resolveSession();

    return () => {
      cancelled = true;
    };
  }, [navigate, props]);

  return (
    <div className="grid min-h-screen place-items-center px-4 py-8">
      <Panel className="w-full max-w-md text-center">
        <p className="text-xs font-semibold text-primary">GitHub OAuth</p>
        <p className="mt-3 text-lg font-semibold">Finalizing sign-in…</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {error ?? "Setting up your dashboard session."}
        </p>
      </Panel>
    </div>
  );
}
