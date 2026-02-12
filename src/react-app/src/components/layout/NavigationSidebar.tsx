import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Bug,
  TrendingUp,
  Database,
  Zap,
  LogOut,
  Settings as SettingsIcon,
  BarChart3,
  Moon,
  Sun,
  Shield,
} from "lucide-react";
import type { DashboardUser } from "../../lib/api";
import { useNavigation } from "../../lib/navigation-context";
import { useTheme } from "../../lib/theme-context";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api";

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
}

function NavItem({ to, icon, label, end }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
          isActive
            ? "bg-white/15 text-white shadow-sm"
            : "text-sidebar-foreground hover:bg-white/8 hover:text-white/90"
        )
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
      {children}
    </p>
  );
}

export function NavigationSidebar({ user }: { user: DashboardUser }) {
  const { currentProjectId } = useNavigation();
  const { resolvedTheme, setTheme } = useTheme();
  const navigate = useNavigate();

  async function handleSignOut() {
    await api.auth.logout();
    navigate("/login", { replace: true });
  }

  return (
    <aside className="w-60 h-screen border-r border-sidebar-border bg-sidebar flex flex-col fixed left-0 top-0">
      {/* Logo */}
      <div className="px-5 py-5 flex-shrink-0">
        <NavLink to="/" className="flex items-center gap-2.5 group">
          <img
            src="/favicon.svg"
            alt="nit"
            className="w-8 h-8 transition-transform group-hover:scale-105"
          />
          <span className="text-base font-semibold text-white/90 tracking-tight">
            nit platform
          </span>
        </NavLink>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-5 overflow-y-auto min-h-0 pt-2">
        <div className="space-y-0.5">
          <NavItem to="/" icon={<LayoutDashboard className="h-4 w-4" />} label="Dashboard" end />
        </div>

        {currentProjectId && (
          <div className="space-y-0.5">
            <SectionLabel>Project</SectionLabel>
            <NavItem
              to={`/projects/${currentProjectId}/runs`}
              icon={<TrendingUp className="h-4 w-4" />}
              label="Runs"
            />
            <NavItem
              to={`/projects/${currentProjectId}/bugs`}
              icon={<Bug className="h-4 w-4" />}
              label="Bugs"
            />
            <NavItem
              to={`/projects/${currentProjectId}/coverage`}
              icon={<Shield className="h-4 w-4" />}
              label="Coverage"
            />
            <NavItem
              to={`/projects/${currentProjectId}/drift`}
              icon={<Zap className="h-4 w-4" />}
              label="Drift"
            />
            <NavItem
              to={`/projects/${currentProjectId}/memory`}
              icon={<Database className="h-4 w-4" />}
              label="Memory"
            />
            <NavItem
              to={`/projects/${currentProjectId}/usage`}
              icon={<BarChart3 className="h-4 w-4" />}
              label="LLM Usage"
            />
            <NavItem
              to={`/projects/${currentProjectId}/settings`}
              icon={<SettingsIcon className="h-4 w-4" />}
              label="Settings"
            />
          </div>
        )}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-sidebar-border flex-shrink-0">
        <div className="flex items-center gap-2 px-2 mb-2">
          <div className="h-7 w-7 rounded-full bg-sidebar-accent/20 text-sidebar-accent flex items-center justify-center text-xs font-semibold flex-shrink-0">
            {(user.name || user.email || "U").charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-white/90 truncate">{user.name || "Account"}</p>
            <p className="text-[11px] text-sidebar-foreground truncate">{user.email}</p>
          </div>
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-sidebar-foreground hover:bg-white/10 hover:text-white transition-colors flex-shrink-0"
            title="Toggle theme"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] text-sidebar-foreground hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
