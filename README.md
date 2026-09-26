# StudyFlow

App pessoal para organizar tarefas e estudos, pensado para uso real no dia a dia,
tanto no computador quanto no celular.

> **Status:** em desenvolvimento, rodando localmente. Tarefas, execuções e
> cronômetro já são salvos no banco, pela API própria: nada se perde ao
> recarregar a página.

## A ideia

Em vez de uma lista de tarefas que só marca "feito/não feito", o StudyFlow separa
duas coisas:

- **Tarefa (modelo):** o que precisa ser feito, com uma frequência usada só como
  etiqueta de organização (nenhuma automação). Pode ser arquivada, nunca
  apagada, para não perder o histórico.
- **Execução:** cada vez que a tarefa foi de fato realizada, com uma descrição do
  que foi feito naquela vez e, opcionalmente, o tempo gasto (cronômetro com
  pausas).

Assim dá para ver o histórico real de estudo, e não só um checklist. Cada
execução guarda o título e a frequência que a tarefa tinha naquele momento:
editar a tarefa depois não reescreve o histórico.

## Stack

| Camada             | Tecnologias                                                               |
| ------------------ | ------------------------------------------------------------------------- |
| Frontend           | React 19, TypeScript, Vite, Tailwind CSS v4, React Router                 |
| Backend            | Node.js, Express 5                                                        |
| Banco de dados     | PostgreSQL 16 (Docker em desenvolvimento; Supabase, só como banco, no ar) |
| Acesso a dados     | SQL puro com [`pg`](https://node-postgres.com/), sem ORM                  |
| Deploy (planejado) | Vercel (frontend) e Render (backend)                                      |

### Decisões de projeto

- **Sem ORM:** o objetivo é praticar SQL e Postgres de verdade.
- **Backend próprio:** a API automática e a autenticação do Supabase não são
  usadas. O frontend fala só com a API deste projeto, nunca direto com o banco.
- **Autenticação simples (planejada):** app de usuário único, com um portão de
  usuário e senha (hash) e token protegendo as rotas.

## Estrutura

```
study-flow/
├── docker-compose.yml   # Postgres para desenvolvimento
├── frontend/            # app React (Vite)
└── backend/             # API Express
    ├── migrations/      # arquivos .sql numerados, aplicados em ordem
    └── src/
```

## Modelo de dados

Criado aos poucos, uma migration por parte do app ligada ao backend.

```
tasks             → a tarefa-modelo (título, frequência, ativa/arquivada)   ✅ aplicada
task_executions   → cada vez que a tarefa foi feita, com a descrição       ✅ aplicada
time_entries      → sessões de cronômetro de cada execução                 ✅ aplicada
tags, task_tags   → tags (uma tarefa pode ter várias)                       ⏳ planejada
```

Algumas regras são garantidas pelo próprio banco, não só pela tela: só uma
execução em andamento por tarefa, só um cronômetro rodando por vez, e tarefa
com histórico não pode ser apagada (só arquivada).

## Como rodar

Pré-requisitos: [Node.js](https://nodejs.org/) 20.6 ou mais recente e
[Docker Desktop](https://www.docker.com/products/docker-desktop/) aberto.

### 1. Variáveis de ambiente

Cada `.env.example` vira um `.env` na mesma pasta:

```bash
cp .env.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

No PowerShell, troque `cp` por `Copy-Item`.

Escolha uma senha para o banco e use **a mesma** nos dois lugares:
`POSTGRES_PASSWORD` no `.env` da raiz e no lugar de `CHANGE_ME` em
`DATABASE_URL`, no `backend/.env`.

### 2. Banco de dados

Na raiz do projeto:

```bash
docker compose up -d
```

Depois, aplique todas as migrations, em ordem. No Git Bash, Linux ou macOS:

```bash
for f in backend/migrations/*.sql; do
  docker compose exec -T postgres psql -U studyflow -d studyflow < "$f"
done
```

No PowerShell, que não aceita `<`:

```powershell
Get-ChildItem backend\migrations\*.sql | Sort-Object Name | ForEach-Object {
  cmd /c "docker compose exec -T postgres psql -U studyflow -d studyflow < `"$($_.FullName)`""
}
```

Num banco que já existe, aplique só as migrations novas: reaplicar uma antiga
dá erro de "already exists".

### 3. Backend

```bash
cd backend
npm install
npm run dev   # http://localhost:3333
```

### 4. Frontend

Em outro terminal:

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

### Outros comandos

Dentro de `frontend/`:

```bash
npm run build          # checagem de tipos + build de produção
npm run lint           # ESLint
npm run format:check   # Prettier
```

Na raiz, para o banco:

```bash
docker compose stop      # para o Postgres (os dados continuam salvos)
docker compose down -v   # ⚠️ apaga o banco inteiro
```
