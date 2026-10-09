export function formatCurrency(value: number): string {
  if (!isFinite(value) || isNaN(value)) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

/** Valor compacto para cartões/gráficos: R$ 1,2 mil / R$ 3,4 mi. */
export function formatCompactCurrency(value: number): string {
  if (!isFinite(value) || isNaN(value)) return 'R$ 0'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits.length ? `(${digits}` : ''
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

/** Só dígitos — para montar links wa.me / tel:. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

export function whatsappLink(phone: string): string {
  const d = digitsOnly(phone)
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`
}

/** Datas "de calendário" (ex.: previsão de fechamento) vêm como meia-noite UTC: exibe em UTC para não voltar um dia. */
export function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** "YYYY-MM-DD" para <input type="date"> a partir de uma data ISO "de calendário". */
export function toDateInput(iso: string | null): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : ''
}

/** "YYYY-MM-DDTHH:mm" no fuso local, para <input type="datetime-local">. */
export function toDateTimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function timeAgo(iso: string): string {
  const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin} min`
  const h = Math.round(diffMin / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.round(h / 24)
  if (d < 30) return `há ${d}d`
  return `há ${Math.round(d / 30)} mês(es)`
}

/** Dias desde uma data (para "tempo na etapa"). */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
