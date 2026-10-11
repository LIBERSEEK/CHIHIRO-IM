<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Copy } from '@lucide/vue'

import type { AccountContext } from '@/contracts'
import { accountAvatarSrc, accountQzoneUrl, accountUin, openExternalFrame } from '@/app/account-ui'
import AccountPlatformBadge from '@/app/AccountPlatformBadge.vue'

type AnchorRect = {
  top: number
  left: number
  right: number
  bottom: number
  width: number
  height: number
}

const props = defineProps<{
  account: AccountContext
  anchor: AnchorRect
}>()
const emit = defineEmits<{ close: [] }>()

const CARD_W = 360
const CARD_H = 280
const cardRef = ref<HTMLElement | null>(null)
const placed = ref(false)
const copied = ref(false)
let copiedTimer: number | undefined

const uin = computed(() => accountUin(props.account))
const avatarSrc = computed(() => accountAvatarSrc(props.account))
const qzoneUrl = computed(() => accountQzoneUrl(props.account))
const copyValue = computed(() => uin.value)

function clampPos(width: number, height: number) {
  let left = props.anchor.right + 10
  let top = props.anchor.top - 8
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
  if (left < 8) left = 8
  if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8
  if (top < 8) top = 8
  return { left, top }
}

const pos = ref(clampPos(CARD_W, CARD_H))

function place() {
  const card = cardRef.value
  pos.value = clampPos(card?.offsetWidth || CARD_W, card?.offsetHeight || CARD_H)
  placed.value = true
}

async function copyUin() {
  if (!copyValue.value) return
  try {
    await navigator.clipboard.writeText(copyValue.value)
    copied.value = true
    if (copiedTimer !== undefined) window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => { copied.value = false }, 1500)
  } catch {
    copied.value = false
  }
}

function openQzone() {
  if (!qzoneUrl.value) return
  emit('close')
  openExternalFrame(`QQ空间 · ${props.account.label}`, qzoneUrl.value)
}

watch(() => props.account.id, () => { copied.value = false })
watch(() => props.anchor, () => { pos.value = clampPos(CARD_W, CARD_H); void nextTick(place) }, { deep: true })
onMounted(() => {
  place()
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', place)
  if (copiedTimer !== undefined) window.clearTimeout(copiedTimer)
})
</script>

<template>
  <Teleport to="body">
    <div class="account-profile-mask" @click="emit('close')" />
    <div
      ref="cardRef"
      class="account-profile-card"
      role="dialog"
      aria-modal="true"
      :aria-label="`${account.label} 的账号信息`"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, visibility: placed ? 'visible' : 'hidden' }"
      @click.stop
    >
      <div class="account-profile-head">
        <div class="account-profile-avatar-wrap">
          <img v-if="avatarSrc" class="account-profile-avatar" :src="avatarSrc" alt="" referrerpolicy="no-referrer" />
          <span v-else class="account-profile-avatar account-profile-avatar-fallback">{{ account.label.slice(0, 1) }}</span>
          <AccountPlatformBadge :platform="account.platform" />
        </div>
        <div class="account-profile-head-main">
          <div class="account-profile-name-row">
            <span class="account-profile-name">{{ account.label }}</span>
            <span class="account-profile-dot" :class="{ online: account.status === 'online' }" />
          </div>
          <div v-if="account.platform === 'qq'" class="account-profile-qq">
            <span>QQ {{ uin || '—' }}</span>
            <button
              v-if="uin"
              type="button"
              class="account-profile-copy"
              :title="copied ? '已复制' : '复制 QQ 号'"
              :aria-label="copied ? '已复制' : '复制 QQ 号'"
              @click="copyUin"
            >
              <Check v-if="copied" :size="14" />
              <Copy v-else :size="14" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="account.platform === 'qq'" class="account-profile-rows">
        <div class="account-profile-row">
          <span class="account-profile-label">等级</span>
          <span class="account-profile-value" />
        </div>
        <div class="account-profile-row">
          <span class="account-profile-label">备注</span>
          <span class="account-profile-value" />
        </div>
        <div class="account-profile-row">
          <span class="account-profile-label">签名</span>
          <span class="account-profile-value" />
        </div>
        <button v-if="qzoneUrl" type="button" class="account-profile-row is-link" @click="openQzone">
          <span class="account-profile-label">QQ空间</span>
          <span class="account-profile-value account-profile-qzone">
            查看他的QQ空间
            <span aria-hidden="true">›</span>
          </span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.account-profile-mask {
  position: fixed;
  inset: 0;
  z-index: 2799;
}
.account-profile-card {
  position: fixed;
  z-index: 2800;
  width: 360px;
  max-width: calc(100vw - 16px);
  padding: 18px 16px 14px;
  border: 1px solid var(--shell-line);
  border-radius: 16px;
  color: var(--shell-text);
  background: var(--shell-rail);
  box-shadow: 0 16px 40px rgb(0 0 0 / 42%);
  box-sizing: border-box;
}
.account-profile-head { display: flex; align-items: flex-start; gap: 12px; }
.account-profile-avatar-wrap {
  position: relative;
  width: 64px;
  height: 64px;
  flex: 0 0 64px;
}
.account-profile-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  object-fit: cover;
  background: #3a3a3c;
}
.account-profile-avatar-wrap :deep(.account-platform-badge) {
  width: 20px;
  height: 20px;
  right: -2px;
  bottom: -2px;
}
.account-profile-avatar-wrap :deep(.account-platform-badge svg) {
  width: 12px;
  height: 12px;
}
.account-profile-avatar-fallback {
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 22px;
  font-weight: 650;
}
.account-profile-head-main { min-width: 0; flex: 1; padding-top: 6px; }
.account-profile-name-row { display: flex; align-items: center; gap: 8px; min-height: 22px; }
.account-profile-name {
  overflow: hidden;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-profile-dot {
  width: 8px;
  height: 8px;
  flex: 0 0 8px;
  box-sizing: border-box;
  border: 1.5px solid rgba(160, 160, 160, .7);
  border-radius: 50%;
  background: transparent;
}
.account-profile-dot.online { border-color: #34c759; background: #34c759; }
.account-profile-qq {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  color: var(--shell-muted);
  font-size: 13px;
}
.account-profile-copy {
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--shell-muted);
  background: transparent;
  cursor: pointer;
}
.account-profile-copy:hover { color: var(--shell-text); background: var(--shell-line); }
.account-profile-rows { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; }
.account-profile-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: start;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
}
.account-profile-row.is-link { cursor: pointer; }
.account-profile-label { color: var(--shell-muted); font-size: 13px; line-height: 1.4; }
.account-profile-value { min-height: 1.4em; color: var(--shell-text); font-size: 13px; line-height: 1.4; word-break: break-word; }
.account-profile-qzone { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.account-profile-qzone span { color: var(--shell-muted); font-size: 16px; line-height: 1; }
</style>
