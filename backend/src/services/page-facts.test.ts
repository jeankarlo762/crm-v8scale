import { describe, it, expect } from 'vitest'
import { extractPageFacts } from './page-facts.service'

const wrap = (body: string, head = '') => `<html><head><title>Arena Tribo - Beach Tennis</title>${head}</head><body>${body}</body></html>`
const filler = '<p>' + 'Quadras de beach tennis, futevôlei e vôlei de areia para toda a família, aulas e torneios o ano todo. '.repeat(4) + '</p>'
const facts = (html: string, over = {}) => extractPageFacts({ url: 'https://arenatribo.com.br', finalUrl: 'https://arenatribo.com.br', html, httpStatus: 200, ...over })

describe('extractPageFacts', () => {
  it('separa telefones por origem: tel:, WhatsApp, estruturado, contato e genérico', () => {
    const html = wrap(`${filler}
      <a href="tel:+554833334444">ligue</a><a href="https://wa.me/5548991234567">zap</a>
      <script type="application/ld+json">{"@type":"SportsActivityLocation","name":"Arena Tribo","telephone":"(48) 3555-1000","address":{"@type":"PostalAddress","streetAddress":"Rua das Flores, 123","addressLocality":"Tubarão","addressRegion":"SC"}}</script>
      <footer>Contato: (48) 3777-8888</footer>
      <p>Parceiro: (11) 98888-7777 patrocina nosso torneio.</p>`)
    const f = facts(html)
    expect(f.phones.tel).toEqual(['4833334444'])
    expect(f.phones.whatsapp).toEqual(['48991234567'])
    expect(f.phones.structured).toEqual(['4835551000'])
    expect(f.phones.contact).toContain('4837778888')
    expect(f.phones.generic).toContain('11988887777') // registrado, mas NÃO conta como confirmação
    expect(f.structuredNames).toEqual(['arena tribo'])
    expect(f.structuredCity).toEqual(['tubarao'])
    expect(f.addresses.join(' ')).toContain('rua das flores, 123')
  })

  it('link para Instagram, hosts linkados e nome na identidade', () => {
    const f = facts(wrap(`${filler}<a href="https://www.instagram.com/arenatribo/">ig</a><a href="https://instagram.com/p/xyz/">post</a><a href="https://reservas.sistema.com/arenatribo">reservar</a>`))
    expect(f.instagram).toEqual(['arenatribo'])
    expect(f.linkHosts).toContain('reservas.sistema.com')
    expect(f.identityNames[0]).toContain('arena tribo')
  })

  it('página que lista muitas empresas é marcada multiBusiness', () => {
    const phones = Array.from({ length: 7 }, (_, i) => `<li>Empresa ${i} (48) 9${i}123-45${i}0</li>`).join('')
    expect(facts(wrap(`${filler}<ul>${phones}</ul>`)).multiBusiness).toBe(true)
  })

  describe('avaliável × não avaliável', () => {
    it('403/anti-bot: não avaliável (BLOCKED), nunca contradição', () => {
      const f = facts('', { httpStatus: 403, blocked: true })
      expect(f).toMatchObject({ evaluable: false, notEvaluableReason: 'BLOCKED' })
    })
    it('HTML sem conteúdo útil (shell de JS): EMPTY_CONTENT', () => {
      expect(facts('<html><body><div id="root"></div><script src="app.js"></script></body></html>')).toMatchObject({ evaluable: false, notEvaluableReason: 'EMPTY_CONTENT' })
    })
    it('fora do ar, domínio parado, 404 e erro de rede também não são avaliáveis, com motivo', () => {
      expect(facts('', { health: 'fora_do_ar', httpStatus: null }).notEvaluableReason).toBe('UNREACHABLE')
      expect(facts('<p>x</p>', { health: 'dominio_parado' }).notEvaluableReason).toBe('PARKED')
      expect(facts('', { httpStatus: 404 }).notEvaluableReason).toBe('HTTP_404')
      expect(facts('', { httpStatus: null }).notEvaluableReason).toBe('ERROR')
    })
    it('página com conteúdo é avaliável e não guarda HTML bruto (só fatos compactos)', () => {
      const f = facts(wrap(filler))
      expect(f.evaluable).toBe(true)
      expect(JSON.stringify(f).length).toBeLessThan(12_000)
      expect(JSON.stringify(f)).not.toContain('<html')
    })
  })
})
