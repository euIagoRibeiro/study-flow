-- 0016 (nota por sessão, NB1a): texto livre de uma sessão (rodando ou concluída), nunca de uma estimada.
-- Só acrescenta: coluna nula e sem default (as sessões que existem ficam sem nota), nenhuma tabela nova
-- (RLS e GRANT não mudam). O limite e o "vazio = null" também são conferidos pela API; aqui é a rede de fundo.
-- btrim com a lista explícita: sem ela, o btrim só tira espaço, e uma nota de só tabulação ou quebra de linha passaria
ALTER TABLE time_entries
  ADD COLUMN note text,
  ADD CONSTRAINT time_entries_note_not_blank
    CHECK (note IS NULL OR btrim(note, E' \t\r\n') <> ''),
  ADD CONSTRAINT time_entries_note_length
    CHECK (note IS NULL OR char_length(note) <= 2000),
  ADD CONSTRAINT time_entries_note_not_estimated
    CHECK (NOT estimated OR note IS NULL);
