import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** .env.local 을 읽는다. dotenv 의존성 없이 필요한 만큼만 처리한다. */
export function loadEnv() {
  const path = join(ROOT, '.env.local')
  if (!existsSync(path)) return {}

  const env = {}
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // 따옴표로 감싼 값도 받아준다
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (value) env[key] = value
  }
  return env
}

export function repoPath(...parts) {
  return join(ROOT, ...parts)
}

export const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
}

export const ok = (s) => `${c.green}✓${c.reset} ${s}`
export const bad = (s) => `${c.red}✗${c.reset} ${s}`
export const warn = (s) => `${c.yellow}!${c.reset} ${s}`
export const head = (s) => `\n${c.bold}${s}${c.reset}`
