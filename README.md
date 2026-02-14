# 🧠 Study Flow - Gerenciador de Revisões Inteligente

O **Study Flow** é uma ferramenta de apoio ao aprendizado baseada na técnica de **Repetição Espaçada**. O objetivo é ajudar estudantes a gerenciar seus ciclos de revisão, calculando automaticamente o tempo ideal para revisitar cada conteúdo.

## 🚀 Funcionalidades Planejadas

- **Cadastro de Tópicos:** Registro do assunto estudado e nível de dificuldade.
- **Cálculo de Revisão:** Lógica baseada na Curva do Esquecimento para sinalizar o status (Fresco, Revisar ou Urgente).
- **Persistência Local:** Os dados ficam salvos no navegador (LocalStorage).
- **Interface Dinâmica:** Cards que mudam de cor conforme o prazo de revisão se aproxima.

## 🛠️ Tecnologias

- **HTML5** (Estrutura)
- **CSS3** (Estilização e estados visuais)
- **JavaScript** (Lógica de negócio e manipulação do DOM)

## 📂 Organização do Projeto

O projeto segue uma arquitetura de separação de responsabilidades:
- `js/logic.js`: Funções puras e cálculos.
- `js/main.js`: Orquestração do DOM e eventos.