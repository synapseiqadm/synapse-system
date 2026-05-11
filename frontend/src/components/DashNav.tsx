"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid, Activity, Megaphone, ChevronRight,
  ShieldCheck, Lightbulb, Database, Radio, Settings, Building2,
} from "lucide-react";
import { DEFAULT_WORKSPACE } from "@/lib/workspace";

interface NavLinkProps {
  href: string;
  label: string;
  icon: React.ElementType;
  sub?: boolean;
  active?: boolean;
}

function NavLink({ href, label, icon: Icon, sub = false, active = false }: NavLinkProps) {
  return (
    <Link
      href={href}
      className={`w-full flex items-center gap-2.5 rounded-lg text-sm transition-colors
        ${sub ? "px-2.5 py-1.5" : "px-3 py-2"}
        ${active
          ? "bg-indigo-600/15 text-indigo-300 font-medium"
          : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
        }`}
    >
      <Icon size={sub ? 13 : 15} />
      {label}
    </Link>
  );
}

export function DashNav() {
  const pathname = usePathname();

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col bg-[#09090b] border-r border-zinc-800/60">
      {/* Logo */}
      <div className="px-5 h-14 flex items-center border-b border-zinc-800/60">
        <span className="text-sm font-bold text-white tracking-tight">SynapseIQ</span>
      </div>

      {/* Active tenant */}
      <div className="px-5 py-2.5 border-b border-zinc-800/60 bg-zinc-900/40">
        <p className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1">Cliente</p>
        <div className="flex items-center gap-1.5">
          <Building2 size={11} className="text-indigo-400 flex-shrink-0" />
          <p className="text-xs font-semibold text-zinc-300 truncate">{DEFAULT_WORKSPACE.name}</p>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        <NavLink href="/dashboard" label="Geral"               icon={LayoutGrid} active={pathname === "/dashboard"} />
        <NavLink href="/dashboard" label="Growth Intelligence" icon={Activity}   active={false} />

        {/* Campanhas — collapsed when outside /dashboard */}
        <Link
          href="/dashboard"
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
        >
          <span className="flex items-center gap-2.5">
            <Megaphone size={15} />
            Campanhas
          </span>
          <ChevronRight size={13} className="text-zinc-600" />
        </Link>

        {/* Divider */}
        <div className="h-px bg-zinc-800/60 my-1.5 mx-1" />

        <NavLink href="/dashboard" label="Qualidade"      icon={ShieldCheck} active={false} />
        <NavLink href="/dashboard" label="Insights"       icon={Lightbulb}   active={false} />
        <NavLink href="/logs"      label="Status do Sync" icon={Database}    active={pathname === "/logs"} />
        <NavLink href="/dashboard" label="Canais"         icon={Radio}       active={false} />
        <NavLink href="/dashboard" label="Configurações"  icon={Settings}    active={false} />
      </nav>

      {/* Workspace badge */}
      <div className="p-4 border-t border-zinc-800/60">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-xs font-bold text-white">
            {DEFAULT_WORKSPACE.slug[0].toUpperCase()}
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-200">{DEFAULT_WORKSPACE.name}</p>
            <p className="text-[10px] text-zinc-600">workspace</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
