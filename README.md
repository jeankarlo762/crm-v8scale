# CRM V8 Scale

CRM da V8 Scale (tráfego pago para concessionárias), com os módulos **Comercial**, **Prospecção**, **Financeiro** e **Contratos**.
Derivado do CRM interno do Grupo MK, sem o módulo Suporte e a integração com o ArenaHub.

## Stack

| Camada | Tecnologias |
|---|---|
| Backend | Node 20+, Fastify 4, Prisma 5 + PostgreSQL, Zod, JWT (access + refresh), bcryptjs |
| Frontend | React 18, Vite 6, TypeScript, Tailwind 3, Zustand, React Router 6, React Hook Form + Zod, Recharts, dnd-kit, lucide-react |
| Deploy | Railway (nixpacks), um serviço para `backend/` e outro para `frontend/` |

## Módulos

### Comercial

- **Login** com e-mail/senha, refresh token com rotação (guardado no banco) e logout que revoga a sessão
- **Dashboard**: leads em aberto, valor no funil, novos leads, ganhos, conversão, tarefas atrasadas; gráficos de funil, leads por dia, origem e ranking por vendedor
- **Funil (Kanban)** com arrastar-e-soltar, filtro por responsável, tempo na etapa e tarefas abertas em cada card
- **Leads**: listagem com busca e filtros, arquivados, criar/editar, painel lateral com histórico de atividades e tarefas
- **Ganho → Cliente**: mover um lead para uma etapa do tipo *Ganho* cria o cliente automaticamente; etapa *Perdido* exige o motivo
- **Tarefas**, **Clientes** (mensalidade, implantação, situação ativo/cancelado, arquivamento), **Metas**
- **Relatórios** (ADMIN/MANAGER): Comercial, Funil, Prospecção, Campanhas e Usuários, com exportação CSV
- **Usuários** e **Configurações do funil** (ADMIN); **Minha conta**

### Prospecção e Campanhas (ADMIN/MANAGER)

- **Prospecção**: abas por nicho; busca no Google Places (nicho + cidades) ou importação CSV/XLSX; telefone em E.164; score; filtros; ações em massa; exportação
- **Investigação de site**: worker em fila no Postgres que decide se o negócio tem site próprio (Google Place Details, Tavily, Instagram/Meta e HTTP), com orçamento rígido por API e tela "Consumo"
- **Campanhas**: disparo em massa por WhatsApp via Baileys (QR code na tela, sessão guardada no banco), variações de mensagem, intervalo entre envios, pausa/retomada
- Prospect que chega a **Negociando** ou **Fechado** vira lead do funil automaticamente; "Converter em lead" faz isso antes

**Atenção com o Baileys**: é WhatsApp Web não oficial; o número pode ser bloqueado pelo WhatsApp. Só uma instância do
backend pode rodar (a sessão e o loop de envio ficam em memória).

### Financeiro e Contratos (ADMIN/MANAGER)

- **Financeiro**: MRR, ARR, ticket médio, implantação, novos clientes e cancelamentos do período; evolução do MRR em 12 meses,
  MRR por vendedor e faturamento por cliente (exportação CSV). Calculado a partir dos Clientes (mensalidade e implantação)
- **Contratos**: gera o contrato em PDF (cláusulas padrão de gestão de tráfego pago ou texto próprio), a partir de um cliente
  do CRM ou preenchido à mão; envia para assinatura pelo **ZapSign** (e-mail/WhatsApp), com baixa automática pelo webhook ou
  baixa manual; rascunho é editável, enviado só pode ser cancelado. Atalho "Gerar contrato" na edição do cliente
- **Integrações** (ADMIN): token do ZapSign (criptografado no banco com `ENCRYPTION_KEY`) e a URL do webhook a cadastrar no ZapSign
- Dados da contratada no PDF: `CONTRACT_COMPANY_NAME`, `CONTRACT_COMPANY_DOCUMENT`, `CONTRACT_COMPANY_ADDRESS`, `CONTRACT_COMPANY_CITY`

### Atendimento por IA (ADMIN/MANAGER)

Pensado para revendas de seminovos: a IA responde o lead em segundos (quem demora 5 min para responder perde boa parte das vendas) e entrega o lead qualificado ao vendedor.

- **WhatsApp da loja** (QR Code, Baileys, tenant `ai-attendance`): é o número principal que recebe o tráfego. O vendedor **não** atende por ele; ele chama o lead pelo próprio celular, pelo link `wa.me` do CRM, já com a **abertura sugerida pela IA**
- Ligando a IA em **Atendimento IA**, o funil ganha as etapas **Atendimento IA** (onde o lead cai) e **Atendimento do vendedor**
- Lead novo é criado na etapa da IA e **distribuído** a um vendedor (sequencial, aleatório ou sem distribuição). O vendedor recebe um aviso com botão **Assumir**; ao assumir, a IA para de responder e o card vai para a etapa do vendedor. **Passar para outro vendedor** manda o lead ao próximo da fila
- A IA (Claude) responde só com base no **Estoque** (catálogo de veículos disponíveis) e nas instruções da loja, e vai preenchendo a qualificação: carro de interesse, orçamento, troca, pagamento, prazo e um resumo
- **Avaliação no Google Meu Negócio**: botão "Pedir avaliação" nos leads ganhos, ou envio automático ao ganhar (configurável)
- Variáveis: `ANTHROPIC_API_KEY` (obrigatória para a IA responder), `ANTHROPIC_BASE_URL`, `AI_MAX_REPLIES_PER_LEAD` (padrão 40). Como o Baileys, só uma instância do backend pode rodar

### Perfis

| Perfil | Acesso |
|---|---|
| `ADMIN` | Tudo, inclusive usuários e configuração do funil |
| `MANAGER` | Vê e gerencia todo o comercial, a prospecção e as campanhas |
| `SELLER` | Só os próprios leads, tarefas e clientes |

## Rodando localmente

Pré-requisitos: Node 20+ e um PostgreSQL.

```bash
# Backend
cd backend
cp .env.example .env        # preencha DATABASE_URL, os dois JWT_* e o SEED_ADMIN_*
npm install
npm run db:deploy           # aplica as migrations (cria as tabelas)
npm run dev                 # http://localhost:3001  (cria funil padrão + admin no 1º boot)

# Frontend (outro terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173  (o Vite faz proxy de /api para :3001)
```

Entre com o e-mail e a senha definidos em `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
O admin só é criado se o banco ainda não tiver nenhum usuário, e o seed **recusa** senhas comuns (mínimo 8 caracteres, com letras e números).

Para gerar segredos: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

### Criar o admin sem variáveis de ambiente

Em vez do `SEED_ADMIN_*`, dá para criar (ou redefinir a senha de) um administrador direto no banco, rodando o script
dentro do container do backend no Railway:

```bash
cd backend
railway ssh -s backend -e production -- node - voce@empresa.com SuaSenha123 --nome "Seu Nome" < scripts/create-admin.cjs
```

A senha segue a mesma política do app (mínimo 8 caracteres, letras e números, senhas óbvias bloqueadas; `--force` ignora o bloqueio).

### Qualidade

```bash
# Backend
npm run typecheck
npm run lint
npm test                    # Vitest: unitários sempre; integração só com TEST_DATABASE_URL

# Frontend
npm run typecheck
npm run lint
npm run build
```

## Deploy no Railway

Dois serviços, cada um apontando para a sua pasta (`backend/` e `frontend/`), mais um Postgres.

**Backend** — variáveis:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | referência ao Postgres do Railway |
| `NODE_ENV` | `production` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | dois segredos diferentes, 32+ caracteres |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | ex.: `15m` / `7d` |
| `CORS_ORIGINS` | URL pública do frontend (obrigatório em produção) |
| `SEED_ADMIN_NAME` / `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | primeiro acesso (depois pode remover) |
| Prospecção | `GOOGLE_PLACES_API_KEY`, `TAVILY_API_KEY`, `META_*`, orçamentos `*_BUDGET` e ciclos `*_QUOTA_RESET` (ver `.env.example`) |

O `npm start` roda `prisma migrate deploy` antes de subir: só aplica migrations versionadas em
`prisma/migrations/`. Para mudar o schema: edite `schema.prisma`, rode `npm run db:migrate` localmente
e commite a pasta gerada.

**Frontend** — variável de **build e runtime**:

| Variável | Valor |
|---|---|
| `VITE_API_URL` | URL pública do backend, sem `/api` |

No build ela define para onde o app chama a API; em runtime o `server.mjs` usa a mesma variável para
liberar essa origem na Content-Security-Policy.

### Cotas das APIs da Prospecção

Os orçamentos (`*_BUDGET`) são tetos internos, abaixo da franquia gratuita de cada provedor. Se a **mesma chave**
for usada por outro sistema, os dois dividem a cota sem enxergar o gasto um do outro: marque `*_QUOTA_SHARED=true`,
informe `*_EXTERNAL_RESERVED` e use orçamentos menores. Sem orçamento e ciclo o provedor fica **bloqueado**.

## Estrutura

```
backend/
  prisma/schema.prisma        usuários, funil, leads, atividades, tarefas, clientes, metas, prospecção, campanhas
  prisma/migrations/          histórico versionado do schema (prisma migrate)
  src/
    app.ts                    monta o Fastify (helmet, rate limit, CORS, rotas)
    server.ts                 boot: seed + listen + worker da investigação
    config/                   env (validado com Zod) e cliente Prisma
    middlewares/              auth (JWT + perfis) e tratamento de erros
    routes/                   auth, users, comercial (/api/commercial/*), prospecção, campanhas, relatórios
    services/                 auth, leads, campanhas, Baileys, Places, investigação de site, cotas
    utils/                    validação, senha, auditoria
    seed.ts                   funil padrão + admin inicial
  test/                       Vitest: unitários + integração (app.inject contra um Postgres de teste)
frontend/
  src/
    config/modules.ts         menu da sidebar por módulo/perfil
    components/               ui/, layout, LeadDrawer, LeadFormModal
    pages/                    Login, Dashboard, Pipeline, Leads, Tasks, Customers, Metas, Prospeccao, Campanhas, Relatorios, Users, Settings, Account
    api/                      axios com refresh automático + clientes tipados
  public/                     logo.svg, logo.png, icon.svg, favicon-*.png, icon-*.png (placeholders "V8")
```

## Adicionando um novo módulo

1. **Backend**: crie `src/routes/<modulo>.routes.ts` e registre em `src/routes/index.ts` com o prefixo `/api/<modulo>`; modelos novos vão no `schema.prisma`.
2. **Frontend**: crie as páginas em `src/pages/<Modulo>/`, adicione as rotas em `App.tsx` (dentro do `AppLayout`) e um novo grupo em `src/config/modules.ts`.
3. Para restringir a certos perfis, use `roles` no item do menu e `<RequireAuth roles={[...]}>` na rota (no backend, `requireRole(...)`).

## Pendências conhecidas

- Access e refresh token ficam em `localStorage`; o desenho mais seguro é refresh token em cookie `httpOnly`.
- Sem paginação nas listagens (limite de 1000 leads / 500 tarefas por chamada).
- Logo e ícones são placeholders "V8": substituir pela arte final em `frontend/public/`.
