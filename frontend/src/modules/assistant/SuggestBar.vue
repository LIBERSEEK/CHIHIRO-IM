<script setup lang="ts">
import { computed } from 'vue'
import { AUTO_SEND_MS, useSuggestStore, type SuggestReply } from './suggest'
import {
  ACTION_LABELS,
  INTENT_LABELS,
  formatReadLine,
  pct,
  shouldHoldRead,
  visibleOptions,
  type ActionId,
  type IntentId,
} from './suggest-read'

const RING_RADIUS = 10
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const props = defineProps<{ surface?: 'bubble' | 'composer' }>()

const suggest = useSuggestStore()
const surface = computed(() => props.surface || 'composer')
const items = computed<SuggestReply[]>(() => {
  if (surface.value === 'composer') return suggest.composerReply ? [suggest.composerReply] : []
  return suggest.replies
})
const read = computed(() => suggest.read)
const visible = computed(() => suggest.generating || items.value.length > 0 || Boolean(read.value))
const holding = computed(() => shouldHoldRead(read.value))
const skeletonCount = computed(() => surface.value === 'composer' ? 1 : 3)
const countdownProgress = computed(() => {
  if (!suggest.countingDown) return 0
  return Math.min(1, Math.max(0, suggest.countdownMs / AUTO_SEND_MS))
})
const ringOffset = computed(() => RING_CIRCUMFERENCE * (1 - countdownProgress.value))

function isTicking(reply: SuggestReply) {
  return suggest.countingDown && reply.id === suggest.countdownReplyId
}

function onSend(reply: SuggestReply, event: Event) {
  event.stopPropagation()
  suggest.sendReply(reply)
}

function onCancel(event: Event) {
  event.stopPropagation()
  suggest.cancelCountdown()
}

function intentLabel(id: IntentId) {
  return INTENT_LABELS[id]
}

function actionLabel(id: ActionId) {
  return ACTION_LABELS[id]
}
</script>

<template>
  <div v-if="visible" class="chihiro-suggest-bar" :data-surface="surface" aria-live="polite">
    <div v-if="read && surface === 'bubble' && !suggest.generating" class="chihiro-read-card">
      <div class="chihiro-read-q">对方在问什么？</div>
      <div class="chihiro-read-opts">
        <span
          v-for="item in visibleOptions(read.intent)"
          :key="item.id"
          class="chihiro-read-opt"
          :class="{ top: item.id === read.intent.id }">
          {{ intentLabel(item.id) }} {{ pct(item.p) }}
        </span>
      </div>
      <div class="chihiro-read-q">现在该不该开口？</div>
      <div class="chihiro-read-opts">
        <span class="chihiro-read-opt" :class="{ top: read.speakNow.yes >= read.speakNow.no }">是 {{ pct(read.speakNow.yes) }}</span>
        <span class="chihiro-read-opt" :class="{ top: read.speakNow.no > read.speakNow.yes }">否 {{ pct(read.speakNow.no) }}</span>
      </div>
      <div class="chihiro-read-q">建议动作</div>
      <div class="chihiro-read-opts">
        <span
          v-for="item in visibleOptions(read.action)"
          :key="item.id"
          class="chihiro-read-opt"
          :class="{ top: item.id === read.action.id }">
          {{ actionLabel(item.id) }} {{ pct(item.p) }}
        </span>
      </div>
      <div class="chihiro-read-score">紧急 {{ read.urgency }} / 10</div>
      <div v-if="read.note" class="chihiro-read-note">{{ read.note }}</div>
      <div v-if="holding" class="chihiro-read-hold">先别回，不要硬写客套。</div>
    </div>
    <div v-else-if="read && surface === 'composer' && !suggest.generating" class="chihiro-read-line">
      {{ formatReadLine(read) }}
    </div>
    <div v-if="suggest.generating" class="chihiro-suggest-skeleton" aria-hidden="true">
      <span v-for="index in skeletonCount" :key="index" />
    </div>
    <div v-else-if="!suggest.generating && items.length" class="chihiro-suggest-chips">
      <div
        v-for="reply in items"
        :key="reply.id"
        class="chihiro-suggest-chip"
        :class="{ best: suggest.mode === 'auto' && reply.id === suggest.highlightedId }"
        role="button"
        tabindex="0"
        @click="suggest.pick(reply)"
        @keydown.enter.prevent="suggest.pick(reply)">
        <em class="chihiro-suggest-mark" aria-hidden="true">✦</em>
        <span>{{ reply.text }}</span>
        <button
          type="button"
          class="chihiro-suggest-send"
          :class="{ ticking: isTicking(reply) }"
          title="发送"
          @click="onSend(reply, $event)">
          <svg
            v-if="isTicking(reply)"
            class="chihiro-suggest-ring"
            viewBox="0 0 24 24"
            aria-hidden="true">
            <circle class="track" cx="12" cy="12" :r="RING_RADIUS" />
            <circle
              class="value"
              cx="12"
              cy="12"
              :r="RING_RADIUS"
              :stroke-dasharray="RING_CIRCUMFERENCE"
              :stroke-dashoffset="ringOffset" />
          </svg>
          <svg class="chihiro-suggest-icon" viewBox="0 0 12 12" aria-hidden="true">
            <path fill="currentColor" d="M6 9.9a.7.7 0 0 1-.7-.7V4.34L3.74 5.9a.7.7 0 1 1-.99-.99l2.76-2.76a.7.7 0 0 1 .99 0l2.76 2.76a.7.7 0 1 1-.99.99L6.7 4.34V9.2a.7.7 0 0 1-.7.7z"/>
          </svg>
        </button>
        <button
          v-if="isTicking(reply)"
          type="button"
          class="chihiro-suggest-close"
          title="取消"
          @click="onCancel($event)">
          <svg class="chihiro-suggest-icon" viewBox="0 0 12 12" aria-hidden="true">
            <path fill="currentColor" d="M3.04 3.04a.7.7 0 0 1 .99 0L6 4.99l1.97-1.95a.7.7 0 1 1 .99.99L6.99 6l1.97 1.97a.7.7 0 1 1-.99.99L6 7.01 4.03 8.96a.7.7 0 1 1-.99-.99L5.01 6 3.04 4.03a.7.7 0 0 1 0-.99z"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chihiro-suggest-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}
.chihiro-suggest-bar[data-surface="bubble"] {
  flex-direction: column;
  align-items: flex-start;
  width: max-content;
  max-width: 100%;
  min-width: 0;
}
.chihiro-read-card {
  width: min(300px, 100%);
  padding: 8px 10px 9px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-card-1) 92%, transparent);
  color: var(--color-font-1);
  font-size: 12px;
  line-height: 1.45;
}
.chihiro-read-q {
  margin-top: 6px;
  color: var(--color-font);
  font-weight: 600;
}
.chihiro-read-q:first-child { margin-top: 0; }
.chihiro-read-opts {
  display: flex;
  flex-wrap: wrap;
  gap: 0 10px;
}
.chihiro-read-opt { color: var(--color-font-2); }
.chihiro-read-opt.top { color: var(--color-font); }
.chihiro-read-score {
  margin-top: 6px;
  color: var(--color-font);
}
.chihiro-read-note {
  margin-top: 2px;
  color: var(--color-font-2);
}
.chihiro-read-hold {
  margin-top: 6px;
  color: var(--color-font);
}
.chihiro-read-line {
  width: 100%;
  color: var(--color-font-1);
  font-size: 12px;
  line-height: 1.4;
}
.chihiro-suggest-skeleton {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}
.chihiro-suggest-skeleton span {
  display: block;
  height: 32px;
  width: 108px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-font-1) 16%, transparent);
  animation: chihiro-suggest-breathe 1.2s ease-in-out infinite;
}
.chihiro-suggest-bar[data-surface="composer"] .chihiro-suggest-skeleton span {
  width: min(280px, 100%);
  flex: 1 1 180px;
  max-width: 420px;
}
.chihiro-suggest-skeleton span:nth-child(2) { animation-delay: .15s; }
.chihiro-suggest-skeleton span:nth-child(3) { animation-delay: .3s; }
.chihiro-suggest-chips {
  display: flex;
  flex-flow: row wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
  width: 100%;
}
.chihiro-suggest-bar[data-surface="bubble"] .chihiro-suggest-chips {
  width: auto;
  max-width: 100%;
}
.chihiro-suggest-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  flex: 0 0 auto;
  max-width: 100%;
  height: 32px;
  min-height: 32px;
  padding: 3px 4px 3px 10px;
  border: 1px solid color-mix(in srgb, var(--color-font-1) 22%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-card-1) 88%, transparent);
  color: var(--color-font);
  font: inherit;
  font-size: 13px;
  line-height: 1.35;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.chihiro-suggest-bar[data-surface="composer"] .chihiro-suggest-chip {
  max-width: min(520px, 100%);
}
.chihiro-suggest-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.chihiro-suggest-mark {
  flex: 0 0 auto;
  font-style: normal;
  color: rgb(var(--v-theme-primary));
  font-size: 18px;
  line-height: 1;
}
.chihiro-suggest-chip.best {
  border-color: rgb(var(--v-theme-primary));
}
.chihiro-suggest-chip:hover {
  background: color-mix(in srgb, var(--color-card-2) 80%, transparent);
}
.chihiro-suggest-send,
.chihiro-suggest-close {
  appearance: none;
  position: relative;
  box-sizing: border-box;
  flex: 0 0 24px;
  width: 24px;
  height: 24px;
  min-width: 24px;
  min-height: 24px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  line-height: 0;
  cursor: pointer;
}
.chihiro-suggest-send {
  background: var(--color-main);
  color: #fff;
}
.chihiro-suggest-send:hover {
  filter: brightness(1.08);
}
.chihiro-suggest-icon {
  display: block;
  position: relative;
  z-index: 1;
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
}
.chihiro-suggest-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
  pointer-events: none;
}
.chihiro-suggest-ring .track,
.chihiro-suggest-ring .value {
  fill: none;
  stroke-width: 2;
}
.chihiro-suggest-ring .track {
  stroke: color-mix(in srgb, #fff 32%, transparent);
}
.chihiro-suggest-ring .value {
  stroke: #fff;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.1s linear;
}
.chihiro-suggest-close {
  background: color-mix(in srgb, var(--color-font-1) 16%, transparent);
  color: var(--color-font-1);
}
.chihiro-suggest-close:hover {
  background: color-mix(in srgb, var(--color-font-1) 26%, transparent);
  color: var(--color-font);
}
@keyframes chihiro-suggest-breathe {
  0%, 100% { opacity: .4; }
  50% { opacity: 1; }
}
</style>
