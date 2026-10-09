import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { PageHeader } from '../../components/layout/AppLayout'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import * as authApi from '../../api/auth.api'
import { useAuthStore } from '../../store/auth.store'
import { errMsg } from '../../utils/apiError'
import { ROLE_LABELS } from '../../types'

export default function AccountPage() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)

  useEffect(() => {
    authApi.getMe().then((me) => {
      setName(me.name)
      setPhone(me.phone ?? '')
      setEmail(me.email)
    }).catch(() => undefined)
  }, [])

  async function saveProfile() {
    if (!name.trim()) return
    setSavingProfile(true)
    try {
      const me = await authApi.updateMe({ name: name.trim(), phone: phone.trim() || null })
      setUser(me)
      toast.success('Perfil atualizado')
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível salvar')
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword() {
    if (next !== confirm) {
      toast.error('A confirmação não confere com a nova senha')
      return
    }
    setSavingPwd(true)
    try {
      await authApi.changePassword(current, next)
      toast.success('Senha alterada')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      toast.error(errMsg(err) ?? 'Não foi possível alterar a senha')
    } finally {
      setSavingPwd(false)
    }
  }

  return (
    <>
      <PageHeader title="Minha conta" subtitle={user ? `${ROLE_LABELS[user.role]} · ${email}` : undefined} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">
        <Card>
          <h2 className="text-base font-semibold text-fg mb-4">Dados pessoais</h2>
          <div className="flex flex-col gap-4">
            <Input label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="E-mail" value={email} disabled />
            <Input label="Telefone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div className="flex justify-end">
              <Button onClick={saveProfile} loading={savingProfile} disabled={!name.trim()}>Salvar</Button>
            </div>
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-fg mb-4">Alterar senha</h2>
          <div className="flex flex-col gap-4">
            <Input label="Senha atual" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            <Input label="Nova senha (mín. 8 caracteres, letras e números)" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            <Input label="Confirmar nova senha" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            <div className="flex justify-end">
              <Button onClick={savePassword} loading={savingPwd} disabled={!current || next.length < 8 || !confirm}>
                Alterar senha
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  )
}
