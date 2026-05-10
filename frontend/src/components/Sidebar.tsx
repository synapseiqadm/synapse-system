"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Bot,
  Plug2,
  ScrollText,
  ChevronLeft,
  ChevronRight,
  Zap,
  Settings,
} from "lucide-react";

const NAV = [
  { id: "dashboard",  icon: LayoutDashboard, label: "Dashboard",         href: "/dashboard" },
  { id: "agents",     icon: Bot,             label: "Agentes de IA",     href: "/agents", badge: "Preview" },
  { id: "connectors", icon: Plug2,           label: "Conectores Google", href: "/connectors" },
  { id: "logs",       icon: ScrollText,      label: "Status do Sync",    href: "/logs" },
];

interface SidebarProps {
  active: string;
  onNavigate: (id: string) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();

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

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 mt-1">
        {NAV.map(({ id, icon: Icon, label, badge, href }) => {
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
                  {badge && (
                    <span className="text-[10px] bg-violet-500/25 text-violet-300 px-1.5 py-0.5 rounded-full font-semibold">
                      {badge}
                    </span>
                  )}
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
              A
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-300 font-medium truncate">Admin</p>
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
