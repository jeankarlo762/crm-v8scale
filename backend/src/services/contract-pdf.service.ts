import PDFDocument from 'pdfkit'
import { env } from '../config/env'

const BRAND = '#007BFF'
const BLANK_DATE = '____/____/________'

export interface ContractPdfInput {
  id: string
  title: string
  clientName: string
  clientDocument?: string | null
  clientEmail?: string | null
  clientPhone?: string | null
  clientAddress?: string | null
  serviceObject?: string | null
  monthlyValue: number
  setupFee: number
  paymentDay?: number | null
  startDate?: Date | null
  durationMonths?: number | null
  bodyText?: string | null
}

function money(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// As datas são gravadas à meia-noite UTC (só o dia importa), então formata em UTC.
function fmtDate(d?: Date | null): string {
  return d ? d.toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : BLANK_DATE
}

export const DEFAULT_SERVICE_OBJECT =
  'a prestação de serviços de gestão de tráfego pago pela CONTRATADA, compreendendo o planejamento, a criação, a ' +
  'publicação, o acompanhamento e a otimização de campanhas de anúncios on-line (Meta Ads, Google Ads e outras ' +
  'plataformas acordadas) voltadas à geração de leads para a CONTRATANTE, além de relatórios periódicos de desempenho.'

// Cláusulas padrão, usadas quando o contrato não tem corpo personalizado.
// IMPORTANTE: revisar juridicamente antes de usar em produção.
export function defaultContractBody(input: ContractPdfInput): string {
  const objeto = input.serviceObject?.trim() || DEFAULT_SERVICE_OBJECT
  const vencimento = input.paymentDay ? `todo dia ${input.paymentDay} de cada mês` : 'mensalmente, em data acordada entre as partes'
  const vigencia = input.durationMonths ? `${input.durationMonths} (${input.durationMonths}) meses` : 'prazo indeterminado'
  const clauses = [
    `CLÁUSULA 1ª — DO OBJETO. O presente contrato tem por objeto ${objeto.replace(/\.?$/, '.')}`,
    `CLÁUSULA 2ª — DO VALOR E PAGAMENTO. Pelos serviços, a CONTRATANTE pagará à CONTRATADA o valor mensal de ${money(input.monthlyValue)}, com vencimento ${vencimento}, pelos meios indicados pela CONTRATADA.` +
      (input.setupFee > 0 ? ` Será devida ainda uma taxa única de implantação de ${money(input.setupFee)}, paga junto com a primeira mensalidade.` : ''),
    'CLÁUSULA 3ª — DA VERBA DE MÍDIA. O investimento em anúncios (verba de mídia) não está incluído nos valores acima e é pago pela CONTRATANTE diretamente às plataformas de anúncio, em contas de sua titularidade.',
    `CLÁUSULA 4ª — DA VIGÊNCIA. O contrato vigorará por ${vigencia}, a contar de ${fmtDate(input.startDate)}, renovando-se automaticamente por iguais períodos, salvo manifestação em contrário de qualquer das partes.`,
    'CLÁUSULA 5ª — DAS OBRIGAÇÕES DA CONTRATADA. Planejar, executar e otimizar as campanhas com diligência técnica, manter a CONTRATANTE informada por meio de relatórios periódicos e zelar pela confidencialidade das informações recebidas.',
    'CLÁUSULA 6ª — DAS OBRIGAÇÕES DA CONTRATANTE. Efetuar os pagamentos nas datas acordadas, fornecer os acessos, materiais e informações necessários à execução dos serviços e dar o atendimento comercial aos leads gerados.',
    'CLÁUSULA 7ª — DOS RESULTADOS. A CONTRATADA compromete-se com a boa execução técnica das campanhas, não sendo garantido volume específico de leads ou de vendas, que dependem de fatores alheios ao seu controle.',
    'CLÁUSULA 8ª — DA PROTEÇÃO DE DADOS (LGPD). As partes comprometem-se a tratar os dados pessoais envolvidos conforme a Lei nº 13.709/2018 (LGPD).',
    'CLÁUSULA 9ª — DA RESCISÃO. O contrato poderá ser rescindido por qualquer das partes mediante aviso prévio de 30 (trinta) dias, sem prejuízo dos valores devidos até a data da rescisão.',
    'CLÁUSULA 10ª — DO FORO. Fica eleito o foro da comarca da sede da CONTRATADA para dirimir eventuais dúvidas oriundas deste contrato.',
  ]
  return clauses.join('\n\n')
}

export function generateContractPdf(input: ContractPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: input.title, Author: env.CONTRACT_COMPANY_NAME } })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(18).text(input.title, { align: 'center' })
      doc.moveDown(0.3)
      doc.fillColor('#666').font('Helvetica').fontSize(9).text(`Contrato nº ${input.id.slice(-8).toUpperCase()}`, { align: 'center' })
      doc.moveDown(1.2)

      doc.fillColor('#111').font('Helvetica-Bold').fontSize(11).text('CONTRATADA')
      doc.font('Helvetica').fontSize(10).fillColor('#222')
        .text(env.CONTRACT_COMPANY_DOCUMENT ? `${env.CONTRACT_COMPANY_NAME} — CNPJ ${env.CONTRACT_COMPANY_DOCUMENT}` : env.CONTRACT_COMPANY_NAME)
      if (env.CONTRACT_COMPANY_ADDRESS) doc.text(env.CONTRACT_COMPANY_ADDRESS)
      doc.moveDown(0.6)

      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text('CONTRATANTE')
      doc.font('Helvetica').fontSize(10).fillColor('#222').text(input.clientName)
      if (input.clientDocument) doc.text(`CPF/CNPJ: ${input.clientDocument}`)
      if (input.clientAddress) doc.text(`Endereço: ${input.clientAddress}`)
      if (input.clientEmail) doc.text(`E-mail: ${input.clientEmail}`)
      if (input.clientPhone) doc.text(`Telefone: ${input.clientPhone}`)
      doc.moveDown(1)

      const body = input.bodyText?.trim() ? input.bodyText : defaultContractBody(input)
      doc.font('Helvetica').fontSize(10).fillColor('#111')
      for (const paragraph of body.split(/\n\s*\n+/)) {
        doc.text(paragraph.trim(), { align: 'justify' })
        doc.moveDown(0.6)
      }

      doc.moveDown(1.5)
      const place = env.CONTRACT_COMPANY_CITY ? `${env.CONTRACT_COMPANY_CITY}, ` : ''
      doc.fontSize(10).fillColor('#111').text(`${place}${input.startDate ? fmtDate(input.startDate) : '_______________'}`)
      doc.moveDown(3)
      if (doc.y > doc.page.height - 120) doc.addPage()
      const y = doc.y
      doc.moveTo(70, y).lineTo(270, y).stroke('#999')
      doc.moveTo(325, y).lineTo(525, y).stroke('#999')
      doc.fontSize(9).fillColor('#444')
        .text(`CONTRATADA\n${env.CONTRACT_COMPANY_NAME}`, 70, y + 4, { width: 200, align: 'center' })
        .text(`CONTRATANTE\n${input.clientName}`, 325, y + 4, { width: 200, align: 'center' })

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}
