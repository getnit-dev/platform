import { Outlet } from "react-router-dom";
import { NavigationSidebar } from "./NavigationSidebar";
import { TopBar } from "./TopBar";
import type { DashboardUser } from "../../lib/api";

export function AppShell({ user }: { user: DashboardUser }) {
  return (
    <div className="flex min-h-screen bg-background">
      <NavigationSidebar user={user} />
      <div className="flex-1 flex flex-col ml-60">
        <TopBar />
        <main className="flex-1 px-6 py-5">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
