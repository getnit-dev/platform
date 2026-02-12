import { useEffect, useMemo, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { CommandPalette } from "./components/features/CommandPalette";
import { NavigationProvider } from "./lib/navigation-context";
import { api, ApiError, type DashboardUser } from "./lib/api";
import { Sentry } from "./lib/sentry";
import { GithubCallbackPage } from "./pages/GithubCallbackPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectBugsPage } from "./pages/ProjectBugsPage";
import { ProjectRunsPage } from "./pages/ProjectRunsPage";
import { ProjectDriftPage } from "./pages/ProjectDriftPage";
import { ProjectMemoryPage } from "./pages/ProjectMemoryPage";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage";
import { ProjectUsagePage } from "./pages/ProjectUsagePage";
import { ProjectCoveragePage } from "./pages/ProjectCoveragePage";
import { ProjectsOverviewPage } from "./pages/ProjectsOverviewPage";
import { RegisterPage } from "./pages/RegisterPage";
import { Card, CardContent } from "./components/ui/card";

interface AuthState {
  loading: boolean;
  user: DashboardUser | null;
}

function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center px-4 bg-background">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center">
          <p className="mono text-xs uppercase tracking-widest text-accent">nit platform</p>
          <p className="mt-3 text-sm text-muted-foreground">Loading dashboard context…</p>
        </CardContent>
      </Card>
    </div>
  );
}

function AppFrame(props: { user: DashboardUser }) {
  return (
    <NavigationProvider>
      <AppShell user={props.user} />
    </NavigationProvider>
  );
}

function ProtectedRoutes(props: { user: DashboardUser | null }) {
  const location = useLocation();

  console.log("[ProtectedRoutes] User:", props.user, "Location:", location.pathname);

  if (!props.user) {
    console.log("[ProtectedRoutes] No user, redirecting to /login");
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  console.log("[ProtectedRoutes] User authenticated, rendering AppFrame");
  return <AppFrame user={props.user} />;
}

function PublicAuthRoutes(props: { user: DashboardUser | null }) {
  if (props.user) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ loading: true, user: null });

  console.log("[App] Render - auth state:", auth);

  useEffect(() => {
    let active = true;

    async function load() {
      console.log("[App] Loading user data...");
      try {
        const me = await api.dashboard.me();
        console.log("[App] Dashboard API response:", me);

        if (!active) {
          console.log("[App] Component unmounted, ignoring response");
          return;
        }

        console.log("[App] Setting auth state with user:", me);
        Sentry.setUser(me ? { id: me.userId } : null);
        setAuth({ loading: false, user: me });
      } catch (error) {
        if (!active) {
          return;
        }

        // 401 is expected when not logged in - don't log it as an error
        if (error instanceof ApiError && error.status === 401) {
          console.log("[App] Not authenticated (401), setting user to null");
          Sentry.setUser(null);
          setAuth({ loading: false, user: null });
          return;
        }

        console.error("[App] Unexpected error loading user:", error);
        setAuth({ loading: false, user: null });
      }
    }

    void load();

    return () => {
      console.log("[App] Cleanup - setting active to false");
      active = false;
    };
  }, []);

  const callbackTarget = useMemo(() => `${window.location.origin}/auth/github/callback`, []);

  if (auth.loading) {
    return <LoadingScreen />;
  }

  return (
    <>
      {auth.user && <CommandPalette />}
      <Routes>
        <Route element={<PublicAuthRoutes user={auth.user} />}>
          <Route path="/login" element={<LoginPage callbackUrl={callbackTarget} />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        <Route
          path="/auth/github/callback"
          element={<GithubCallbackPage onAuthenticated={(user) => setAuth({ loading: false, user })} />}
        />

        <Route element={<ProtectedRoutes user={auth.user} />}>
          <Route index element={<ProjectsOverviewPage />} />
          <Route path="/projects/:projectId/runs" element={<ProjectRunsPage />} />
          <Route path="/projects/:projectId/bugs" element={<ProjectBugsPage />} />
          <Route path="/projects/:projectId/coverage" element={<ProjectCoveragePage />} />
          <Route path="/projects/:projectId/drift" element={<ProjectDriftPage />} />
          <Route path="/projects/:projectId/memory" element={<ProjectMemoryPage />} />
          <Route path="/projects/:projectId/usage" element={<ProjectUsagePage />} />
          <Route path="/projects/:projectId/settings" element={<ProjectSettingsPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
