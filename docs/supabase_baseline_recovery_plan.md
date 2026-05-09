# Supabase Baseline Recovery Plan

## Contexto

Projeto: SynapseIQ / A Data / Dashboard Woke  
Supabase project ref: lasocsneburvtxqgqhie  
Tenant piloto: Woke People

Em 2026-05-09 foi iniciada a reconciliação do histórico de migrations Supabase.

A intenção original era alinhar o histórico remoto com as migrations locais `001` a `007`, sem alterar schema, sem resetar banco, sem apagar dados e sem aplicar migrations novas.

## Problema encontrado

O comando:

`npx supabase db diff --linked --schema public`

falhou ao aplicar as migrations locais em uma shadow database.

Erro principal:

`ERROR: relation "campaign_summary" does not exist`

A falha ocorre em:

`supabase/migrations/002_metadata_and_constraints.sql`

A migration `002` altera `campaign_summary` e `keyword_analysis`, mas essas tabelas não são criadas por nenhuma migration local anterior.

## Tabelas existentes no remoto que não são criadas localmente

- agent_action_logs
- ai_playbooks
- campaign_summary
- data_connectors
- keyword_analysis
- kpi_cache_daily
- profiles
- workspaces

## Conclusão

As migrations locais `001` a `007` não representam um baseline completo do schema remoto.

Elas são incrementais sobre um schema base pré existente.

Por isso, não é seguro executar:

`npx supabase migration repair`

nesta fase.

Executar repair agora poderia alinhar artificialmente a tabela `supabase_migrations.schema_migrations`, mas deixaria o repositório incapaz de reconstruir o schema do zero.

## Decisão

A reconciliação simples está bloqueada.

Não executar nesta fase:

- `npx supabase migration repair`
- `npx supabase db push`
- `npx supabase db pull`
- `npx supabase db reset`
- criação de nova migration
- alteração de migrations existentes

## Próxima fase recomendada

Criar a fase:

`v1.3.2 Supabase Baseline Recovery`

Objetivo:

Recuperar ou reconstruir uma migration de baseline local que represente o schema base anterior às migrations `001` a `007`, sem alterar o banco remoto.

## Estratégia recomendada para v1.3.2

1. Criar branch específica.
2. Gerar uma migration baseline mínima, não o dump inteiro.
3. Incluir apenas os objetos ausentes necessários para que `001` a `007` rodem do zero.
4. Não duplicar objetos já criados pelas migrations locais.
5. Validar com `npx supabase db diff --linked --schema public`.
6. Só depois reavaliar a reconciliação do histórico remoto.
