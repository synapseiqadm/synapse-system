"use client";
import { useState } from "react";
import {
  RefreshCcw,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Link2,
  Link2Off,
  Clock,
  Database,
  ArrowUpRight,
  Loader2,
} from "lucide-react";

export type ConnectorStatus = "synced" | "pending" | "disconnected" | "error";

export interface Connector {
  id: string;
  name: string;
  description: string;
  status: ConnectorStatus;
  lastSync?: string;
  bqDataset?: string;
  recordsLastSync?: string;
  syncFrequency?: string;
  logo: React.ReactNode;
}

const STATUS_CFG: Record<ConnectorStatus, {
  label: string;
  dot: string;
  badge: string;
  border: string;
  glow: string;
  icon: typeof CheckCircle2;
  iconColor: string;
}> = {
  synced: {
    label:     "Sincronizado",
    dot:       "bg-emerald-400 animate-pulse",
    badge:     "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    border:    "border-emerald-500/20",
    glow:      "shadow-[0_0_20px_rgba(16,185,129,0.08)]",
    icon:      CheckCircle2,
    iconColor: "text-emerald-400",
  },
  pending: {
    label:     "Aguardando Dados",
    dot:       "bg-amber-400 animate-pulse",
    badge:     "bg-amber-500/10 text-amber-400 border-amber-500/20",
    border:    "border-amber-500/20",
    glow:      "shadow-[0_0_20px_rgba(245,158,11,0.08)]",
    icon:      AlertCircle,
    iconColor: "text-amber-400",
  },
  disconnected: {
    label:     "Desconectado",
    dot:       "bg-zinc-600",
    badge:     "bg-zinc-800/60 text-zinc-500 border-zinc-700/40",
    border:    "border-zinc-800",
    glow:      "",
    icon:      XCircle,
    iconColor: "text-zinc-600",
  },
  error: {
    label:     "Erro",
    dot:       "bg-red-400 animate-pulse",
    badge:     "bg-red-500/10 text-red-400 border-red-500/20",
    border:    "border-red-500/20",
    glow:      "shadow-[0_0_20px_rgba(239,68,68,0.08)]",
    icon:      AlertCircle,
    iconColor: "text-red-400",
  },
};

interface ConnectorCardProps {
  connector: Connector;
  onSync: (id: string) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  isSyncing: boolean;
}

export function ConnectorCard({
  connector,
  onSync,
  onConnect,
  onDisconnect,
  isSyncing,
}: ConnectorCardProps) {
  const cfg        = STATUS_CFG[connector.status];
  const StatusIcon = cfg.icon;
  const isActive   = connector.status === "synced" || connector.status === "pending";

  return (
    <div className={`relative flex flex-col bg-[#0d1117] border rounded-2xl p-5 transition-all duration-200 ${cfg.border} ${cfg.glow} hover:border-opacity-60`}>
      {/* Top: logo + name + status */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-zinc-900 border border-zinc-800">
            {connector.logo}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-100">{connector.name}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">{connector.description}</p>
          </div>
        </div>

        <span className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-full border flex-shrink-0 ${cfg.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {/* Metadata */}
      <div className="space-y-2 mb-4 pb-4 border-b border-zinc-800/60">
        {connector.lastSync && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Clock size={11} />
              <span>Última sync</span>
            </div>
            <span className="text-[11px] text-slate-300 font-medium">{connector.lastSync}</span>
          </div>
        )}
        {connector.bqDataset && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Database size={11} />
              <span>BigQuery dataset</span>
            </div>
            <span className="text-[10px] font-mono text-indigo-400">{connector.bqDataset}</span>
          </div>
        )}
        {connector.recordsLastSync && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <ArrowUpRight size={11} />
              <span>Registos (última sync)</span>
            </div>
            <span className="text-[11px] text-slate-300 font-medium">{connector.recordsLastSync}</span>
          </div>
        )}
        {connector.syncFrequency && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <RefreshCcw size={11} />
              <span>Frequência</span>
            </div>
            <span className="text-[11px] text-slate-300">{connector.syncFrequency}</span>
          </div>
        )}
      </div>

      {/* Status icon row */}
      <div className="flex items-center gap-1.5 mb-4">
        <StatusIcon size={13} className={cfg.iconColor} />
        <p className={`text-[11px] font-medium ${cfg.iconColor}`}>
          {connector.status === "synced"       && "Pipeline ativo · Dados fluindo para o BigQuery"}
          {connector.status === "pending"      && "Autenticação concluída · Aguardando primeiro ciclo"}
          {connector.status === "disconnected" && "Integração não configurada"}
          {connector.status === "error"        && "Falha na última execução · Verifique as permissões"}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-auto">
        {connector.status === "disconnected" && (
          <button
            onClick={() => onConnect(connector.id)}
            className="flex-1 flex items-center justify-center gap-2 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white transition-colors"
          >
            <Link2 size={13} />
            Conectar
          </button>
        )}

        {connector.status === "pending" && (
          <>
            <button
              onClick={() => onSync(connector.id)}
              disabled={isSyncing}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 rounded-xl text-xs font-semibold text-amber-400 transition-colors disabled:opacity-50"
            >
              {isSyncing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
              Reconectar
            </button>
            <button
              onClick={() => onDisconnect(connector.id)}
              className="px-3 py-2 bg-zinc-800/60 hover:bg-zinc-800 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 transition-colors border border-zinc-800"
            >
              <Link2Off size={13} />
            </button>
          </>
        )}

        {(connector.status === "synced" || connector.status === "error") && (
          <>
            <button
              onClick={() => onSync(connector.id)}
              disabled={isSyncing}
              className="flex-1 flex items-center justify-center gap-2 py-2 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-xl text-xs font-semibold text-slate-300 transition-colors disabled:opacity-50"
            >
              {isSyncing
                ? <><Loader2 size={13} className="animate-spin" /> Sincronizando...</>
                : <><RefreshCcw size={13} /> Forçar Sync</>
              }
            </button>
            <button
              onClick={() => onDisconnect(connector.id)}
              className="px-3 py-2 bg-zinc-800/60 hover:bg-red-500/10 border border-zinc-800 hover:border-red-500/20 rounded-xl text-xs text-zinc-500 hover:text-red-400 transition-colors"
            >
              <Link2Off size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
