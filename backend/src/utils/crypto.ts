import crypto from 'node:crypto'
import { env } from '../config/env'

// Criptografia simétrica (AES-256-GCM) para segredos guardados no banco, como o token do ZapSign.
// Formato: base64(iv).base64(authTag).base64(cipher)
const KEY = crypto.createHash('sha256').update(env.ENCRYPTION_KEY ?? env.JWT_SECRET).digest()
const IV_BYTES = 12

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Ciphertext inválido')
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
