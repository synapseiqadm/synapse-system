# Segurança — SynapseIQ

---

## Variáveis de Ambiente

### Frontend (Vercel)

| Variável | Scope | Descrição |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production + Preview | URL pública do Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production + Preview | JWT anon key (formato legado `eyJ...`) |
| `SUPABASE_URL` | Production + Preview | URL do Supabase (server-side) |
| `SUPABASE_SERVICE_KEY` | Production + Preview | Service key — apenas para operações server-side (routes API) |
| `WOKE_WORKSPACE_ID` | Production + Preview | UUID do workspace piloto |
| `GEMINI_API_KEY` | Production + Preview | Chave da API Gemini — server-only, nunca exposta ao cliente |
| `RESEND_API_KEY` | Production + Preview | Chave Resend para envio de alertas — server-only |
| `CRON_SECRET` | Production + Preview | Token de autenticação do Vercel Cron — server-only |
| `ALERT_EMAIL_TO` | Production + Preview | E-mail destinatário dos alertas Guardian (default: `ervin.moriyama@gmail.com`) |
| `ALERT_EMAIL_FROM` | Production + Preview | E-mail remetente verificado no Resend (default: `alerts@synapseiq.com`) |

**Regras invioláveis:**
- `GEMINI_API_KEY` nunca usa prefixo `NEXT_PUBLIC_` — ficaria exposta no bundle do browser
- `SUPABASE_SERVICE_KEY` em `frontend/src` → violação imediata (`grep SUPABASE_SERVICE_KEY frontend/src` deve retornar vazio)
- Nenhum valor de secret vai para o git

### Backend (GitHub Actions)

| Secret/Variável | Descrição |
|---|---|
| `GOOGLE_CREDENTIALS_JSON` | JSON da service account GCP (base64 encoded) |
| `SUPABASE_URL` | URL do projecto |
| `SUPABASE_SERVICE_KEY` | Chave service — exclusiva do backend Python |
| `APP_ENV=production` | Bloqueia mock data automaticamente |
| `ALLOW_MOCK_DATA=false` | Segurança adicional contra mock em produção |

### Local (`.env` / `.env.local`)

- `backend/.env` — nunca no git (`.gitignore` com dupla cobertura)
- `frontend/.env.local` — nunca no git

---

## Row Level Security (RLS)

### Princípio actual (pós migration 013)

Todas as tabelas de dados usam `TO authenticated` com workspace-scoping via `profiles`:
```sql
USING (
  workspace_id = (
    SELECT workspace_id FROM profiles WHERE id = auth.uid()
  )
)
```

### Excepções (pattern MVP)

| Tabela | Motivo da excepção |
|---|---|
| `sync_runs` | Policy pública scoped ao UUID do workspace Woke — substituir quando multi-tenant auth estiver pronto |
| `operational_events` | Idem |

### Agent Decisions

`agent_decisions` tem RLS workspace-scoped (`TO authenticated`) mais trigger anti-regressão:
```sql
-- Trigger: agent_decisions_preserve_status
-- Impede que UPDATE reverta 'approved'/'rejected' para 'pending'
-- Necessário desabilitar temporariamente para resets manuais de debug
```

### Writes do Backend

O pipeline Python usa `SUPABASE_SERVICE_KEY` que bypassa RLS. Não é necessária policy de INSERT/UPDATE para o pipeline.

---

## Constraints de Segurança de Código

### SQL Injection
- `_PARAM_ALLOWLIST_RE = re.compile(r"^[a-zA-Z0-9_]+$")` aplicado antes de interpolar nomes de parâmetros em queries BigQuery (check S)
- `parseApiFilters` sanitiza e valida todos os filtros de query string no frontend
- Queries Supabase sempre com `.eq("workspace_id", workspaceId)` — nenhuma query opera sem filtro de tenant

### XSS / Data Exposure
- `GEMINI_API_KEY` server-only — nunca em variáveis `NEXT_PUBLIC_*`
- Anon key é pública por design (Supabase) — RLS protege os dados
- `is_simulated` flag previne que output de teste apareça como diagnóstico real

### Governance Constraints (SYSTEM_PROMPT Gemini)
Constraints invioláveis no system prompt do Gemini (backend e frontend mantidos em sync):
- `PROIBIDO — Budget:` nunca recomendar aumento de gasto além do observado
- `PROIBIDO — Execution:` output é advisory only; nenhuma campanha pode ser alterada directamente
- `PROIBIDO — PII:` só processar KPIs agregados; ignorar dados pessoais se presentes no input
- `ISOLAMENTO — Stateless:` cada chamada é completamente stateless

---

## Decisões Técnicas de Segurança

| Decisão | Motivo |
|---|---|
| `can_use_mock_data()` bloqueia em `production` | Garantia de que dados fictícios nunca chegam ao Supabase de produção |
| `sys.exit(1)` em env vars ausentes | Fail-fast: melhor abortar do que continuar com estado indefinido |
| Drafts de migration em `docs/sql/` | Evita aplicação acidental por CI/CD |
| Migrations aplicadas nunca modificadas | Risco de checksum drift no Supabase CLI |
| `is_mock` em todos os registos | Permite filtrar dados de teste sem apagar nada |
| Service key exclusiva ao backend | Sem SUPABASE_SERVICE_KEY no `frontend/src` — verificar com `grep` |
| GCP credentials via base64 + `if: always()` | Evita corrupção de JSON; remove ficheiro mesmo em caso de falha |
| `thinkingBudget: 0` no Gemini | Desactiva thinking mode — estabiliza latência e evita competição com max_output_tokens |

---

## Checklist de Validação de Segurança

Executar antes de qualquer merge para `main`:

```bash
# Nenhum resultado esperado
grep -r "SUPABASE_SERVICE_KEY" frontend/src
grep -r "sb_secret" frontend/src
grep -r "GEMINI_API_KEY" frontend/src/app --include="*.tsx" --include="*.ts"

# Verificar .gitignore
cat .gitignore | grep -E "\.env|credentials"
```
