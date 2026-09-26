<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AlertCircle, CheckCircle2, RefreshCw, Wrench } from '@lucide/vue'

type CheckStatus = 'ready' | 'repairable' | 'user_action_required' | 'unsupported'
type EnvironmentCheck = {
  id: string
  label: string
  status: CheckStatus
  message: string
  capability: string
  repairable: boolean
}
type EnvironmentReport = {
  status: CheckStatus
  checks: EnvironmentCheck[]
  capabilities: { agent?: { ready: boolean; status: CheckStatus } }
  repaired?: string[]
  errors?: Array<{ id: string; message: string }>
}

const props = defineProps<{ error?: string; compact?: boolean }>()
const emit = defineEmits<{ recovered: [] }>()
const report = ref<EnvironmentReport>()
const loading = ref(true)
const repairing = ref(false)
const requestError = ref('')

const relevantChecks = computed(() => report.value?.checks.filter((item) => (
  item.capability === 'core' || item.capability === 'agent'
)) || [])
const displayedChecks = computed(() => props.compact
  ? relevantChecks.value.filter((item) => item.status !== 'ready')
  : relevantChecks.value)
const canRepair = computed(() => relevantChecks.value.some((item) => item.repairable))

async function diagnose() {
  loading.value = true
  requestError.value = ''
  try {
    const response = await fetch('/api/runtime/doctor', { cache: 'no-store' })
    const body = await response.json()
    if (!response.ok) throw new Error(body.message || '环境检测失败')
    report.value = body
  } catch (reason) {
    requestError.value = reason instanceof Error ? reason.message : '环境检测失败'
  } finally {
    loading.value = false
  }
}

async function repair() {
  repairing.value = true
  requestError.value = ''
  try {
    const response = await fetch('/api/runtime/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability: 'agent' })
    })
    const body = await response.json()
    report.value = body
    if (!response.ok || body.errors?.length) {
      throw new Error(body.errors?.map((item: { message: string }) => item.message).join('；') || body.message || '自动修复失败')
    }
    if (body.capabilities?.agent?.ready) emit('recovered')
  } catch (reason) {
    requestError.value = reason instanceof Error ? reason.message : '自动修复失败'
  } finally {
    repairing.value = false
  }
}

onMounted(diagnose)
</script>

<template>
  <section class="runtime-recovery" :class="{ 'is-compact': compact }" role="alert" aria-live="polite">
    <div class="recovery-heading">
      <AlertCircle :size="22" aria-hidden="true" />
      <div>
        <h2>Agent 暂时无法启动</h2>
        <p>{{ error || '运行环境尚未准备完成' }}</p>
      </div>
    </div>

    <div v-if="loading" class="recovery-loading">
      <RefreshCw class="is-spinning" :size="18" aria-hidden="true" />
      正在检查本机环境…
    </div>
    <ul v-else-if="displayedChecks.length" class="recovery-checks">
      <li v-for="item in displayedChecks" :key="item.id" :class="`is-${item.status}`">
        <CheckCircle2 v-if="item.status === 'ready'" :size="17" aria-hidden="true" />
        <AlertCircle v-else :size="17" aria-hidden="true" />
        <span><strong>{{ item.label }}</strong><small>{{ item.message }}</small></span>
      </li>
    </ul>

    <p v-if="requestError" class="recovery-error">{{ requestError }}</p>
    <div class="recovery-actions">
      <button v-if="canRepair" type="button" class="is-primary" :disabled="repairing" @click="repair">
        <RefreshCw v-if="repairing" class="is-spinning" :size="17" aria-hidden="true" />
        <Wrench v-else :size="17" aria-hidden="true" />
        {{ repairing ? '正在修复，首次安装可能需要几分钟' : '自动修复' }}
      </button>
      <button type="button" :disabled="loading || repairing" @click="diagnose">
        <RefreshCw :size="17" aria-hidden="true" />
        重新检测
      </button>
    </div>
  </section>
</template>

<style scoped>
.runtime-recovery {
  box-sizing: border-box;
  display: grid;
  align-content: center;
  gap: 22px;
  width: min(620px, 100%);
  min-height: 100%;
  margin: 0 auto;
  padding: 32px clamp(22px, 5vw, 56px);
  color: var(--color-font, #22252a);
}
.runtime-recovery.is-compact { align-content: center; gap: 14px; width: 100%; padding: 18px; }
.runtime-recovery.is-compact .recovery-heading h2 { font-size: 15px; }
.runtime-recovery.is-compact .recovery-heading > svg { width: 18px; height: 18px; }
.runtime-recovery.is-compact .recovery-actions { display: grid; grid-template-columns: 1fr; width: 100%; }
.runtime-recovery.is-compact .recovery-actions button { width: 100%; padding-inline: 10px; }
.recovery-heading { display: flex; align-items: flex-start; gap: 12px; }
.recovery-heading > svg { flex: 0 0 auto; margin-top: 2px; color: #e5484d; }
.recovery-heading h2 { margin: 0 0 6px; font-size: 18px; line-height: 1.35; letter-spacing: 0; }
.recovery-heading p { margin: 0; color: var(--color-font-1, #62666d); font-size: 13px; overflow-wrap: anywhere; }
.recovery-loading { display: flex; align-items: center; gap: 9px; color: var(--color-font-1, #62666d); font-size: 13px; }
.recovery-checks { display: grid; gap: 1px; margin: 0; padding: 0; list-style: none; border-block: 1px solid var(--color-card-2, #e5e7eb); }
.recovery-checks li { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 9px; align-items: start; padding: 11px 2px; border-bottom: 1px solid var(--color-card-2, #e5e7eb); }
.recovery-checks li:last-child { border-bottom: 0; }
.recovery-checks li > svg { margin-top: 2px; color: #d97706; }
.recovery-checks li.is-ready > svg { color: #218358; }
.recovery-checks span { display: grid; gap: 2px; min-width: 0; }
.recovery-checks strong { font-size: 13px; font-weight: 650; }
.recovery-checks small { color: var(--color-font-1, #62666d); font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.recovery-error { margin: -8px 0 0; color: #c62a2f; font-size: 12px; overflow-wrap: anywhere; }
.recovery-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.recovery-actions button { display: inline-flex; min-height: 36px; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; border: 1px solid var(--color-card-2, #d7d9dd); border-radius: 6px; color: inherit; background: transparent; cursor: pointer; font: inherit; font-size: 13px; }
.recovery-actions button.is-primary { border-color: #1976d2; color: #fff; background: #1976d2; }
.recovery-actions button:disabled { cursor: wait; opacity: .58; }
.is-spinning { animation: recovery-spin .9s linear infinite; }
@keyframes recovery-spin { to { transform: rotate(360deg); } }
@media (max-width: 520px) {
  .runtime-recovery { align-content: start; padding-top: 24px; }
  .recovery-actions button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) { .is-spinning { animation: none; } }
</style>
