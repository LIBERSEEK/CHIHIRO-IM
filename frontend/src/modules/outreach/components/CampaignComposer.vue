<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useOutreachCampaignStore } from '../stores/campaign'

const props = defineProps<{ part: 'panel' | 'chips' | 'tools' }>()

const emit = defineEmits<{ files: [files: File[]] }>()

const campaign = useOutreachCampaignStore()
const fileInput = ref<HTMLInputElement | null>(null)
const toolsRoot = ref<HTMLElement | null>(null)
const openMenu = ref<'' | 'method' | 'image' | 'strategy'>('')
const tones = ['像路过的同行', '真诚、不夸张', '专业、讲清楚']

const attachmentCount = computed(() => campaign.composerFiles.length)

onMounted(() => {
  if (props.part === 'panel') campaign.bindComputerPick(() => fileInput.value?.click())
  if (props.part !== 'tools') return
  document.addEventListener('pointerdown', onPointerDown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
})

function onPointerDown(event: PointerEvent) {
  if (!toolsRoot.value?.contains(event.target as Node)) openMenu.value = ''
}

function toggleMenu(name: 'method' | 'image' | 'strategy') {
  openMenu.value = openMenu.value === name ? '' : name
}

function chooseMethod() {
  campaign.setMethod('comment')
  openMenu.value = ''
}

function chooseComputer() {
  campaign.requestComputerPick()
  openMenu.value = ''
}

function chooseLibrary() {
  void campaign.openLibrary()
  openMenu.value = ''
}

function chooseTone(tone: string) {
  campaign.choose({ tone })
  openMenu.value = ''
}

function chooseInteraction(interaction: 'comment' | 'comment_like') {
  campaign.choose({ interaction })
  openMenu.value = ''
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (files.length) emit('files', files)
}
</script>

<template>
  <div v-if="part === 'panel'" class="campaign-panel-slot">
    <input ref="fileInput" class="campaign-file" type="file" accept="image/*,video/*" multiple @change="onFiles" />
  </div>
  <div v-else-if="part === 'chips'" hidden></div>
  <div v-else-if="part === 'tools' && campaign.active" ref="toolsRoot" class="campaign-tools">
    <div class="tool">
      <button type="button" class="tool-pill" @click="toggleMenu('method')">
        <span>{{ campaign.method === 'comment' ? '评论获客' : '选择' }}</span>
        <i class="chevron" aria-hidden="true"></i>
      </button>
      <div v-if="openMenu === 'method'" class="tool-menu">
        <button type="button" :class="{ on: campaign.method === 'comment' }" @click="chooseMethod">评论获客</button>
      </div>
    </div>
    <div class="tool">
      <button type="button" class="tool-pill" @click="toggleMenu('strategy')">
        <span>营销策略</span>
        <em v-if="campaign.sessionTone">{{ campaign.sessionTone }}</em>
        <i class="chevron" aria-hidden="true"></i>
      </button>
      <div v-if="openMenu === 'strategy'" class="tool-menu">
        <button v-for="tone in tones" :key="tone" type="button" :class="{ on: campaign.sessionTone === tone }" @click="chooseTone(tone)">{{ tone }}</button>
        <button type="button" :class="{ on: campaign.sessionInteraction !== 'comment_like' }" @click="chooseInteraction('comment')">只评论</button>
        <button type="button" :class="{ on: campaign.sessionInteraction === 'comment_like' }" @click="chooseInteraction('comment_like')">评论并点赞</button>
      </div>
    </div>
    <div class="tool">
      <button type="button" class="tool-pill" @click="toggleMenu('image')">
        <span>附件</span>
        <em v-if="attachmentCount">{{ attachmentCount }}</em>
        <svg class="plus-mark" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3.25v9.5M3.25 8h9.5" />
        </svg>
      </button>
      <div v-if="openMenu === 'image'" class="tool-menu">
        <button type="button" @click="chooseComputer">从电脑添加</button>
        <button type="button" @click="chooseLibrary">从资料库添加</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.campaign-file { display: none; }
.campaign-tools { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; margin-top: 8px; }
.tool { position: relative; }
.tool-pill, .tool-menu button {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.tool-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
  line-height: 1;
}
.tool-pill em { max-width: 120px; overflow: hidden; font-style: normal; color: rgba(var(--v-theme-on-surface), 0.62); text-overflow: ellipsis; white-space: nowrap; }
.chevron { width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor; opacity: 0.7; }
.plus-mark {
  display: block;
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  overflow: visible;
}
.plus-mark path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.35;
  stroke-linecap: round;
  opacity: 0.72;
}
.tool-menu {
  position: absolute;
  z-index: 5;
  bottom: calc(100% + 8px);
  left: 0;
  display: grid;
  min-width: 168px;
  padding: 6px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 14px;
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 86%, rgb(var(--v-theme-on-surface)) 14%);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.28);
}
.tool-menu button { padding: 8px 10px; border: 0; border-radius: 10px; text-align: left; font-size: 13px; }
.tool-menu button.on, .tool-menu button:hover { background: rgba(var(--v-theme-on-surface), 0.08); }
</style>
