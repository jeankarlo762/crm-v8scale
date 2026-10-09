// Roda antes de cada arquivo de teste. Configura o ambiente ANTES de qualquer
// import de src/ (env.ts valida process.env ao ser carregado).
//
// Os testes de integração precisam de um Postgres: defina TEST_DATABASE_URL
// (ex.: postgresql://postgres:senha@localhost:5432/crm_mk_test). Sem ela, os
// testes que tocam o banco são pulados.
import { execSync } from 'node:child_process'

process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters-ok'
process.env.JWT_REFRESH_SECRET = 'test-refresh-with-at-least-32-characters-ok'
process.env.JWT_EXPIRES_IN = '15m'
process.env.JWT_REFRESH_EXPIRES_IN = '7d'
process.env.CORS_ORIGINS = 'http://localhost:5173'
process.env.SEED_ADMIN_EMAIL = ''
process.env.SEED_ADMIN_PASSWORD = ''
// Prospecção: ciclo de reset é obrigatório (api-quota); nos testes o padrão é FIXED.
process.env.GOOGLE_PLACES_QUOTA_RESET ||= 'FIXED'
process.env.TAVILY_QUOTA_RESET ||= 'FIXED'
process.env.META_QUOTA_RESET ||= 'FIXED'

export const HAS_DB = !!process.env.TEST_DATABASE_URL

if (HAS_DB) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
  // Aplica as migrations no banco de teste (idempotente).
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: process.env })
} else {
  process.env.DATABASE_URL = 'postgresql://unused:unused@localhost:5432/unused'
  console.warn('[test] TEST_DATABASE_URL não definida: testes de integração serão pulados')
}
