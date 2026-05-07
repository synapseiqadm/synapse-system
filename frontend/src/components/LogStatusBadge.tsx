import { CheckCircle2, XCircle, Clock, RotateCcw, Loader2 } from "lucide-react";

export type LogStatus = "success" | "failure" | "pending" | "reverted" | "running";

const CFG: Record<LogStatus, {
  icon: typeof CheckCircle2;
  label: string;
  color: string;
  bg: string;
  border: string;
  dot: string;
}> = {
  success:  {
    icon:   CheckCircle2,
    label:  "Sucesso",
    color:  "text-emerald-400",
    bg:     "bg-emerald-500/10",
    border: "border-emerald-500/20",
    dot:    "bg-emerald-400",
  },
  failure:  {
    icon:   XCircle,
    label:  "Falha",
    color:  "text-red-400",
    bg:     "bg-red-500/10",
    border: "border-red-500/20",
    dot:    "bg-red-400",
  },
  pending:  {
    icon:   Clock,
    label:  "Pendente",
    color:  "text-amber-400",
    bg:     "bg-amber-500/10",
    border: "border-amber-500/20",
    dot:    "bg-amber-400 animate-pulse",
  },
  reverted: {
    icon:   RotateCcw,
    label:  "Revertido",
    color:  "text-slate-400",
    bg:     "bg-slate-700/30",
    border: "border-slate-600/30",
    dot:    "bg-slate-500",
  },
  running: {
    icon:   Loader2,
    label:  "Executando",
    color:  "text-indigo-400",
    bg:     "bg-indigo-500/10",
    border: "border-indigo-500/20",
    dot:    "bg-indigo-400 animate-pulse",
  },
};

interface LogStatusBadgeProps {
  status: LogStatus;
  variant?: "badge" | "dot" | "full";
}

export function LogStatusBadge({ status, variant = "badge" }: LogStatusBadgeProps) {
  const c    = CFG[status];
  const Icon = c.icon;

  if (variant === "dot") {
    return <span className={`inline-block w-2 h-2 rounded-full ${c.dot}`} />;
  }

  if (variant === "full") {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${c.bg} ${c.border}`}>
        <Icon size={13} className={`${c.color} ${status === "running" ? "animate-spin" : ""}`} />
        <span className={`text-xs font-semibold ${c.color}`}>{c.label}</span>
      </div>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${c.bg} ${c.border} ${c.color}`}>
      <Icon size={10} className={status === "running" ? "animate-spin" : ""} />
      {c.label}
    </span>
  );
}
