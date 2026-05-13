"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  Plug2,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Zap,
  Settings,
  Check,
} from "lucide-react";

const NAV = [
  { id: "dashboard",  icon: LayoutDashboard, label: "Dashboard",         href: "/dashboard" },
  { id: "agents",     icon: Bot,             label: "Agentes de IA",     href: "/agents" },
  { id: "connectors", icon: Plug2,           label: "Conectores Google", href: "/connectors" },
  { id: "logs",       icon: ScrollText,      label: "Status do Sync",    href: "/logs" },
];

interface Workspace {
  id:   string;
  name: string;
  slug: string;
}

interface SidebarProps {
  active: string;
  onNavigate: (id: string) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed]           = useState(false);
  const [workspaces, setWorkspaces]         = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>("");
  const [dropdownOpen, setDropdownOpen]     = useState(false);
  const [switching, setSwitching]           = useState(false);
  const router = useRouter();

  // Fetch workspace list — only returns data for superadmin
  const loadWorkspaces = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/workspaces");
      if (!res.ok) return; // non-superadmin gets 403 → silently ignore
      const json = await res.json() as { ok: boolean; workspaces?: Workspace[] };
      if (json.ok && json.workspaces) {
        setWorkspaces(json.workspaces);
        // Read active workspace from cookie (set by /api/workspaces/switch)
        const match = document.cookie.match(/synapseiq_workspace=([^;]+)/);
        setActiveWorkspaceId(match ? match[1] : (json.workspaces[0]?.id ?? ""));
      }
    } catch {
      // network error — no dropdown
    }
  }, []);

  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);

  const handleSwitch = async (ws: Workspace) => {
    if (ws.id === activeWorkspaceId || switching) return;
    setSwitching(true);
    setDropdownOpen(false);
    try {
      await fetch("/api/workspaces/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: ws.id }),
      });
      setActiveWorkspaceId(ws.id);
      router.refresh();
    } finally {
      setSwitching(false);
    }
  };

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
  const isSuperadmin    = workspaces.length > 0;

  return (
    <aside
      className={`relative flex flex-col bg-[#07090f] border-r border-[#1a2540] transition-all duration-300 ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Logo */}
      <div
        className={`flex items-center gap-2.5 h-14 px-4 border-b border-[#1a2540] ${
          collapsed ? "justify-center px-0" : ""
        }`}
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-violet-900/40">
          <Zap size={15} className="text-white" />
        </div>
        {!collapsed && (
          <div>
            <p className="text-white font-bold text-sm tracking-wide leading-none">SynapseIQ</p>
            <p className="text-[10px] text-slate-500 leading-none mt-0.5">Growth Orchestrator</p>
          </div>
        )}
      </div>

      {/* Workspace Switcher — superadmin only */}
      {isSuperadmin && !collapsed && (
        <div className="relative px-2 pt-2">
          <button
            onClick={() => setDropdownOpen(o => !o)}
            disabled={switching}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0d1530] border border-[#2a3d6a] text-sm text-slate-300 hover:border-indigo-500/50 transition-colors"
          >
            <span className="truncate font-medium">
              {switching ? "A trocar…" : (activeWorkspace?.name ?? "Workspace")}
            </span>
            <ChevronDown size={13} className={`flex-shrink-0 text-slate-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
          </button>

          {dropdownOpen && (
            <div className="absolute left-2 right-2 top-full mt-1 z-50 rounded-lg border border-[#2a3d6a] bg-[#0d1530] shadow-xl overflow-hidden">
              {workspaces.map(ws => (
                <button
                  key={ws.id}
                  onClick={() => void handleSwitch(ws)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-300 hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors text-left"
                >
                  <span className="truncate">{ws.name}</span>
                  {ws.id === activeWorkspaceId && <Check size={13} className="flex-shrink-0 text-indigo-400" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 mt-1">
        {NAV.map(({ id, icon: Icon, label, href }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => { onNavigate(id); router.push(href); }}
              title={collapsed ? label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150
                ${collapsed ? "justify-center" : ""}
                ${
                  isActive
                    ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/25 shadow-sm"
                    : "text-slate-400 hover:bg-[#0d1530] hover:text-slate-200 border border-transparent"
                }`}
            >
              <Icon size={16} className="flex-shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1 text-left">{label}</span>
                </>
              )}
            </button>
          );
        })}
      </nav>

      {/* Settings */}
      <div className={`p-2 border-t border-[#1a2540] ${collapsed ? "" : "space-y-1"}`}>
        <button
          onClick={() => onNavigate("settings")}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:bg-[#0d1530] transition-all ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <Settings size={15} />
          {!collapsed && <span>Configurações</span>}
        </button>

        {!collapsed && (
          <div className="flex items-center gap-2.5 px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center text-xs text-white font-bold flex-shrink-0">
              {isSuperadmin ? "S" : "A"}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-300 font-medium truncate">
                {isSuperadmin ? "Super Admin" : "Admin"}
              </p>
              <p className="text-[10px] text-slate-600 truncate">synapseiq.io</p>
            </div>
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-[72px] w-6 h-6 bg-[#1a2540] border border-[#2a3d6a] rounded-full flex items-center justify-center text-slate-400 hover:text-white transition-colors z-10"
      >
        {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
      </button>
    </aside>
  );
}
