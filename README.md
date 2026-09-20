# StudyFlow

App pessoal para organizar tarefas e estudos, pensado para uso real no dia a dia,
tanto no computador quanto no celular.

> **Status:** em desenvolvimento. O frontend está em construção; o backend ainda
> não foi implementado.

## A ideia

Em vez de uma lista de tarefas que só marca "feito/não feito", o StudyFlow separa
duas coisas:

- **Tarefa (modelo):** o que precisa ser feito, com categoria e uma frequência
  usada só como etiqueta de organização (nenhuma automação).
- **Execução:** cada vez que a tarefa foi de fato realizada, com uma descrição do
  que foi feito naquela vez.

Assim dá para ver o histórico real de estudo, e não só um checklist. Uma fase
seguinte adiciona um cronômetro vinculado a cada execução.

## Stack

| Camada | Tecnologias |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Backend | Node.js, Express |
| Banco de dados | PostgreSQL (hospedado no Supabase, usado apenas como banco) |
| Acesso a dados | SQL puro com [`pg`](https://node-postgres.com/), sem ORM |
| Deploy (planejado) | Vercel (frontend) e Render (backend) |

### Decisões de projeto

- **Sem ORM:** o objetivo é praticar SQL e Postgres de verdade.
- **Backend próprio:** a API automática e a autenticação do Supabase não são
  usadas. O frontend fala só com a API deste projeto, nunca direto com o banco.
- **Autenticação simples:** app de usuário único, com um portão de
  usuário e senha (hash) e token protegendo as rotas.

## Estrutura

```
study-flow/
├── frontend/   # app React (Vite)
└── backend/    # API Express (em desenvolvimento)
```

## Modelo de dados (planejado)

```
categories        → agrupam as tarefas
tasks             → o "modelo" da tarefa (título, categoria, frequência)
task_executions   → cada vez que uma tarefa foi feita, com a descrição
time_entries      → cronômetro de cada execução (fase 2)
```

## Como rodar

Por enquanto só o frontend existe:

```bash
cd frontend
npm install
npm run dev
```

Outros comandos, dentro de `frontend/`:

```bash
npm run build   # checagem de tipos + build de produção
npm run lint    # ESLint
```

O backend terá suas instruções aqui quando existir.
