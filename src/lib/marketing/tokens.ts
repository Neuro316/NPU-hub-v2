// src/lib/marketing/tokens.ts
// Two token kinds, neither of which carries personal data.
//
// 1. Unsubscribe tokens: `<send id>.<hmac>`. The send id is an opaque uuid; the
//    HMAC (HUB_UNSUBSCRIBE_SECRET) proves the Hub issued it. Read at call time, so a
//    rotated secret needs no code change (old links stop verifying, which is the
//    point of rotating). A missing secret fails closed: no token is minted and no
//    token verifies.
// 2. Asset tokens: 32 random bytes. Only sha256(token) is stored (asset_grants.token_hash),
//    so a database read cannot reconstruct a working link.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unsubscribeSecret(): string | null {
  const s = process.env.HUB_UNSUBSCRIBE_SECRET
  return s && s.trim().length >= 32 ? s : null
}

export function mintUnsubscribeToken(sendId: string): string | null {
  const secret = unsubscribeSecret()
  if (!secret || !UUID.test(sendId)) return null
  return `${sendId}.${b64url(createHmac('sha256', secret).update(`unsub:${sendId}`).digest())}`
}

/** Returns the send id when the token is genuine, otherwise null. */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  const secret = unsubscribeSecret()
  if (!secret || !token) return null
  const [id, mac] = token.split('.')
  if (!id || !mac || !UUID.test(id)) return null
  const want = Buffer.from(b64url(createHmac('sha256', secret).update(`unsub:${id}`).digest()))
  const got = Buffer.from(mac)
  return got.length === want.length && timingSafeEqual(got, want) ? id : null
}

export function newAssetToken(): { token: string; hash: Buffer } {
  const token = b64url(randomBytes(32))
  return { token, hash: hashAssetToken(token) }
}

export function hashAssetToken(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

/** Postgres bytea literal for supabase-js rpc arguments. */
export function byteaHex(buf: Buffer): string {
  return `\\x${buf.toString('hex')}`
}
