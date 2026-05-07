"use client";
import { useState } from "react";
import { ChevronDown, RefreshCw, Database, Wifi, WifiOff } from "lucide-react";

export interface Workspace {
  id: string;
  name: string;
  adsAccountId: string;
  bqDataset: string;
  lastSync: string;
  status: "fresh" | "stale" | "error";
}

export const WORKSPACES: Workspace[] = [
  {
    id: "ws-001",
    name: "Marca Alpha",
    adsAccountId: "123-456-7890",
    bqDataset: "synapse_alpha_prod",
    lastSync: "2 min atrás",
    status: "fresh",
  },
  {
    id: "ws-002",
    name: "Marca Beta",
    adsAccountId: "987-654-3210",
    bqDataset: "synapse_beta_prod",
    lastSync: "47 min atrás",
    status: "stale",
  },
  {
    id: "ws-003",
    name: "Marca Gamma",
    adsAccountId: "456-789-0123",
    bqDataset: "synapse_gamma_prod",
    lastSync: "1h 12min atrás",
    status: "fresh",
  },
];

const STATUS_CONFIG = {
  fresh: { dot: "bg-emerald-400", text: "text-emerald-400", label: "Atualizado", icon: Wifi },
  stale: { dot: "bg-amber-400",   text: "text-amber-400",   label: "Desatualizado", icon: WifiOff },
  error: { dot: "bg-red-400",     text: "text-red-400",     label: "Erro",    icon: WifiOff },
};

interface WorkspaceSelectorProps {
  selected: Workspace;
  onSelect: (ws: Workspace) => void;
}

export function WorkspaceSelector({ selected, onSelect }: WorkspaceSelectorProps) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[selected.status];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 bg-[#0d1530] hover:bg-[#111a38] border border-[#1a2540] hover:border-indigo-500/30 rounded-xl px-3.5 py-2 transition-all duration-150"
      >
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} shadow-sm`} />
        <div className="text-left">
          <p className="text-sm font-semibold text-slate-200 leading-none">{selected.name}</p>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5 leading-none">{selected.adsAccountId}</p>
        </div>
        <ChevronDown
          size={13}
          className={`text-slate-500 transition-transform ml-1 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 w-80 bg-[#0b1120] border border-[#1a2540] rounded-2xl shadow-2xl shadow-black/60 z-50 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[#1a2540]">
              <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold">
                Workspaces
              </p>
            </div>

            {WORKSPACES.map((ws) => {
              const wsCfg = STATUS_CONFIG[ws.status];
              const isSelected = ws.id === selected.id;
              return (
                <button
                  key={ws.id}
                  onClick={() => { onSelect(ws); setOpen(false); }}
                  className={`w-full flex items-center justify-between px-4 py-3 hover:bg-[#0d1530] transition-colors text-left
                    ${isSelected ? "bg-indigo-600/10 border-l-2 border-indigo-500" : "border-l-2 border-transparent"}`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${wsCfg.dot}`} />
                    <div>
                      <p className={`text-sm font-medium ${isSelected ? "text-indigo-200" : "text-slate-300"}`}>
                        {ws.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Database size={9} className="text-slate-600" />
                        <p className="text-[10px] text-slate-600 font-mono">{ws.bqDataset}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-slate-600">
                    <RefreshCw size={9} />
                    <span>{ws.lastSync}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
