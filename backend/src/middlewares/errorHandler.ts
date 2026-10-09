import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'

export function errorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof ZodError) {
    const fieldErrors = error.flatten().fieldErrors
    const [field, messages] = Object.entries(fieldErrors).find(([, m]) => m && m.length > 0) ?? []
    const message = field && messages?.[0] ? `${field}: ${messages[0]}` : 'Dados inválidos'
    reply.status(400).send({ error: true, message, code: 'VALIDATION_ERROR', details: fieldErrors })
    return
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      reply.status(409).send({ error: true, message: 'Já existe um registro com esses dados', code: 'CONFLICT' })
      return
    }
    if (error.code === 'P2025') {
      reply.status(404).send({ error: true, message: 'Registro não encontrado', code: 'NOT_FOUND' })
      return
    }
    // Chave estrangeira inválida (ex.: ownerId de usuário inexistente).
    if (error.code === 'P2003') {
      reply.status(400).send({ error: true, message: 'Referência inválida: o registro relacionado não existe', code: 'BAD_REQUEST' })
      return
    }
  }

  const statusCode = 'statusCode' in error ? (error.statusCode ?? 500) : 500
  const codes: Record<number, string> = {
    400: 'BAD_REQUEST', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN', 404: 'NOT_FOUND', 409: 'CONFLICT',
    413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'TOO_MANY_REQUESTS',
  }

  if (codes[statusCode]) {
    // `errors` (lista por campo, ex.: validação de formulário) é repassado ao corpo quando o erro o traz.
    const errors = (error as { errors?: unknown }).errors
    reply.status(statusCode).send({ error: true, message: error.message, code: codes[statusCode], ...(errors !== undefined && { errors }) })
    return
  }

  request.log.error({ err: error }, 'erro não tratado')
  reply.status(500).send({ error: true, message: 'Erro interno do servidor', code: 'INTERNAL_ERROR', requestId: request.id })
}
