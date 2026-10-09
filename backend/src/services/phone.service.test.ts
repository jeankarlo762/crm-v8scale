import { describe, it, expect } from 'vitest'
import { parsePhone, phoneKey } from './phone.service'

describe('parsePhone', () => {
  it('celular BR (internacional) -> E.164, celular, exibido no formato nacional', () => {
    expect(parsePhone(['+55 48 99908-7963', '(48) 99908-7963'])).toMatchObject({
      e164: '+5548999087963', country: 'BR', isMobile: true, display: '(48) 99908-7963',
    })
  })

  it('celular BR só com o número nacional', () => {
    expect(parsePhone([null, '(48) 99908-7963'])?.e164).toBe('+5548999087963')
  })

  it('fixo BR não é celular (sem WhatsApp)', () => {
    expect(parsePhone(['+55 48 3645-1021'])).toMatchObject({ e164: '+554836451021', country: 'BR', isMobile: false })
  })

  it('celular argentino "03492 15-68-5819" -> +5493492685819', () => {
    const r = parsePhone(['03492 15-68-5819'], 'AR')
    expect(r).toMatchObject({ e164: '+5493492685819', country: 'AR', isMobile: true })
    expect(r?.display).toMatch(/^\+54 9 3492/)
  })

  it('internacional argentino do Places tem prioridade sobre o nacional', () => {
    expect(parsePhone(['+54 3492 15-68-5819', '03492 15-68-5819'])?.e164).toBe('+5493492685819')
  })

  it('número inválido ou vazio -> null', () => {
    expect(parsePhone(['123', '', null])).toBeNull()
  })
})

describe('phoneKey', () => {
  it('formatos do mesmo número BR geram a mesma chave', () => {
    expect(phoneKey('+55 48 99103-1021')).toBe(phoneKey('48991031021'))
  })
})
