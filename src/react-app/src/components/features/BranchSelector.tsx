import { useEffect, useState } from "react";
import { api, type BranchStats } from "../../lib/api";
import { cn } from "../../lib/utils";
import { GitBranch } from "lucide-react";

interface BranchSelectorProps {
  projectId: string;
  value: string | null;
  onChange: (branch: string | null) => void;
}

export function BranchSelector({ projectId, value, onChange }: BranchSelectorProps) {
  const [branches, setBranches] = useState<BranchStats[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await api.branches.list({ projectId });
        if (!active) return;
        setBranches(res.branches);
      } catch {
        // Ignore — branch selector is optional
      }
    }
    void load();
    return () => { active = false; };
  }, [projectId]);

  if (branches.length <= 1) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg border border-divider bg-content1 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-default-100",
          value && "ring-1 ring-primary/30"
        )}
      >
        <GitBranch className="h-3.5 w-3.5 text-default-500" />
        <span>{value ?? "All branches"}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-divider bg-content1 shadow-lg py-1">
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              className={cn("w-full text-left px-3 py-2 text-xs hover:bg-default-100 transition-colors", value === null && "bg-primary/10 text-primary font-medium")}
            >
              All branches
            </button>
            {branches.map(b => (
              <button
                key={b.branch}
                onClick={() => { onChange(b.branch); setOpen(false); }}
                className={cn("w-full text-left px-3 py-2 text-xs hover:bg-default-100 transition-colors flex items-center justify-between", value === b.branch && "bg-primary/10 text-primary font-medium")}
              >
                <code className="font-mono">{b.branch}</code>
                <span className="text-default-500 tabular-nums ml-2">{b.runCount} runs</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
