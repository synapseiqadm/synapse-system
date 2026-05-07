"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { Zap, Loader2, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Credenciais inválidas. Verifica o teu e-mail e password.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      {/* Subtle background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-4 shadow-lg shadow-indigo-900/40">
            <Zap size={20} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">SynapseIQ</h1>
          <p className="text-zinc-500 text-sm mt-1">AI Growth Orchestrator</p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl shadow-black/40">
          <div className="mb-6">
            <h2 className="text-base font-semibold text-white">Entrar na plataforma</h2>
            <p className="text-zinc-500 text-xs mt-1">Acesso restrito a workspaces autorizados</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-zinc-400 mb-1.5">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@empresa.com"
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-zinc-400 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 outline-none transition-colors"
              />
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
                <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed rounded-xl text-sm font-semibold text-white transition-colors shadow-lg shadow-indigo-900/30 mt-2"
            >
              {loading ? (
                <><Loader2 size={15} className="animate-spin" /> A entrar...</>
              ) : (
                "Entrar"
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-zinc-700 text-xs mt-6">
          Acesso por convite apenas ·{" "}
          <a href="mailto:admin@synapseiq.io" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            Contactar suporte
          </a>
        </p>
      </div>
    </div>
  );
}
