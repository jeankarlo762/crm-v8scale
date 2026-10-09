export function httpError(statusCode: number, message: string, extra?: Record<string, unknown>): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode }, extra)
}
