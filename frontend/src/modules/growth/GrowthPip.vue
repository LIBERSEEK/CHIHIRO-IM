<script setup lang="ts">
import { computed } from 'vue'
import { useShellStore } from '@/stores/shell'
import { stopGrowthTask } from './client'

const shell = useShellStore()
const task = computed(() => shell.growthTask)
const visible = computed(() => shell.growthPipOpen || task.value.running)
const lastLog = computed(() => task.value.logs.at(-1)?.text || (task.value.running ? '任务进行中' : '画中画已打开'))
const accountLabel = computed(() => {
  const id = task.value.accountId
  return shell.accounts.find(account => account.id === id)?.label || '抖音'
})

async function stopTask() {
  try {
    shell.applyRuntimeState(await stopGrowthTask())
  } catch (cause) {
    shell.error = cause instanceof Error ? cause.message : '无法停止任务'
  }
}
</script>

<template>
  <aside v-if="visible" class="growth-pip" role="complementary" aria-label="抖音任务画中画">
    <header>
      <strong>{{ task.running ? '抖音任务进行中' : '抖音画中画' }}</strong>
      <span>{{ accountLabel }} · 评论 {{ task.commented }} / 浏览 {{ task.scanned }}</span>
    </header>
    <p>{{ lastLog }}</p>
    <div class="growth-pip-actions">
      <button v-if="task.running" type="button" class="danger" @click="stopTask">停止</button>
      <button type="button" @click="shell.setGrowthPipOpen(false)">收起</button>
    </div>
  </aside>
</template>

<style scoped>
.growth-pip {
  position:fixed;
  z-index:950;
  right:16px;
  bottom:16px;
  display:grid;
  width:min(320px, calc(100vw - 80px));
  gap:8px;
  padding:12px 14px;
  border:1px solid var(--shell-line);
  border-radius:14px;
  color:var(--shell-text);
  background:color-mix(in srgb, var(--shell-rail) 94%, transparent);
  box-shadow:0 16px 40px rgb(0 0 0 / 32%);
  backdrop-filter:blur(16px);
}
.growth-pip header { display:grid; gap:2px; }
.growth-pip strong { font-size:13px; }
.growth-pip header span, .growth-pip p { margin:0; color:var(--shell-muted); font-size:12px; line-height:1.5; }
.growth-pip-actions { display:flex; justify-content:flex-end; gap:8px; }
.growth-pip-actions button { padding:6px 10px; border:1px solid var(--shell-line); border-radius:8px; color:var(--shell-text); background:transparent; cursor:pointer; font-size:12px; }
.growth-pip-actions .danger { border-color:#ff453a66; color:#ff453a; }
</style>
