import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * 교사 AI API 키를 DB 에 넣기 전에 암호화한다.
 *
 * 왜 필요한가 — teacher_ai_keys 는 개인 자격증명이다. 평문으로 두면 DB 백업
 * 파일이나 psql 접근만으로 학교 모든 교사의 키가 그대로 새어 나간다.
 *
 * 방식 — AES-256-GCM. 복호화 키는 서버 환경변수 AI_KEY_SECRET 에서만 얻고
 * (scrypt 로 32바이트 유도), DB 에는 어디에도 두지 않는다.
 *
 * 저장 형식 (base64 한 덩이):
 *   [ salt 16B ][ iv 12B ][ authTag 16B ][ ciphertext ... ]
 * salt 를 값마다 새로 뽑아 같은 키라도 암호문이 매번 달라진다.
 */

const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16

function secret(): string {
  const s = process.env.AI_KEY_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'AI_KEY_SECRET 이 없습니다 (또는 너무 짧습니다). .env.local 에 32자 이상의 임의 문자열을 넣으세요.'
    )
  }
  return s
}

export function encryptKey(plain: string): string {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = scryptSync(secret(), salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([salt, iv, tag, ct]).toString('base64')
}

export function decryptKey(enc: string): string {
  const buf = Buffer.from(enc, 'base64')
  const salt = buf.subarray(0, SALT_LEN)
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN)
  const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN)
  const ct = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN)
  const key = scryptSync(secret(), salt, 32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** 화면 표시용 끝 4자리. 키가 짧으면 있는 만큼만. */
export function keyHint(plain: string): string {
  return plain.slice(-4)
}
