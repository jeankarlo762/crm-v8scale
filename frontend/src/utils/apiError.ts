interface ApiErrorPayload {
  message?: string
  details?: Record<string, string[]>
}

function payload(err: unknown): ApiErrorPayload | undefined {
  if (err && typeof err === 'object' && 'response' in err) {
    return (err as { response?: { data?: ApiErrorPayload } }).response?.data
  }
  return undefined
}

export function errMsg(err: unknown): string | undefined {
  return payload(err)?.message
}

// Erros de validacao (Zod) chegam com `details: { campo: ['mensagem'] }` —
// extrai a primeira mensagem de cada campo pra exibir junto ao input certo
// em vez de so um toast generico "Dados invalidos".
export function getFieldErrors(err: unknown): Record<string, string> | undefined {
  const details = payload(err)?.details
  if (!details) return undefined
  const out: Record<string, string> = {}
  for (const [field, messages] of Object.entries(details)) {
    if (messages?.[0]) out[field] = messages[0]
  }
  return Object.keys(out).length ? out : undefined
}
