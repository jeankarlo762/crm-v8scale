// Servidor de produção do frontend: serve o build estático como SPA
// (qualquer rota devolve index.html, o React Router resolve o resto).
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import handler from 'serve-handler'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3000

// URL pública da API, para a CSP liberar as chamadas (mesma variável usada no build).
const API_ORIGIN = (() => {
  try {
    return process.env.VITE_API_URL ? new URL(process.env.VITE_API_URL).origin : null
  } catch {
    return null
  }
})()

// Headers de segurança do app. A CSP é restritiva: só scripts e estilos do
// próprio build (o script de tema fica em public/theme-init.js, não inline),
// chamadas de rede só para a própria origem e para a API.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Tailwind/recharts aplicam estilos inline
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self'${API_ORIGIN ? ` ${API_ORIGIN}` : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Só faz sentido atrás de TLS (Railway termina HTTPS na borda).
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
]

http
  .createServer((req, res) =>
    handler(req, res, {
      public: path.join(__dirname, 'dist'),
      rewrites: [{ source: '**', destination: '/index.html' }],
      headers: [
        { source: '**', headers: securityHeaders },
        { source: 'assets/**', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
        { source: 'index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
      ],
    }),
  )
  .listen(PORT, '0.0.0.0', () => console.log(`CRM V8 Scale (frontend) em http://localhost:${PORT}`))
