# Baterias de teste

Rede de segurança do StudyFlow: casos de banco, API, telas e layout. Cada
bateria cria os próprios dados e apaga o que criou no `finally` (dados do
seed que ela mexe voltam ao que eram). Nada aqui faz reseed sozinho.

## Antes de rodar

1. `npm install` nesta pasta (uma vez). O navegador é o **Chrome já
   instalado** (`puppeteer-core`); outro caminho: `CHROME_PATH`.
2. Postgres no Docker de pé (`docker compose up -d`, na raiz).
3. Backend (`cd backend && npm run dev`, porta 3333) e frontend
   (`cd frontend && npm run dev`, porta 5173).
4. **Seed aplicado hoje.** O seed ancora "hoje" no dia em que roda: de um dia
   pro outro, os registros "de hoje" viram "ontem" e baterias falham sem bug.
   Refazer (na raiz; só mexe nos ids `5eed…`, nunca nos seus dados):

   ```
   docker exec -i study-flow-postgres-1 psql -U studyflow -d studyflow -v ON_ERROR_STOP=1 < backend/seeds/dev_unseed.sql
   docker exec -i study-flow-postgres-1 psql -U studyflow -d studyflow -v ON_ERROR_STOP=1 < backend/seeds/dev_seed.sql
   ```

O `run.mjs` confere tudo isso antes de começar e **para** dizendo o que
falta.

## Rodar

```
npm run tudo      # banco → api → telas → layout (~15 min)
npm run banco     # casos de constraint, cada arquivo numa transação desfeita
npm run api
npm run telas
npm run layout
npm run telas -- a3e1   # só as baterias cujo nome contém "a3e1"
```

Uma bateria só passa com **saída 0 e "N de N" com N > 0**: a que não achou o
que medir, ou que parou sem resumo, conta como falha.

| Pasta | O quê |
| --- | --- |
| `banco/` | Casos SQL das migrations (fase, duração estimada, medidas, treino): cada recusa pela constraint certa. Rodam pelo `psql` do container (`PG_CONTAINER`). |
| `api/` | Rotas do backend: validação, recusas traduzidas, regras da API (medida mais próxima, marcadora do treino…). |
| `telas/` | Fluxos no navegador (Puppeteer), mirando pelo rótulo e pelo conteúdo, nunca pela posição. `a3e1` roda também com o navegador em inglês. |
| `layout/` | Sem rolagem lateral, nada fora da tela e folga do anel de foco, de 320 a 1280, na janela real (barra de rolagem visível). Prints em `out/`. |
| `ferramentas/` | Procedimentos manuais, fora do `npm run tudo` (abaixo). |

Endereços: `APP_URL` e `API_URL` (padrão `localhost:5173` e `:3333`), em
`config.mjs`. Ex.: bateria da API contra um backend de teste na 3334 apontado
pra um banco restaurado: `API_URL=http://localhost:3334 npm run api`.

## Ferramentas (manuais)

**Comparar telas antes × depois de uma mudança** (ex.: componente
compartilhado):

```
rm -f out/clock.txt                      # relógio congelado novo
node ferramentas/shots.mjs depois        # com a mudança
git stash -u -- frontend/src             # (na raiz) tira a mudança
# esperar ~12s o Vite recarregar
node ferramentas/shots.mjs antes
git stash pop                            # (na raiz) e conferir o format:check
node ferramentas/compare.mjs antes depois
node ferramentas/where.mjs out/diff-historico-375.png   # faixas (y) que mudaram
node ferramentas/crop.mjs out/antes/historico-375.png out/faixa.png 3880 140
```

Os prints são de página inteira, que **esconde a barra de rolagem**: layout
estreito se confere com as baterias de `layout/` (janela real).

**Regressão da API em volta de uma migration**:

```
node --env-file=../backend/.env ferramentas/api-snapshot.mjs antes
# aplicar a migration / mudar a API
node --env-file=../backend/.env ferramentas/api-snapshot.mjs depois --ignorar=campoNovo
```

Rodar o "depois" **logo depois** da mudança: bateria que restaura dado pelo
fluxo real devolve id novo e a comparação acusaria diferença sem regressão.

## Bateria nova

Nasce aqui, na pasta do tipo dela, com `config.mjs` (nunca caminho absoluto),
**limpando o que cria no `finally`** (e conferindo a limpeza), terminando com
`N de M` e `process.exitCode`, e com uma prova de que falha sem o código
(controle negativo). Entra na lista do `run.mjs`.
