<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { PictureInPicture2, Volume2, VolumeX } from '@lucide/vue'
import { useShellStore } from '@/stores/shell'
import { pauseGrowthTask, setGrowthPreviewMode, setGrowthPreviewMuted, stopGrowthTask } from './client'
import { parsePipCorner, pipCornerPositions, pipLayoutInsets, readPipChrome, PIP_CORNERS, type PipCorner } from './pip-position'

const CORNER_KEY = 'chihiro-growth-pip-corner'
const shell = useShellStore()
const task = computed(() => shell.growthTask)
const visible = computed(() => shell.growthPipOpen || task.value.running)
const lastLog = computed(() => task.value.logs.at(-1)?.text || (task.value.running ? '任务进行中' : '画中画已打开'))
const accountLabel = computed(() => {
  const id = task.value.accountId
  return shell.accounts.find(account => account.id === id)?.label || '抖音'
})
const frame = ref('')
const streamMode = ref<'pip' | 'window' | ''>('')
const streamMuted = ref<boolean | null>(null)
const switching = ref(false)
const pausing = ref(false)
const muting = ref(false)
const pickerOpen = ref(false)
const mode = computed(() => streamMode.value || task.value.previewMode)
const muted = computed(() => streamMuted.value ?? task.value.previewMuted)
const pipEl = ref<HTMLElement | null>(null)
const corner = ref<PipCorner>(readCorner())
const pos = ref(initialPos())
let source: EventSource | undefined
let reconnectTimer = 0

function readCorner(): PipCorner {
  try {
    return parsePipCorner(window.localStorage.getItem(CORNER_KEY))
  } catch {
    return 'br'
  }
}

function layoutInsets() {
  return pipLayoutInsets(readPipChrome())
}

function initialPos() {
  if (typeof window === 'undefined') return { x: 72, y: 16 }
  return pipCornerPositions(window.innerWidth, window.innerHeight, 360, 240, layoutInsets())[readCorner()]
}

function saveCorner(next: PipCorner) {
  corner.value = next
  try { window.localStorage.setItem(CORNER_KEY, next) } catch { /* ignore quota */ }
}

function boxSize() {
  const el = pipEl.value
  return {
    width: el?.offsetWidth || 360,
    height: el?.offsetHeight || 240,
  }
}

function snapTo(next: PipCorner) {
  const { width, height } = boxSize()
  pos.value = pipCornerPositions(window.innerWidth, window.innerHeight, width, height, layoutInsets())[next]
  saveCorner(next)
}

function placeFromStorage() {
  snapTo(readCorner())
}

function chooseCorner(next: PipCorner) {
  snapTo(next)
  pickerOpen.value = false
}

function togglePicker() {
  pickerOpen.value = !pickerOpen.value
}

function disconnectPreview() {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = 0
  }
  source?.close()
  source = undefined
}

function connectPreview() {
  disconnectPreview()
  if (typeof EventSource === 'undefined') return
  source = new EventSource('/api/runtime/growth/preview/stream')
  source.onmessage = (event) => {
    try {
      const body = JSON.parse(event.data) as { jpeg?: string; mode?: string; available?: boolean; muted?: boolean }
      if (body.available === false) frame.value = ''
      else if (typeof body.jpeg === 'string' && body.jpeg) frame.value = body.jpeg
      if (body.mode === 'pip' || body.mode === 'window') streamMode.value = body.mode
      if (typeof body.muted === 'boolean') streamMuted.value = body.muted
    } catch {
      /* ignore malformed frames */
    }
  }
  source.onerror = () => {
    source?.close()
    source = undefined
    if (reconnectTimer || !visible.value) return
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = 0
      if (visible.value) connectPreview()
    }, 800)
  }
}

watch(visible, async (open) => {
  if (open) {
    connectPreview()
    await nextTick()
    placeFromStorage()
  } else {
    disconnectPreview()
    pickerOpen.value = false
    frame.value = ''
    streamMode.value = ''
    streamMuted.value = null
  }
}, { immediate: true })

function onResize() {
  if (visible.value) snapTo(corner.value)
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!pickerOpen.value) return
  const el = pipEl.value
  if (el && event.target instanceof Node && el.contains(event.target)) return
  pickerOpen.value = false
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', onResize)
  document.addEventListener('pointerdown', onDocumentPointerDown)
}
onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', onResize)
    document.removeEventListener('pointerdown', onDocumentPointerDown)
  }
  disconnectPreview()
})

async function stopTask() {
  try {
    shell.applyRuntimeState(await stopGrowthTask())
  } catch (cause) {
    shell.error = cause instanceof Error ? cause.message : '无法停止任务'
  }
}

async function togglePause() {
  if (pausing.value || !task.value.running) return
  pausing.value = true
  try {
    shell.applyRuntimeState(await pauseGrowthTask(!task.value.paused))
  } catch (cause) {
    shell.error = cause instanceof Error ? cause.message : '无法暂停任务'
  } finally {
    pausing.value = false
  }
}

async function toggleMute() {
  if (muting.value) return
  muting.value = true
  try {
    const next = !muted.value
    shell.applyRuntimeState(await setGrowthPreviewMuted(next))
    streamMuted.value = next
  } catch (cause) {
    shell.error = cause instanceof Error ? cause.message : '无法切换静音'
  } finally {
    muting.value = false
  }
}

async function setMode(next: 'pip' | 'window') {
  if (switching.value) return
  switching.value = true
  try {
    shell.applyRuntimeState(await setGrowthPreviewMode(next))
    streamMode.value = next
  } catch (cause) {
    shell.error = cause instanceof Error ? cause.message : '无法切换预览窗口'
  } finally {
    switching.value = false
  }
}
</script>

<template>
  <aside
    v-if="visible"
    ref="pipEl"
    class="growth-pip"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    role="complementary"
    aria-label="抖音任务画中画"
  >
    <header>
      <strong>{{ task.paused ? '抖音任务已暂停' : (task.running ? '抖音任务进行中' : '抖音画中画') }}</strong>
      <span>{{ accountLabel }} · {{ mode === 'pip' ? '画中画投屏' : '独立窗口' }} · 评论 {{ task.commented }} / 浏览 {{ task.scanned }}</span>
    </header>
    <div class="growth-pip-screen">
      <img v-if="frame" :src="`data:image/jpeg;base64,${frame}`" alt="抖音任务画面" draggable="false" />
      <p v-else>{{ task.running ? '正在接入抖音画面…' : '等待任务启动' }}</p>
      <div class="growth-pip-tools">
        <button
          type="button"
          class="growth-pip-tool"
          :aria-pressed="muted"
          :title="muted ? '取消静音' : '静音'"
          :disabled="muting"
          @click="toggleMute"
        >
          <Volume2 v-if="muted" :size="14" />
          <VolumeX v-else :size="14" />
          <span>静音</span>
        </button>
        <button
          type="button"
          class="growth-pip-tool"
          :aria-expanded="pickerOpen"
          :aria-pressed="pickerOpen"
          title="位置"
          @click="togglePicker"
        >
          <PictureInPicture2 :size="14" />
          <span>位置</span>
        </button>
      </div>
      <div v-if="pickerOpen" class="growth-pip-picker" role="menu" aria-label="选择画中画位置">
        <button
          v-for="item in PIP_CORNERS"
          :key="item.id"
          type="button"
          class="growth-pip-corner"
          :class="item.id"
          :aria-current="corner === item.id"
          role="menuitemradio"
          :aria-checked="corner === item.id"
          @click="chooseCorner(item.id)"
        >
          <i />
          {{ item.label }}
        </button>
      </div>
    </div>
    <p>{{ lastLog }}</p>
    <div class="growth-pip-actions">
      <button
        v-if="task.running"
        type="button"
        :disabled="switching"
        @click="setMode(mode === 'pip' ? 'window' : 'pip')"
      >{{ mode === 'pip' ? '弹出窗口' : '收回画中画' }}</button>
      <button v-if="task.running" type="button" :disabled="pausing" @click="togglePause">{{ task.paused ? '继续' : '暂停' }}</button>
      <button v-if="task.running" type="button" class="danger" @click="stopTask">停止</button>
      <button type="button" @click="shell.setGrowthPipOpen(false)">收起</button>
    </div>
  </aside>
</template>

<style scoped>
.growth-pip {
  position: fixed;
  z-index: 950;
  right: auto;
  bottom: auto;
  display: grid;
  width: min(360px, calc(100vw - 80px));
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--shell-line);
  border-radius: 14px;
  color: var(--shell-text);
  background: color-mix(in srgb, var(--shell-rail) 94%, transparent);
  box-shadow: 0 16px 40px rgb(0 0 0 / 32%);
  backdrop-filter: blur(16px);
  transition: left .18s ease, top .18s ease;
}
.growth-pip header { display: grid; gap: 2px; }
.growth-pip strong { font-size: 13px; }
.growth-pip header span, .growth-pip p { margin: 0; color: var(--shell-muted); font-size: 12px; line-height: 1.5; }
.growth-pip-screen {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border-radius: 10px;
  background: #0b0b0f;
}
.growth-pip-screen img { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; pointer-events: none; }
.growth-pip-screen p {
  display: grid;
  height: 100%;
  place-items: center;
  margin: 0;
  color: var(--shell-muted);
  font-size: 12px;
}
.growth-pip-tools {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  gap: 6px;
}
.growth-pip-tool {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 999px;
  color: #fff;
  background: rgb(0 0 0 / 58%);
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
}
.growth-pip-tool[aria-pressed="true"] { color: #ffe08a; }
.growth-pip-tool:disabled { opacity: .5; cursor: not-allowed; }
.growth-pip-picker {
  position: absolute;
  top: 40px;
  right: 8px;
  z-index: 3;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-areas: "tl tr" "bl br";
  gap: 6px;
  padding: 8px;
  border: 1px solid rgb(255 255 255 / 16%);
  border-radius: 10px;
  background: rgb(0 0 0 / 78%);
  box-shadow: 0 8px 24px rgb(0 0 0 / 40%);
}
.growth-pip-corner {
  display: grid;
  justify-items: start;
  gap: 4px;
  min-width: 64px;
  padding: 6px 8px;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 8px;
  color: #fff;
  background: rgb(255 255 255 / 6%);
  cursor: pointer;
  font-size: 11px;
  text-align: left;
}
.growth-pip-corner.tl { grid-area: tl; }
.growth-pip-corner.tr { grid-area: tr; }
.growth-pip-corner.bl { grid-area: bl; }
.growth-pip-corner.br { grid-area: br; }
.growth-pip-corner i {
  display: block;
  width: 22px;
  height: 14px;
  border: 1px solid rgb(255 255 255 / 35%);
  border-radius: 3px;
  background:
    linear-gradient(#ffe08a, #ffe08a) no-repeat,
    rgb(255 255 255 / 8%);
  background-size: 7px 5px;
}
.growth-pip-corner.tl i { background-position: 2px 2px, 0 0; }
.growth-pip-corner.tr i { background-position: right 2px top 2px, 0 0; }
.growth-pip-corner.bl i { background-position: 2px bottom 2px, 0 0; }
.growth-pip-corner.br i { background-position: right 2px bottom 2px, 0 0; }
.growth-pip-corner[aria-current="true"] {
  border-color: #ffe08a88;
  color: #ffe08a;
  background: rgb(255 224 138 / 12%);
}
.growth-pip-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.growth-pip-actions button {
  padding: 6px 10px;
  border: 1px solid var(--shell-line);
  border-radius: 8px;
  color: var(--shell-text);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
}
.growth-pip-actions button:disabled { opacity: .5; cursor: not-allowed; }
.growth-pip-actions .danger { border-color: #ff453a66; color: #ff453a; }
</style>
