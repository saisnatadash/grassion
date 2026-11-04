import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const PREFIX = 'gl1:'
const IV_BYTES = 12
const TAG_BYTES = 16

function getKey(): Buffer | null {
  const hex = process.env.TOKEN_ENCRYPTION_KEY
  if (!hex) return null
  if (hex.length !== 64) throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
  return Buffer.from(hex, 'hex')
}

/**
 * Encrypt a plaintext token with AES-256-GCM.
 * Returns `gl1:<base64url(iv[12] || authTag[16] || ciphertext)>`.
 * If TOKEN_ENCRYPTION_KEY is not set, returns the plaintext unchanged (migration path).
 */
export function encryptToken(plaintext: string): string {
  const key = getKey()
  if (!key) return plaintext

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([iv, tag, ct])
  return `${PREFIX}${payload.toString('base64url')}`
}

/**
 * Decrypt a token encrypted by `encryptToken`.
 * If the value does not start with `gl1:`, returns it as-is (legacy plaintext).
 * Throws on decryption failure (tampered or wrong key).
 */
export function decryptToken(value: string): string {
  if (!value.startsWith(PREFIX)) return value

  const key = getKey()
  if (!key) {
    // Key not configured — strip prefix and return raw (should not happen in prod)
    return value.slice(PREFIX.length)
  }

  const payload = Buffer.from(value.slice(PREFIX.length), 'base64url')
  if (payload.length < IV_BYTES + TAG_BYTES + 1) throw new Error('invalid_encrypted_token')

  const iv = payload.subarray(0, IV_BYTES)
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ct = payload.subarray(IV_BYTES + TAG_BYTES)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
