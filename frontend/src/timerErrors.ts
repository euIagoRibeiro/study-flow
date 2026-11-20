// As frases do servidor sobre o cronômetro e o fim do registro, no texto da tela. Módulo SEM imports:
// o teste de unidade (tests/unidade/timer-erros.mjs) o importa direto, sem navegador nem build.
export const ALREADY_FINISHED =
  'Este registro já foi finalizado ou não existe mais.'
export const RESUMED_AFTER_END =
  'Uma sessão foi retomada depois do horário que você escolheu para terminar. Pause o cronômetro e finalize de novo.'

// A frase da tela pra uma mensagem 400 conhecida do servidor; null = não é uma delas (quem chama
// decide o que mostrar). Só o texto exato: mensagem parecida não casa
export function timerErrorMessage(message: string): string | null {
  // Retomar (POST /time-entries): o registro já foi concluído (ou não existe mais)
  if (message === 'Execução não encontrada ou já finalizada') {
    return ALREADY_FINISHED
  }
  // Finalizar (PUT /executions/:id): uma sessão começou depois do fim escolhido
  if (
    message ===
    'O registro não pode terminar antes do início da sessão em andamento.'
  ) {
    return RESUMED_AFTER_END
  }
  return null
}
