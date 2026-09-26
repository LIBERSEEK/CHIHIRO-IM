<script setup lang="ts">
import { computed } from 'vue'
import { useGrowthCampaignStore, type GrowthBrief } from './campaign-store'

withDefaults(defineProps<{ showPicks?: boolean; card?: boolean }>(), { showPicks: false, card: false })

const campaign = useGrowthCampaignStore()
const brief = computed(() => campaign.brief)
const quickPicks = [
  { title: '装修获客', text: '正在装修、看全屋定制的人', audience: '正在装修、看全屋定制的人', tags: ['全屋定制', '旧房改造'], tone: '像路过的同行' },
  { title: '同城到店', text: '同城想找店、看评价的人', audience: '同城想找店、看评价的人', tags: ['附近', '到店'], tone: '像邻居推荐' },
  { title: '经验补充', text: '在看教程和经验的人', audience: '在看教程和经验的人', tags: ['教程', '经验'], tone: '补充一句经验' },
  { title: '产品种草', text: '在对比产品、看测评的人', audience: '在对比产品、看测评的人', tags: ['测评', '怎么选'], tone: '真诚、不夸张' },
]
const tagsText = computed(() => brief.value?.tags.join('、') || '')
const excludesText = computed(() => brief.value?.excludes.join('、') || '')
const showCard = computed(() => brief.value?.status === 'ready' || brief.value?.status === 'started')

function splitWords(value: string) {
  return [...new Set(value.split(/[、，,\s]+/).map(item => item.trim()).filter(item => item.length >= 2 && item.length <= 16))].slice(0, 12)
}

function commitTags(event: Event) {
  void campaign.commitPatch({ tags: splitWords((event.target as HTMLInputElement).value) })
}

function commitExcludes(event: Event) {
  const excludes = splitWords((event.target as HTMLInputElement).value)
  void campaign.commitPatch({ excludes, excludesAsked: true })
}

function commitText(key: 'audience' | 'tone', event: Event) {
  void campaign.commitPatch({ [key]: (event.target as HTMLInputElement).value.trim() } as Partial<GrowthBrief>)
}

function commitCount(event: Event) {
  const maxCount = Math.max(1, Math.min(999, Math.floor(Number((event.target as HTMLInputElement).value) || 10)))
  void campaign.commitPatch({ maxCount })
}
</script>

<template>
  <section class="campaign-thread" aria-label="营销获客">
    <div v-if="showPicks" class="quick-picks">
      <header>
        <strong>快速选择</strong>
        <p>选一个场景，或在下面直接说投放人群。</p>
      </header>
      <div class="quick-grid">
        <button
          v-for="pick in quickPicks"
          :key="pick.title"
          type="button"
          :class="{ on: brief?.audience === pick.audience }"
          @click="campaign.applyQuickPick(pick)"
        >
          <strong>{{ pick.title }}</strong>
          <span>{{ pick.text }}</span>
        </button>
      </div>
    </div>
    <form v-if="card && showCard && brief" class="task-card" @submit.prevent="campaign.start()">
      <header>
        <strong>任务卡</strong>
        <em>{{ brief.status === 'started' ? '已启动' : '可以启动' }}</em>
      </header>
      <label>人群<input :value="brief.audience" @change="commitText('audience', $event)" /></label>
      <label>种子标签<input :value="tagsText" @change="commitTags" /></label>
      <label>排除词<input :value="excludesText" placeholder="没有就留空" @change="commitExcludes" /></label>
      <label>语气<input :value="brief.tone" @change="commitText('tone', $event)" /></label>
      <div class="card-choice">
        <span>互动</span>
        <button type="button" :class="{ on: brief.interaction !== 'comment_like' }" @click="campaign.commitPatch({ interaction: 'comment' })">只评论</button>
        <button type="button" :class="{ on: brief.interaction === 'comment_like' }" @click="campaign.commitPatch({ interaction: 'comment_like' })">评论并点赞</button>
      </div>
      <label>评论次数<input :value="brief.maxCount" type="number" min="1" max="999" @change="commitCount" /></label>
      <p class="card-files">评论形式：{{ brief.form === 'image' ? '图文' : '纯文字' }}<template v-if="campaign.imageCount"> · 配图 {{ campaign.imageCount }} 张</template><template v-if="campaign.references.length"> · 参考 {{ campaign.references.length }} 个</template></p>
      <p v-if="campaign.notice" class="card-note">{{ campaign.notice }}</p>
      <p v-if="campaign.error" class="card-error">{{ campaign.error }}</p>
      <button class="start" type="submit" :disabled="campaign.starting || brief.status === 'started' || !brief.tags.length || !brief.tone || (brief.form === 'image' && !campaign.imageCount)">
        {{ brief.status === 'started' ? '已启动' : (campaign.starting ? '正在启动…' : '启动') }}
      </button>
    </form>
    <p v-if="campaign.error && !showCard" class="card-error">{{ campaign.error }}</p>
  </section>
</template>

<style scoped>
.campaign-thread { width: min(760px, calc(100% - 28px)); margin: 0 auto; padding: 28px 0 16px; color: rgb(var(--v-theme-on-surface)); }
.quick-picks { margin-bottom: 18px; }
.quick-picks header strong { display: block; font-size: 18px; }
.quick-picks header p { margin: 6px 0 12px; color: rgba(var(--v-theme-on-surface), 0.62); font-size: 13px; }
.quick-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.quick-grid button { display: grid; gap: 4px; padding: 12px; border: 1px solid rgba(var(--v-theme-on-surface), 0.12); border-radius: 16px; background: rgba(var(--v-theme-on-surface), 0.03); color: inherit; text-align: left; cursor: pointer; }
.quick-grid button.on { border-color: rgba(var(--v-theme-on-surface), 0.4); background: rgba(var(--v-theme-on-surface), 0.08); }
.quick-grid strong { font-size: 14px; }
.quick-grid span { color: rgba(var(--v-theme-on-surface), 0.62); font-size: 12px; line-height: 1.4; }
.task-card { display: grid; gap: 10px; margin-top: 8px; padding: 14px; border: 1px solid rgba(var(--v-theme-on-surface), 0.14); border-radius: 16px; background: rgba(var(--v-theme-on-surface), 0.03); }
.task-card header { display: flex; align-items: center; justify-content: space-between; }
.task-card em { color: rgba(var(--v-theme-on-surface), 0.62); font-size: 12px; font-style: normal; }
.task-card label { display: grid; gap: 4px; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.72); }
.task-card input { width: 100%; border: 1px solid rgba(var(--v-theme-on-surface), 0.14); border-radius: 8px; background: transparent; color: inherit; padding: 8px 10px; font-size: 14px; }
.card-choice { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; }
.card-choice button, .start { border: 1px solid rgba(var(--v-theme-on-surface), 0.16); border-radius: 999px; background: transparent; color: inherit; cursor: pointer; }
.card-choice button { padding: 4px 10px; }
.card-choice button.on { background: rgba(var(--v-theme-on-surface), 0.1); }
.card-files, .card-note { margin: 0; font-size: 12px; color: rgba(var(--v-theme-on-surface), 0.62); }
.card-error { margin: 0; color: #d35b5b; font-size: 13px; }
.start { justify-self: start; padding: 8px 18px; font-weight: 700; }
.start:disabled { cursor: default; opacity: 0.45; }
</style>
