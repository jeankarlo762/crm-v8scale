// statusSite é texto no banco (sem enum): `prisma db push` não perde valor nenhum. Os valores das versões
// antigas continuam aceitos nesta versão (STATUS_SITE_LEGADO) e são remapeados no boot, de forma idempotente
// (rodar de novo não muda nada: depois do remapeamento não sobra valor antigo).
import type { PrismaClient } from '@prisma/client'

export const STATUS_SITE_LEGADO = ['so_plataforma', 'site_quebrado', 'so_redes', 'sem_nada', 'so_link_rede', 'redireciona_rede'] as const

// Mesmas regras do UPDATE de 20260926120000_add_lead_enrichment (+ migrate-site-status).
export function mapLegacyStatusSite(status: string, siteUrl: string | null): string {
  switch (status) {
    case 'so_plataforma': return 'so_ota'
    case 'site_quebrado': return 'fora_do_ar'
    case 'sem_nada': return 'sem_site'
    case 'so_redes':
    case 'so_link_rede':
    case 'redireciona_rede': {
      const u = (siteUrl ?? '').toLowerCase()
      if (u.includes('instagram.com')) return 'so_instagram'
      if (u.includes('facebook.com') || u.includes('fb.com')) return 'so_facebook'
      return 'link_bio'
    }
    default: return status
  }
}

export async function remapLegacyStatusSite(db: Pick<PrismaClient, 'prospect'>): Promise<number> {
  const rows = await db.prospect.findMany({ where: { statusSite: { in: [...STATUS_SITE_LEGADO] } }, select: { id: true, statusSite: true, siteUrl: true, destinoReal: true } })
  const byTarget = new Map<string, string[]>()
  for (const r of rows) {
    const target = mapLegacyStatusSite(r.statusSite, r.siteUrl ?? r.destinoReal)
    byTarget.set(target, [...(byTarget.get(target) ?? []), r.id])
  }
  for (const [statusSite, ids] of byTarget) await db.prospect.updateMany({ where: { id: { in: ids } }, data: { statusSite } })
  return rows.length
}
