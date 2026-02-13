import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Github } from "lucide-react";

export function LoginPage(props: { callbackUrl: string }) {
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath =
    typeof location.state === "object" && location.state !== null && "from" in location.state
      ? String((location.state as { from?: string }).from ?? "/")
      : "/";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    try {
      await api.auth.login({
        email,
        password
      });

      window.location.href = nextPath;
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "Unable to sign in";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  async function onGithubLogin() {
    setPending(true);
    setError(null);

    try {
      const response = await api.auth.loginWithGithub({ callbackURL: props.callbackUrl });
      if (!response.url) {
        throw new Error("Missing GitHub OAuth redirect URL");
      }

      window.location.assign(response.url);
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : "GitHub login failed";
      setError(message);
      setPending(false);
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-10 bg-background">
      {/* Soft gradient blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/3 right-0 h-[60%] w-[50%] rounded-full bg-primary/8 blur-[100px]" />
        <div className="absolute bottom-0 left-0 h-[40%] w-[40%] rounded-full bg-primary/5 blur-[80px]" />
      </div>

      <Card className="relative w-full max-w-md shadow-lg">
        <CardHeader className="space-y-4 text-center pb-4">
          <div className="flex items-center justify-center gap-2">
            <img src="/favicon.svg" alt="nit" className="w-12 h-12" />
            <span className="mono text-3xl font-bold text-brand">nit</span>
          </div>

          <div className="space-y-1">
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>
              Sign in to access your coverage, drift, and usage dashboard
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Signing in..." : "Sign in"}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={onGithubLogin}
                disabled={pending}
                className="w-full"
              >
                <Github className="mr-2 h-4 w-4" />
                GitHub
              </Button>
            </div>
          </form>

          <div className="text-center text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link
              to="/register"
              className="font-medium text-primary hover:text-primary/80 underline underline-offset-4"
            >
              Create account
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
