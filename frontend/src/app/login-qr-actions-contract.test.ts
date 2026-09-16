import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(new URL('./AppShell.vue', import.meta.url), 'utf8')

describe('login QR actions', () => {
  it('hides 刷新二维码 unless a QR image is actually shown', () => {
    expect(shell).toContain('<img v-if="shell.qrReady" class="login-qr"')
    expect(shell).toContain('v-if="shell.qrReady" type="button" :disabled="shell.accountAction" @click="shell.refreshLoginQr">刷新二维码')
    expect(shell).not.toContain('v-if="shell.qrReady || loginNeedsRestart"')
  })
})
