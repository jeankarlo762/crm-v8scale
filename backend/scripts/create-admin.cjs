// Cria (ou redefine a senha de) um administrador direto no banco, sem variáveis de ambiente.
// Roda DENTRO do container do backend (tem DATABASE_URL e o build em dist/):
//
//   cd backend
//   railway ssh -s backend -e production -- node - EMAIL SENHA [--nome "Nome"] [--force] < scripts/create-admin.cjs
//
// Localmente (com backend/.env e `npm run build` feitos): node scripts/create-admin.cjs EMAIL SENHA
// --force: aceita uma senha que a política do app bloquearia (não recomendado).
const { PrismaClient } = require('@prisma/client')
const path = require('path')
// Via stdin (node -) o __dirname é '.', então resolve a partir da pasta atual (raiz do backend).
const backendRoot = __filename === '[stdin]' ? process.cwd() : path.resolve(__dirname, '..')
const { hashPassword, isBlockedPassword } = require(path.join(backendRoot, 'dist/utils/password'))

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--') && a !== '--nome'))
const nomeIdx = args.indexOf('--nome')
const nome = nomeIdx >= 0 ? args[nomeIdx + 1] : 'Administrador V8 Scale'
const positional = args.filter((a, i) => !a.startsWith('--') && !(nomeIdx >= 0 && i === nomeIdx + 1))
const [email, senha] = positional

if (!email || !senha) {
  console.error('Uso: node - EMAIL SENHA [--nome "Nome"] [--force]')
  process.exit(1)
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('E-mail inválido'); process.exit(1) }
if (senha.length < 8 || !/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) {
  console.error('Senha fraca: mínimo 8 caracteres, com letras e números'); process.exit(1)
}
if (isBlockedPassword(senha) && !flags.has('--force')) {
  console.error('Senha bloqueada pela política do app (muito comum ou o nome da empresa). Escolha outra ou use --force.')
  process.exit(1)
}

;(async () => {
  const prisma = new PrismaClient()
  const passwordHash = await hashPassword(senha)
  const u = await prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash, role: 'ADMIN', active: true },
    create: { name: nome, email: email.toLowerCase(), passwordHash, role: 'ADMIN' },
  })
  await prisma.refreshToken.deleteMany({ where: { userId: u.id } })
  console.log(`admin pronto: ${u.email} (${u.role}); usuários no banco: ${await prisma.user.count()}`)
  await prisma.$disconnect()
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
