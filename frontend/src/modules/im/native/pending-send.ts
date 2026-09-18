export function isPendingSend(msg: { fake_msg?: unknown } | null | undefined): boolean {
  return Boolean(msg?.fake_msg)
}

export function findLatestPendingSend<T extends { fake_msg?: unknown }>(list: T[]): T | null {
  for (let i = list.length - 1; i >= 0; i--) {
    if (isPendingSend(list[i])) return list[i]
  }
  return null
}

export function confirmPendingSend(msg: { fake_msg?: unknown, revoke?: boolean, message_id?: unknown }, nextId?: unknown): void {
  if (nextId != null) msg.message_id = nextId
  msg.fake_msg = undefined
  msg.revoke = false
}

export function failPendingSend(msg: { fake_msg?: unknown, revoke?: boolean }): void {
  msg.fake_msg = undefined
  msg.revoke = false
}
