# MEMORIAL — SynapseIQ

**Versão actual:** v2.2.2 | **Data:** 2026-05-13  
**Stack:** Next.js 16.2.5 · Python 3 · Supabase · Gemini 2.5 Flash · BigQuery

SynapseIQ é uma plataforma de marketing analytics com pipeline Google Ads + GA4 → Supabase, governance semântica, inteligência executiva (Gemini) e agentes autónomos (approve/reject via UI).

---

## Referências Rápidas

| Item | Valor |
|---|---|
| Supabase Project | `synapse-system` — ID `lasocsneburvtxqgqhie` — região `sa-east-1` |
| Vercel | [synapse-iq.vercel.app](https://vercel.com/synapse-iq) |
| GitHub | `creativedata/synapse` — branch `main` |
| Workspace piloto | Woke People — UUID `a082fe86-a65f-4c9b-9442-fe775f47e3fc` |
| Admin email | `ervin.moriyama@gmail.com` |

---

## Documentação Técnica

| Ficheiro | Conteúdo |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Árvore de módulos, fluxo de dados, multi-tenancy, CI/CD |
| [docs/database.md](docs/database.md) | Schemas de todas as tabelas, migrations 000–014, RLS, `fn_campaign_snapshot_delta` |
| [docs/backend.md](docs/backend.md) | Todos os módulos Python, assinaturas de funções, agentes, testes |
| [docs/frontend.md](docs/frontend.md) | Rotas, API routes, componentes, auth, tipos TypeScript |
| [docs/security.md](docs/security.md) | Env vars, RLS, constraints de código, checklist de validação |
| [docs/changelog.md](docs/changelog.md) | Histórico de versões v1.0 → v2.2.2 com commits |

> **Regra:** quando uma feature muda, actualizar o ficheiro temático em `docs/`. Não acrescentar ao `MEMORIAL.md`.  
> **Histórico completo pré-reestruturação:** `MEMORIAL_LEGACY.md`

---

## Estado Actual (v2.2.2)

- **Pipeline:** Google Ads + GA4 → Supabase, cron diário 09:00 UTC, workflow `sync_data.yml`
- **Agentes:** Growth Master · Creative Critic · Anomaly Scout — decisões persistidas em `agent_decisions`
- **IA:** Gemini 2.5 Flash via REST (frontend) — `/api/ai/narrative` activo em produção
- **Auth:** RLS workspace-scoped (`TO authenticated` via `profiles`) em todas as tabelas críticas
- **Migrations aplicadas:** 000–014 (nunca modificar migrations já aplicadas)
