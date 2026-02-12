import { Link, NavLink, useNavigate } from "react-router-dom";
import { api, type DashboardUser } from "../lib/api";

function NavItem(props: { to: string; label: string }) {
  return (
    <NavLink
      to={props.to}
      end={props.to === "/"}
      className={({ isActive }) =>
        [
          "block rounded-lg px-3 py-2 text-sm font-medium transition",
          isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        ].join(" ")
      }
    >
      {props.label}
    </NavLink>
  );
}

export function AppLayout(props: { user: DashboardUser; children: React.ReactNode }) {
  const navigate = useNavigate();

  async function onSignOut() {
    await api.auth.logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen px-4 py-5 md:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-4 md:grid-cols-[16rem,1fr]">
        <aside className="rounded-2xl border border-border bg-card p-4 md:sticky md:top-4 md:h-[calc(100vh-2rem)] md:overflow-auto">
          <Link to="/" className="flex items-center gap-2">
            <img src="/favicon.svg" alt="nit" className="w-10 h-10" />
            <div>
              <p className="mono text-lg font-bold text-brand">nit</p>
              <p className="text-xs text-muted-foreground">Platform</p>
            </div>
          </Link>

          <nav className="mt-6 space-y-1">
            <NavItem to="/" label="Projects" />
          </nav>

          <div className="mt-8 rounded-xl border border-border bg-muted/50 p-3">
            <p className="text-sm font-semibold text-foreground">{props.user.name || "Account"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{props.user.email}</p>
            <button
              onClick={onSignOut}
              className="mt-3 w-full rounded-lg bg-secondary px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.1em] text-secondary-foreground hover:bg-secondary/80"
            >
              Sign out
            </button>
          </div>
        </aside>

        <main className="space-y-4">{props.children}</main>
      </div>
    </div>
  );
}
