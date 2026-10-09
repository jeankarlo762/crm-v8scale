// Domínios que nunca são o site próprio de um negócio (diretórios, guias, OTAs, mapas, notícias...).
// Fácil de ampliar: basta acrescentar na categoria certa. Aceita "*" (glob): "airbnb.*", "*.foo.com".
// Redes sociais ficam em REDE_SOCIAL_DOMAINS (domain-classifier).

export const BLOCKED_DOMAIN_GROUPS: Record<string, string[]> = {
  diretorios_cnpj: [
    'econodata.com.br', 'consultas.plus', 'cnpj.biz', 'casadosdados.com.br', 'empresaqui.com.br', 'cnpja.com',
    'solutudo.com.br', 'serasaexperian.com.br', 'cnpj.info', 'cnpjs.rocks', 'informecadastral.com.br', 'consultasocio.com', 'cnpj.services',
  ],
  listas_guias: [
    'guiamais.com.br', 'apontador.com.br', 'telelistas.net', 'encontrasc.com.br', 'cylex.com.br', 'cylex-brasil.com',
    'yelp.com', 'foursquare.com', 'yellowpages.com', 'hotfrog.com.br', 'mercadolivre.com.br', 'olx.com.br',
    'wikipedia.org', 'reddit.com', 'guiaviajarmelhor.com.br', 'guiadoturismobrasil.com', 'guiadasemana.com.br',
  ],
  turismo_reviews: [
    'tripadvisor.*', 'wanderboat.ai', 'wanderlog.com', 'booking.com', 'airbnb.*', 'expedia.*', 'trivago.*',
    'decolar.com', 'hoteis.com', 'hurb.com', 'kayak.*', 'zoover.com', 'hotels.com', 'agoda.com', 'despegar.*',
    'pousada.biz', 'hoteis.com.br', '*.hotelsantacatarina.com', 'hotelsantacatarina.com', '*.hoteis-em-suldobrasil.com',
    'hostelworld.com', 'vrbo.com', 'quintoandar.com.br', 'melhoresdestinos.com.br',
    'planetofhotels.com', 'skyscanner.*', 'wego.*', 'hoteles.com', 'a-hotel.com', 'hotelnear.com', 'br-hotels.com',
    'hotels-brazil.net', 'ohotel.com.br', 'riograndedosulhotels.net', 'hotelsantacatarina.net', 'maladeaventuras.com',
    'dicasdeviagem.com', 'levenaviagem.com.br', 'bedandbreakfastt.com', 'serrasc.com.br',
  ],
  esportes: [
    'volleybox.net', 'playtomic.io', 'playtomic.com', 'wimbledon.com', 'beachtennis.com', 'ecoquadras.com.br',
    'reservaquadras.com.br', 'quadras.app', 'agendeiquadras.com.br', 'deujogo.com', 'sympla.com.br', 'strava.com', 'transfermarkt.com', 'ogol.com.br',
  ],
  mapas: [
    'google.*', 'g.page', 'business.site', 'maps.app.goo.gl', 'waze.com', 'here.com',
    'openstreetmap.org', 'mapcarta.com', 'bing.com', 'apple.com', 'foursquare.com', 'ifood.com.br',
    'doctoralia.com.br', 'agendor.com.br',
  ],
  noticias: [
    'g1.globo.com', 'globo.com', 'uol.com.br', 'terra.com.br', 'folha.uol.com.br', 'estadao.com.br', 'r7.com',
    'ndmais.com.br', 'nsctotal.com.br', 'correiobraziliense.com.br', 'metropoles.com', 'cnnbrasil.com.br',
    'oglobo.globo.com', 'noticias.uol.com.br', 'medium.com', 'blogspot.com', 'wordpress.com',
  ],
}

// Governo e instituições: nunca são site próprio de um negócio ACHADO PELA BUSCA. Não se aplica ao
// websiteUri que o dono cadastrou no Google (esse nunca é removido por estas regras).
export const INSTITUTIONAL_DOMAINS = ['gov.br', 'jus.br', 'leg.br', 'mp.br', 'edu.br']

// Siglas dos estados (para detectar domínio de outro estado, ex.: santaterezinha.mt.gov.br).
export const UF_SIGLAS = ['ac', 'al', 'ap', 'am', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mt', 'ms', 'mg', 'pa', 'pb', 'pr', 'pe', 'pi', 'rj', 'rn', 'rs', 'ro', 'rr', 'sc', 'sp', 'se', 'to']

// Termos que, no domínio registrável, indicam agregador de hospedagem/viagem quando o nome do negócio não aparece.
export const GENERIC_TRAVEL_TERMS = [
  'hotel', 'hotels', 'hoteles', 'hoteis', 'hostel', 'booking', 'travel', 'trip', 'viagem', 'viagens', 'turismo',
  'aventura', 'bnb', 'bedandbreakfast', 'near', 'flats', 'resort', 'vacation', 'holiday', 'stay', 'reserva',
]

export const BLOCKED_DOMAINS: string[] = Object.values(BLOCKED_DOMAIN_GROUPS).flat()
