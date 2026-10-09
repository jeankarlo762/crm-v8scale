import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { KeyRound, Plus, Pencil } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppLayout'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Select } from '../../components/ui/Select'
import { Table } from '../../components/ui/Table'
import * as usersApi from '../../api/users.api'
import { useAuthStore } from '../../store/auth.store'
import { errMsg } from '../../utils/apiError'
import { ROLE_LABELS, type Role, type User } from '../../types'

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }))
const ROLE_VARIANT = { ADMIN: 'purple', MANAGER: 'sky', SELLER: 'gray' } as const

export default function UsersPage() {
  const me = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  // Modal de criar/editar
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<User | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<Role>('SELLER')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  // Modal de redefinir senha
  const [pwdUser, setPwdUser] = useState<User | null>(null)
  const [newPwd, setNewPwd] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setUsers(await usersApi.listUsers())
    } catch (err) {
      toast.error(errMsg(err) ?? 'Erro ao carregar os usuários')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function openCreate() {
    setEditing(null)
    setName('')
    setEmail('')
    setPhone('')
    setRole('SELLER')
    setPassword('')
    setFormOpen(true)
  }

  function openEdit(u: User) {
    setEditing(u)
    setName(u.name)
    setEmail(u.email)
    setPhone(u.phone ?? '')
    setRole(u.role)
    setFormOpen(true)
  }

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      if (editing) {
        await usersApi.updateUser(editing.id, { name: name.trim(), phone: phone.trim() || null, role })
        toast.success('Usuário atualizado')
      } else {
        await usersApi.createUser({ name: name.trim(), email: email.trim(), phone: phone.trim() || null, password, role })
        toast.success('Usuário criado')
      }
      setFormOpen(false)
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar o usuário')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(u: User) {
    try {
      await usersApi.updateUser(u.id, { active: !u.active })
      toast.success(u.active ? 'Usuário desativado' : 'Usuário reativado')
      await load()
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível alterar o status')
    }
  }

  async function savePassword() {
    if (!pwdUser) return
    setSavingPwd(true)
    try {
      await usersApi.resetUserPassword(pwdUser.id, newPwd)
      toast.success('Senha redefinida')
      setPwdUser(null)
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível redefinir a senha')
    } finally {
      setSavingPwd(false)
    }
  }

  const canSave = name.trim() && (editing || (email.trim() && password.length >= 8))

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Quem tem acesso ao CRM e com qual perfil"
        action={<Button onClick={openCreate}><Plus size={16} /> Novo usuário</Button>}
      />

      <div className="mb-4 text-xs text-fg-muted flex flex-wrap gap-x-6 gap-y-1">
        <span><strong className="text-fg">Administrador:</strong> tudo, inclusive usuários e funil</span>
        <span><strong className="text-fg">Gerente:</strong> vê e gerencia todo o comercial</span>
        <span><strong className="text-fg">Vendedor:</strong> só os próprios leads, tarefas e clientes</span>
      </div>

      <Table
        loading={loading}
        data={users}
        keyExtractor={(u) => u.id}
        columns={[
          {
            key: 'name',
            header: 'Nome',
            cell: (u) => (
              <div className="min-w-[160px]">
                <p className="font-medium text-fg">{u.name}</p>
                <p className="text-xs text-fg-muted">{u.email}</p>
              </div>
            ),
          },
          { key: 'role', header: 'Perfil', cell: (u) => <Badge label={ROLE_LABELS[u.role]} variant={ROLE_VARIANT[u.role]} /> },
          { key: 'status', header: 'Status', cell: (u) => <Badge label={u.active ? 'Ativo' : 'Inativo'} status={u.active ? 'active' : 'inactive'} /> },
          {
            key: 'actions',
            header: '',
            className: 'text-right',
            cell: (u) => (
              <div className="flex justify-end items-center gap-1">
                <button onClick={() => openEdit(u)} title="Editar" aria-label="Editar" className="p-2 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg">
                  <Pencil size={15} />
                </button>
                <button onClick={() => { setPwdUser(u); setNewPwd('') }} title="Redefinir senha" aria-label="Redefinir senha" className="p-2 rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg">
                  <KeyRound size={15} />
                </button>
                {u.id !== me?.id && (
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}>{u.active ? 'Desativar' : 'Reativar'}</Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Editar usuário' : 'Novo usuário'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} loading={saving} disabled={!canSave}>{editing ? 'Salvar' : 'Criar usuário'}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Input label="Nome *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <Input label="E-mail *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!editing} autoComplete="off" />
          <Input label="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Select
            label="Perfil"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            disabled={editing?.id === me?.id}
            options={ROLE_OPTIONS}
          />
          {!editing && (
            <Input label="Senha inicial * (mín. 8 caracteres, letras e números)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          )}
        </div>
      </Modal>

      <Modal
        open={!!pwdUser}
        onClose={() => setPwdUser(null)}
        title="Redefinir senha"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPwdUser(null)} disabled={savingPwd}>Cancelar</Button>
            <Button onClick={savePassword} loading={savingPwd} disabled={newPwd.length < 8}>Redefinir</Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted mb-4">
          Defina uma nova senha para <strong className="text-fg">{pwdUser?.name}</strong>. Ele será desconectado de todas as sessões.
        </p>
        <Input label="Nova senha (mín. 8 caracteres, letras e números)" type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} autoComplete="new-password" />
      </Modal>
    </>
  )
}
