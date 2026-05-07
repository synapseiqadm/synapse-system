import { TrendingUp, TrendingDown, Minus } from "lucide-react";

export interface MetricCardProps {
  title: string;
  value: string;
  unit?: string;
  change: number;
  changeLabel?: string;
  source: string;
  sparkline?: number[];
  highlight?: boolean;
}

const DEFAULT_SPARK = [35, 52, 41, 67, 58, 72, 61, 84, 70, 88, 76, 95];

export function MetricCard({
  title,
  value,
  unit,
  change,
  changeLabel,
  source,
  sparkline = DEFAULT_SPARK,
  highlight = false,
}: MetricCardProps) {
  const positive = change > 0;
  const neutral  = change === 0;

  const trendColor = neutral ? "text-slate-400" : positive ? "text-emerald-400" : "text-red-400";
  const trendBg    = neutral ? "bg-slate-500/10" : positive ? "bg-emerald-500/10" : "bg-red-500/10";
  const barColor   = neutral ? "bg-slate-600/50" : positive ? "bg-emerald-500/50" : "bg-red-500/50";
  const barColorHi = neutral ? "bg-slate-400"    : positive ? "bg-emerald-400"    : "bg-red-400";

  const TrendIcon = neutral ? Minus : positive ? TrendingUp : TrendingDown;

  const max = Math.max(...sparkline);

  return (
    <div
      className={`relative flex flex-col bg-[#0d1530] border rounded-xl p-4 transition-all duration-200 group cursor-default
        ${highlight
          ? "border-indigo-500/40 shadow-lg shadow-indigo-900/20"
          : "border-[#1a2540] hover:border-indigo-500/30"
        }`}
    >
      {highlight && (
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/60 to-transparent rounded-t-xl" />
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold">
            {title}
          </p>
        </div>
        <span
          className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold ${trendColor} ${trendBg}`}
        >
          <TrendIcon size={10} />
          {neutral ? "—" : `${positive ? "+" : ""}${change}%`}
        </span>
      </div>

      {/* Value */}
      <div className="flex items-baseline gap-1.5 mb-3">
        <p className="text-[26px] font-bold text-white leading-none tracking-tight">{value}</p>
        {unit && <span className="text-sm text-slate-400 font-medium">{unit}</span>}
      </div>

      {/* Sparkline */}
      <div className="flex items-end gap-[2px] h-9 mb-3">
        {sparkline.map((v, i) => {
          const isLast = i === sparkline.length - 1;
          return (
            <div
              key={i}
              className={`flex-1 rounded-sm transition-all ${isLast ? barColorHi : barColor}`}
              style={{ height: `${(v / max) * 100}%` }}
            />
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500/70" />
          <p className="text-[10px] text-slate-600 font-mono">{source}</p>
        </div>
        {changeLabel && (
          <p className={`text-[10px] font-medium ${trendColor}`}>{changeLabel}</p>
        )}
      </div>
    </div>
  );
}
