/**
 * Trilha de auditoria mínima: eventos sensíveis (login, falhas, ações
 * administrativas) vão para stdout em JSON, uma linha por evento, que o
 * Railway (ou qualquer coletor de logs) indexa. Nunca inclui senha nem token.
 */
export function audit(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ audit: event, at: new Date().toISOString(), ...data }))
}
