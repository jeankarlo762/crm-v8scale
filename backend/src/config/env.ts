import 'dotenv/config'
import { z } from 'zod'

// Variáveis vazias ("") são tratadas como ausentes: o Railway às vezes injeta
// "" e um .env com `CHAVE=` também produz "".
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)

const envSchema = z.object({
  NODE_ENV: z.preprocess(blankToUndefined, z.enum(['development', 'production', 'test']).default('production')),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  // Origens permitidas no CORS, separadas por vírgula. Obrigatório em produção.
  CORS_ORIGINS: z.preprocess(blankToUndefined, z.string().optional()),
  // Primeiro acesso: criado no boot só se ainda não existir nenhum usuário.
  SEED_ADMIN_NAME: z.string().default('Administrador V8 Scale'),
  SEED_ADMIN_EMAIL: z.preprocess(blankToUndefined, z.string().email().optional()),
  SEED_ADMIN_PASSWORD: z.preprocess(blankToUndefined, z.string().min(8).optional()),


  // ── Prospecção (Google Places, Tavily, Meta) e investigação de site ──────────────────────────────────
  // Orçamento INTERNO das APIs externas. SEM default de franquia: sem a janela obrigatória (api-quota.service.ts →
  // REQUIRED_WINDOWS) o provedor fica BLOQUEADO, nunca sem teto. Google Places = duas operações com contadores separados.
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  TAVILY_API_KEY: z.string().optional(),
  PLACES_MOCK: z.enum(['true', 'false']).default('false'),
  GOOGLE_TEXT_SEARCH_PRO_HOURLY_BUDGET: z.coerce.number().int().positive().optional(),
  GOOGLE_TEXT_SEARCH_PRO_MONTHLY_BUDGET: z.coerce.number().int().positive().optional(),
  GOOGLE_PLACE_DETAILS_ENTERPRISE_HOURLY_BUDGET: z.coerce.number().int().positive().optional(),
  GOOGLE_PLACE_DETAILS_ENTERPRISE_MONTHLY_BUDGET: z.coerce.number().int().positive().optional(),
  GOOGLE_TEXT_SEARCH_PRO_EXTERNAL_RESERVED: z.coerce.number().int().min(0).optional(),
  GOOGLE_PLACE_DETAILS_ENTERPRISE_EXTERNAL_RESERVED: z.coerce.number().int().min(0).optional(),
  GOOGLE_TEXT_SEARCH_PRO_PRIOR_USAGE: z.coerce.number().int().min(0).optional(),
  GOOGLE_TEXT_SEARCH_PRO_PRIOR_USAGE_UNTIL: z.string().optional(),
  GOOGLE_PLACE_DETAILS_ENTERPRISE_PRIOR_USAGE: z.coerce.number().int().min(0).optional(),
  GOOGLE_PLACE_DETAILS_ENTERPRISE_PRIOR_USAGE_UNTIL: z.string().optional(),
  GOOGLE_TEXT_SEARCH_PRO_MAX_CALLS_PER_RUN: z.coerce.number().int().positive().default(10),
  GOOGLE_PLACE_DETAILS_ENTERPRISE_MAX_CALLS_PER_RUN: z.coerce.number().int().positive().default(20),
  GOOGLE_DETAILS_ENRICH_MAX_PER_REQUEST: z.coerce.number().int().min(1).default(25),
  TAVILY_HOURLY_BUDGET: z.coerce.number().int().positive().optional(),
  TAVILY_MONTHLY_BUDGET: z.coerce.number().int().positive().optional(),
  META_HOURLY_BUDGET: z.coerce.number().int().positive().optional(),
  META_MONTHLY_BUDGET: z.coerce.number().int().positive().optional(),
  API_QUOTA_SAFETY_PERCENT: z.coerce.number().min(0).max(90).default(10),
  TAVILY_EXTERNAL_RESERVED: z.coerce.number().int().min(0).optional(),
  GOOGLE_PLACES_QUOTA_SHARED: z.enum(['true', 'false']).default('false'),
  TAVILY_QUOTA_SHARED: z.enum(['true', 'false']).default('false'),
  // Ciclo de reset do provedor: FIXED | ANCHOR_DAY:<1-28> | ROLLING (obrigatório; sem ele o provedor fica BLOQUEADO)
  GOOGLE_PLACES_QUOTA_RESET: z.string().optional(),
  TAVILY_QUOTA_RESET: z.string().optional(),
  META_QUOTA_RESET: z.string().optional(),
  GOOGLE_PLACES_QUOTA_TZ: z.string().default('UTC'),
  TAVILY_QUOTA_TZ: z.string().default('UTC'),
  META_QUOTA_TZ: z.string().default('UTC'),
  TAVILY_PRIOR_USAGE: z.coerce.number().int().min(0).optional(),
  TAVILY_PRIOR_USAGE_UNTIL: z.string().optional(),
  GOOGLE_EVIDENCE_TTL_HOURS: z.coerce.number().positive().default(720),
  TAVILY_MAX_CALLS_PER_RUN: z.coerce.number().int().positive().default(30),
  META_MAX_CALLS_PER_RUN: z.coerce.number().int().positive().default(60),
  API_OPERATION_BUDGETS: z.string().optional(),
  API_QUOTA_ALLOW_ABOVE_DOCUMENTED_CAP: z.enum(['true', 'false']).default('false'),
  MAX_GOOGLE_QUERIES_PER_CITY: z.coerce.number().int().min(1).default(2),
  MAX_GOOGLE_PAGES_PER_QUERY: z.coerce.number().int().min(1).max(3).default(1),
  MAX_GOOGLE_REQUESTS_PER_SEARCH: z.coerce.number().int().min(1).default(10),
  GOOGLE_EXPANSION_MIN_NEW: z.coerce.number().int().min(1).default(2),
  MAX_INTERNAL_PAGES_PER_CANDIDATE: z.coerce.number().int().min(0).max(5).default(3),
  MAX_TAVILY_SEARCHES_PER_LEAD: z.coerce.number().int().min(1).max(4).default(3),
  SEARCH_CACHE_TTL_HOURS: z.coerce.number().min(0).default(168),
  SEARCH_CACHE_NEGATIVE_TTL_HOURS: z.coerce.number().min(0).default(168),
  META_CACHE_TTL_HOURS: z.coerce.number().min(0).default(720),
  META_CACHE_NEGATIVE_TTL_HOURS: z.coerce.number().min(0).default(720),
  PLACES_CACHE_TTL_HOURS: z.coerce.number().min(0).default(0),
  SITE_FACTS_TTL_HOURS: z.coerce.number().positive().default(168),
  // Worker persistente da investigação
  INVESTIGATION_WORKER: z.enum(['true', 'false']).default('true'),
  INVESTIGATION_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  INVESTIGATION_POLL_MS: z.coerce.number().int().min(1000).default(15000),
  INVESTIGATION_LEASE_MS: z.coerce.number().int().min(30000).default(300000),
  INVESTIGATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  INVESTIGATION_BACKOFF_BASE_SEC: z.coerce.number().int().min(5).default(60),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.CORS_ORIGINS) {
  console.error('Variáveis de ambiente inválidas: CORS_ORIGINS é obrigatório em produção')
  process.exit(1)
}

if (parsed.data.JWT_SECRET === parsed.data.JWT_REFRESH_SECRET) {
  console.error('Variáveis de ambiente inválidas: JWT_SECRET e JWT_REFRESH_SECRET devem ser diferentes')
  process.exit(1)
}

export const env = parsed.data
