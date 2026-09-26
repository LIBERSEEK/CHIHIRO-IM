<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  ArrowRight, ArrowUpRight, Bot, Check, ChevronLeft, FileText, Image, MessageCircle,
  Paperclip, Play, Send, Sparkles, Upload, Video, X,
} from '@lucide/vue'
import { useShellStore } from '@/stores/shell'

type WorkspaceMode = 'home' | 'marketing'
type MarketingMode = 'comment' | 'publish'
type TaskStage = 'draft' | 'review' | 'running' | 'done'
type Material = { id: number; name: string; type: 'image' | 'video' | 'text'; size: string; url?: string }
type PlanStep = { label: string; detail: string; status: 'done' | 'active' | 'idle' }

const mode = ref<WorkspaceMode>('home')
const shell = useShellStore()
const marketingMode = ref<MarketingMode>('comment')
const brief = ref('')
const followUp = ref('')
const planning = ref(false)
const planReady = ref(false)
const taskStage = ref<TaskStage>('draft')
const simulationProgress = ref(0)
const simulationLogs = ref<string[]>([])
const discussion = ref<{ role: 'agent' | 'user'; text: string }[]>([])
const materials = ref<Material[]>([])
const input = ref<HTMLInputElement | null>(null)
const accountDialogOpen = ref(false)
const accountClient = ref('douyin')
let nextMaterialId = 1
let planTimer: ReturnType<typeof setTimeout> | undefined
let simulationTimer: ReturnType<typeof setInterval> | undefined

const planSteps = computed<PlanStep[]>(() => {
  const hasBrief = brief.value.trim().length > 0
  return [
    { label: '理解需求', detail: hasBrief ? '已读取你的目标与受众' : '告诉 Agent 你想要的结果', status: hasBrief ? 'done' : 'active' },
    { label: '分析素材', detail: materials.value.length ? `已接收 ${materials.value.length} 个素材` : '上传图片、视频或文字', status: materials.value.length ? 'done' : 'idle' },
    { label: '生成策略', detail: planReady.value ? '已生成可编辑方案' : '等待 Agent 讨论', status: planReady.value ? 'done' : 'idle' },
    { label: '执行交付', detail: taskStage.value === 'running' ? 'laizan 正在模拟执行' : taskStage.value === 'done' ? '模拟任务已完成' : marketingMode.value === 'comment' ? '确认后启动评论营销' : '确认后启动发布任务', status: taskStage.value === 'done' ? 'done' : taskStage.value === 'review' || taskStage.value === 'running' ? 'active' : 'idle' },
  ]
})

const generatedTags = computed(() => {
  if (marketingMode.value === 'publish') return ['品牌故事', '产品亮点', '真实体验']
  if (/餐饮|美食|餐厅/.test(brief.value)) return ['本地生活', '到店体验', '今日推荐']
  if (/教育|课程|学习/.test(brief.value)) return ['经验分享', '学习方法', '成长记录']
  return ['真实体验', '用户场景', '值得一看']
})

const generatedComments = computed(() => {
  if (marketingMode.value === 'publish') return ['已整理成适合不同平台的发布版本', '我会根据平台语气自动调整标题和正文']
  if (/价格|购买|产品|服务/.test(brief.value)) return ['这个细节很有帮助，方便说说适合什么人吗？', '看完对使用场景更清楚了，实际体验怎么样？']
  return ['这个观点很有启发，能再分享一个具体例子吗？', '信息讲得很清楚，收藏下来慢慢看。']
})

function startMarketing() {
  mode.value = 'marketing'
  if (!brief.value) brief.value = '我想围绕一组内容做有质量的获客，不要像模板广告。'
}

function openTaskReview() {
  if (!planReady.value || marketingMode.value !== 'comment') return
  taskStage.value = 'review'
}

function openAccountLauncher(preferredClient?: 'qq' | 'douyin' | Event) {
  const requested = typeof preferredClient === 'string' ? preferredClient : undefined
  accountClient.value = requested ?? (mode.value === 'marketing' ? 'douyin' : 'qq')
  accountDialogOpen.value = true
}

function selectAccountClient(id: string) {
  const client = shell.clients.find(item => item.id === id)
  if (client?.enabled) accountClient.value = id
}

async function continueAccountLogin() {
  const client = shell.clients.find(item => item.id === accountClient.value)
  if (!client?.enabled || shell.adding) return
  accountDialogOpen.value = false
  await shell.addAccount(client.id)
}

function chooseMaterials() { input.value?.click() }

function addMaterials(event: Event) {
  const files = Array.from((event.target as HTMLInputElement).files || [])
  for (const file of files) {
    const type: Material['type'] = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'text'
    materials.value.push({ id: nextMaterialId++, name: file.name, type, size: formatSize(file.size), url: type === 'image' || type === 'video' ? URL.createObjectURL(file) : undefined })
  }
  if (input.value) input.value.value = ''
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function removeMaterial(material: Material) {
  if (material.url) URL.revokeObjectURL(material.url)
  materials.value = materials.value.filter(item => item.id !== material.id)
}

function generatePlan() {
  if (!brief.value.trim() || planning.value) return
  planning.value = true
  planReady.value = false
  taskStage.value = 'draft'
  simulationProgress.value = 0
  simulationLogs.value = []
  planTimer = setTimeout(() => {
    planning.value = false
    planReady.value = true
    discussion.value = [{ role: 'agent', text: '我先按你的目标整理了一版策略。你可以继续告诉我哪些受众、语气或平台需要调整。' }]
  }, 520)
}

function simulateLaizanTask() {
  if (taskStage.value === 'running') return
  if (simulationTimer) clearInterval(simulationTimer)
  taskStage.value = 'running'
  simulationProgress.value = 8
  simulationLogs.value = ['已创建 laizan 任务草稿', '正在读取素材与视频上下文…']
  const steps = [
    { progress: 28, text: '已匹配 3 个目标标签，过滤低相关内容' },
    { progress: 52, text: '已生成上下文评论草案，等待模拟发送' },
    { progress: 76, text: '模拟观看视频 5–15 秒，准备评论' },
    { progress: 100, text: '模拟任务完成：扫描 12 条，评论 4 条' },
  ]
  let index = 0
  simulationTimer = setInterval(() => {
    const step = steps[index]
    if (!step) {
      if (simulationTimer) clearInterval(simulationTimer)
      simulationTimer = undefined
      taskStage.value = 'done'
      return
    }
    simulationProgress.value = step.progress
    simulationLogs.value.push(step.text)
    index += 1
    if (step.progress === 100 && simulationTimer) {
      clearInterval(simulationTimer)
      simulationTimer = undefined
      taskStage.value = 'done'
    }
  }, 720)
}

function askAgent() {
  const text = followUp.value.trim()
  if (!text) return
  discussion.value.push({ role: 'user', text })
  followUp.value = ''
  window.setTimeout(() => discussion.value.push({ role: 'agent', text: `收到。我会把“${text}”纳入下一版方案，并在识别每条视频上下文后调整评论。` }), 260)
}

onBeforeUnmount(() => {
  if (planTimer) clearTimeout(planTimer)
  if (simulationTimer) clearInterval(simulationTimer)
  materials.value.forEach(item => { if (item.url) URL.revokeObjectURL(item.url) })
})
</script>

<template>
  <section class="welcome-workspace" aria-label="千寻工作台">
    <aside class="welcome-sidebar">
      <div class="welcome-sidebar-head">
        <div class="welcome-mark"><Sparkles :size="16" /></div>
        <div><strong>工作台</strong><span>Agent-led workspace</span></div>
      </div>
      <nav class="welcome-nav" aria-label="工作台导航">
        <button type="button" :class="{ active: mode === 'home' }" @click="mode = 'home'"><Bot :size="16" />今天</button>
        <button type="button" :class="{ active: mode === 'marketing' }" @click="startMarketing"><ArrowUpRight :size="16" />营销获客<span class="nav-dot" /></button>
      </nav>
      <div class="welcome-sidebar-foot">
        <p>准备好开始工作了吗？</p>
        <button type="button" @click="openAccountLauncher()">添加账号 <ArrowUpRight :size="14" /></button>
      </div>
    </aside>

    <main class="welcome-main">
      <template v-if="mode === 'home'">
        <div class="welcome-home">
          <div class="welcome-kicker"><span class="kicker-line" /> CHIHIRO WORKBENCH</div>
          <h1>今天想聊点什么？</h1>
          <p class="welcome-lede">把目标交给 Agent，从一段需求开始，逐步变成可以执行的工作。</p>
          <div class="welcome-compose">
            <textarea v-model="brief" rows="3" placeholder="例如：帮我为新品视频找出适合评论互动的人群，并准备一版自然的评论策略…" @keydown.meta.enter="startMarketing" @keydown.ctrl.enter="startMarketing" />
            <div class="compose-tools"><button type="button" title="添加素材" aria-label="添加素材" @click="chooseMaterials"><Paperclip :size="16" /></button><button type="button" class="compose-submit" @click="startMarketing">开始工作 <Send :size="15" /></button></div>
          </div>
          <div class="welcome-suggestions">
            <button type="button" @click="brief = '我想做一次不打扰用户的评论营销，先帮我梳理受众和语气。'; startMarketing()">评论营销策略 <ArrowUpRight :size="14" /></button>
            <button type="button" @click="brief = '把这批素材整理成适合抖音、小红书和视频号的发布计划。'; startMarketing()">多平台发布 <ArrowUpRight :size="14" /></button>
          </div>
          <section class="welcome-cards" aria-label="工作入口">
            <article><span class="card-icon warm"><MessageCircle :size="18" /></span><div><strong>营销获客</strong><p>评论、内容和平台动作由 Agent 编排</p></div><button type="button" title="打开营销获客" aria-label="打开营销获客" @click="startMarketing"><ArrowUpRight :size="17" /></button></article>
            <article><span class="card-icon cool"><FileText :size="18" /></span><div><strong>整理一份资料</strong><p>从零散素材生成结构化内容</p></div><button type="button" title="添加资料" aria-label="添加资料" @click="chooseMaterials"><Paperclip :size="17" /></button></article>
          </section>
        </div>
      </template>

      <template v-else>
        <header class="marketing-head"><button type="button" class="back-button" title="返回工作台" aria-label="返回工作台" @click="mode = 'home'"><ChevronLeft :size="18" /></button><div><div class="welcome-kicker"><span class="kicker-line" /> GROWTH STUDIO</div><h1>营销获客</h1><p>先说清楚想要的结果，Agent 会帮你把动作编排出来。</p></div><span class="agent-badge"><Bot :size="14" /> Agent 主导</span></header>
        <div class="marketing-tabs" role="tablist" aria-label="营销工作类型"><button type="button" role="tab" :aria-selected="marketingMode === 'comment'" :class="{ active: marketingMode === 'comment' }" @click="marketingMode = 'comment'; taskStage = 'draft'"><MessageCircle :size="15" />评论营销</button><button type="button" role="tab" :aria-selected="marketingMode === 'publish'" :class="{ active: marketingMode === 'publish' }" @click="marketingMode = 'publish'; taskStage = 'draft'"><Upload :size="15" />多平台发布</button></div>
        <div class="marketing-grid">
          <section class="brief-panel"><div class="panel-heading"><div><span class="section-index">01</span><h2>任务简报</h2></div><span class="panel-state">从需求开始</span></div><textarea v-model="brief" rows="5" placeholder="你想触达谁？希望得到什么结果？有什么不能接受的表达？" /><div class="source-note"><span>可接入素材目录</span><code>social-auto-upload</code><code>laizan</code></div><div class="materials-head"><strong>本地素材</strong><button type="button" @click="chooseMaterials"><Paperclip :size="14" />添加</button></div><div v-if="materials.length" class="materials-list"><article v-for="material in materials" :key="material.id"><div v-if="material.url && material.type === 'image'" class="material-thumb"><img :src="material.url" alt="" /></div><div v-else-if="material.url && material.type === 'video'" class="material-thumb"><video :src="material.url" muted /></div><span v-else class="material-icon"><FileText :size="16" /></span><div class="material-meta"><strong>{{ material.name }}</strong><small>{{ material.size }}</small></div><button type="button" title="移除素材" aria-label="移除素材" @click="removeMaterial(material)"><X :size="14" /></button></article></div><button v-else type="button" class="upload-drop" @click="chooseMaterials"><Upload :size="18" /><span>拖入图片、视频或文字素材</span><small>文件只保留在当前任务中</small></button><input ref="input" type="file" multiple accept="image/*,video/*,.txt,.md,.pdf" hidden @change="addMaterials" /></section>
          <section class="plan-panel"><div class="panel-heading"><div><span class="section-index">02</span><h2>Agent 编排</h2></div><span class="panel-state"><span class="live-dot" /> 多轮讨论</span></div><div class="plan-steps"><div v-for="step in planSteps" :key="step.label" class="plan-step" :class="step.status"><span class="step-mark"><Check v-if="step.status === 'done'" :size="13" /><span v-else /></span><div><strong>{{ step.label }}</strong><p>{{ step.detail }}</p></div></div></div><button type="button" class="plan-button" :disabled="planning || !brief.trim()" @click="generatePlan"><Sparkles :size="16" />{{ planning ? 'Agent 正在整理…' : planReady ? '重新生成方案' : '让 Agent 生成方案' }}</button><div v-if="planReady" class="plan-result"><div class="result-title"><span>当前方案</span><small>可在执行前继续调整</small></div><div class="result-row"><b>匹配标签</b><div class="tag-list"><span v-for="tag in generatedTags" :key="tag">#{{ tag }}</span></div></div><div class="result-row"><b>{{ marketingMode === 'comment' ? '评论方向' : '发布策略' }}</b><p>{{ marketingMode === 'comment' ? '基于视频上下文生成具体评论，避免固定模板；先建立相关性，再引导互动。' : '同一组素材按平台特性拆成标题、正文和发布时间建议。' }}</p></div><div class="result-row"><b>预设示例</b><ul><li v-for="comment in generatedComments" :key="comment">{{ comment }}</li></ul></div><button v-if="marketingMode === 'comment' && taskStage === 'draft'" type="button" class="next-step-button" @click="openTaskReview">下一步：确认评论营销任务 <ArrowRight :size="15" /></button><div v-if="marketingMode === 'comment' && taskStage === 'review'" class="task-review"><div class="task-review-head"><div><strong>确认 laizan 启动内容</strong><p>下面这份参数会传给评论营销执行器。</p></div><span class="simulation-badge">前端模拟</span></div><dl class="task-spec"><div><dt>任务目标</dt><dd>{{ brief }}</dd></div><div><dt>匹配标签</dt><dd><span v-for="tag in generatedTags" :key="tag" class="spec-tag">#{{ tag }}</span></dd></div><div><dt>评论策略</dt><dd>{{ generatedComments.join(' / ') }}</dd></div><div><dt>运行策略</dt><dd>模拟观看 5–15 秒 · 最多评论 10 条 · 按视频上下文改写</dd></div><div><dt>执行账号</dt><dd class="account-missing">未添加抖音账号 <button type="button" @click="openAccountLauncher">添加账号</button></dd></div></dl><div class="task-review-actions"><button type="button" class="secondary-action" @click="taskStage = 'draft'">返回修改</button><button type="button" class="simulate-action" @click="simulateLaizanTask"><Play :size="14" />模拟启动 laizan</button></div></div><div v-if="taskStage === 'running' || taskStage === 'done'" class="task-run"><div class="task-run-head"><div><strong>{{ taskStage === 'done' ? '模拟任务已完成' : 'laizan 正在执行' }}</strong><p>{{ taskStage === 'done' ? '你可以添加账号后，使用同一份参数执行真实任务。' : '当前不触发任何平台操作，仅展示启动与运行反馈。' }}</p></div><span>{{ simulationProgress }}%</span></div><div class="progress-track"><span :style="{ width: `${simulationProgress}%` }" /></div><ol class="task-log"><li v-for="(log, index) in simulationLogs" :key="`${log}-${index}`">{{ log }}</li></ol><button v-if="taskStage === 'done'" type="button" class="account-action" @click="openAccountLauncher">添加账号后执行真实任务 <ArrowUpRight :size="14" /></button></div></div></section>
        </div>
        <section class="discussion-panel"><div class="discussion-head"><div><span class="section-index">03</span><h2>和 AstrBot 继续讨论</h2></div><span>把判断交给上下文</span></div><div class="discussion-body"><div v-if="!discussion.length" class="discussion-empty"><Bot :size="20" /><p>生成方案后，你可以继续说“语气更克制”或“只保留本地用户”，我会重新调整标签和评论。</p></div><div v-for="(message, index) in discussion" :key="index" class="discussion-message" :class="message.role"><span>{{ message.role === 'agent' ? 'A' : '你' }}</span><p>{{ message.text }}</p></div></div><form class="discussion-input" @submit.prevent="askAgent"><input v-model="followUp" :disabled="!planReady" placeholder="继续调整这份方案…" /><button type="submit" title="发送给 AstrBot" aria-label="发送给 AstrBot" :disabled="!planReady || !followUp.trim()"><Send :size="15" /></button></form></section>
      </template>
    </main>
    <div v-if="accountDialogOpen" class="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title" @click.self="accountDialogOpen = false">
      <section class="account-dialog-card">
        <header>
          <div><span class="section-index">ACCOUNT</span><h2 id="account-dialog-title">添加工作账号</h2></div>
          <button type="button" title="关闭" aria-label="关闭" @click="accountDialogOpen = false"><X :size="16" /></button>
        </header>
        <p>选择要连接的平台。评论营销需要抖音账号；QQ 用于消息和客户会话。</p>
        <div class="account-client-list" role="radiogroup" aria-label="选择账号平台">
          <button v-for="client in shell.clients" :key="client.id" type="button" role="radio"
            :aria-checked="client.id === accountClient" :disabled="!client.enabled"
            :class="{ selected: client.id === accountClient }" @click="selectAccountClient(client.id)">
            <span class="account-client-badge">{{ client.badge }}</span>
            <span class="account-client-copy"><strong>{{ client.name }}</strong><small>{{ client.hint || (client.enabled ? '连接该平台账号' : '即将支持') }}</small></span>
            <Check v-if="client.id === accountClient" :size="16" />
            <span v-else-if="!client.enabled" class="client-soon">即将支持</span>
          </button>
        </div>
        <footer>
          <button type="button" class="secondary-action" @click="accountDialogOpen = false">取消</button>
          <button type="button" class="account-continue" :disabled="shell.adding || !shell.clients.find(item => item.id === accountClient)?.enabled" @click="continueAccountLogin">
            <span v-if="shell.adding" class="account-loading" />
            {{ shell.adding ? '正在准备…' : `继续登录 ${shell.clients.find(item => item.id === accountClient)?.name || ''}` }}
            <ArrowRight v-if="!shell.adding" :size="15" />
          </button>
        </footer>
      </section>
    </div>
  </section>
</template>

<style scoped>
.welcome-workspace { display:grid; grid-template-columns:238px minmax(0,1fr); width:100%; height:100%; min-height:0; color:#e9e8e3; background:#111210; }
.welcome-sidebar { display:flex; min-width:0; flex-direction:column; padding:25px 16px 18px; border-right:1px solid #2b2d28; background:#171914; }
.welcome-sidebar-head { display:flex; align-items:center; gap:10px; padding:0 8px 32px; }
.welcome-mark { display:grid; width:30px; height:30px; place-items:center; border-radius:8px; color:#111210; background:#d8e890; }
.welcome-sidebar-head strong,.welcome-sidebar-head span { display:block; }.welcome-sidebar-head strong { font-size:14px; letter-spacing:.02em; }.welcome-sidebar-head span { margin-top:2px; color:#777c72; font-size:10px; letter-spacing:.04em; }
.welcome-nav { display:grid; gap:5px; }.welcome-nav button { display:flex; align-items:center; gap:10px; width:100%; padding:10px 11px; border:1px solid transparent; border-radius:7px; color:#959b8f; background:transparent; cursor:pointer; text-align:left; font-size:13px; }.welcome-nav button:hover,.welcome-nav button.active { color:#f0f0e8; background:#252921; }.welcome-nav button.active { border-color:#353b2d; }.nav-dot { width:5px; height:5px; margin-left:auto; border-radius:50%; background:#e6ba63; }
.welcome-sidebar-foot { margin-top:auto; padding:14px 9px 0; border-top:1px solid #2b2d28; }.welcome-sidebar-foot p { margin:0 0 10px; color:#797f73; font-size:11px; line-height:1.5; }.welcome-sidebar-foot button { display:inline-flex; align-items:center; gap:6px; padding:0; border:0; color:#d8e890; background:transparent; cursor:pointer; font-size:12px; }
.welcome-main { min-width:0; min-height:0; overflow:auto; background:radial-gradient(circle at 78% 0%, #24281d 0, transparent 38%), #111210; }.welcome-home { width:min(840px,calc(100% - 88px)); margin:0 auto; padding:clamp(56px,10vh,116px) 0 60px; }.welcome-kicker { display:flex; align-items:center; gap:9px; color:#96a378; font-size:10px; font-weight:700; letter-spacing:.19em; }.kicker-line { display:inline-block; width:24px; height:1px; background:#a7b86f; }.welcome-home h1,.marketing-head h1 { margin:19px 0 12px; color:#f2f1ea; font-family:Georgia,serif; font-size:clamp(36px,5vw,60px); font-weight:400; letter-spacing:-.02em; }.welcome-lede { max-width:500px; margin:0; color:#989c91; font-size:15px; line-height:1.7; }.welcome-compose { margin-top:36px; border:1px solid #363a2f; border-radius:12px; background:#1b1e18; box-shadow:0 18px 50px #08090680; }.welcome-compose textarea,.brief-panel textarea { display:block; width:100%; resize:vertical; border:0; outline:0; color:#ebede3; background:transparent; font:inherit; line-height:1.7; }.welcome-compose textarea { min-height:98px; padding:17px 18px; }.welcome-compose textarea::placeholder,.brief-panel textarea::placeholder { color:#666c62; }.compose-tools { display:flex; justify-content:space-between; padding:9px 10px; border-top:1px solid #30342b; }.compose-tools button,.discussion-input button { display:grid; width:30px; height:30px; place-items:center; border:0; border-radius:7px; color:#9da490; background:transparent; cursor:pointer; }.compose-tools button:hover,.discussion-input button:hover { color:#e7efc1; background:#2a3024; }.compose-tools .compose-submit { display:inline-flex; width:auto; align-items:center; gap:7px; padding:0 12px; color:#12140f; background:#d8e890; font-size:12px; font-weight:700; }.compose-tools .compose-submit:hover { color:#12140f; background:#edf6af; }.welcome-suggestions { display:flex; flex-wrap:wrap; gap:8px; margin-top:13px; }.welcome-suggestions button { display:inline-flex; align-items:center; gap:6px; padding:7px 10px; border:1px solid #30352c; border-radius:999px; color:#989e90; background:#181b16; cursor:pointer; font-size:11px; }.welcome-suggestions button:hover { color:#e3e9c4; border-color:#606c46; }.welcome-cards { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; margin-top:62px; }.welcome-cards article { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:12px; padding:15px; border:1px solid #2d3129; border-radius:9px; background:#181b16; }.card-icon { display:grid; width:32px; height:32px; place-items:center; border-radius:8px; }.card-icon.warm { color:#d9af68; background:#3b3020; }.card-icon.cool { color:#a8bd8d; background:#263325; }.welcome-cards strong { font-size:13px; font-weight:650; }.welcome-cards p { margin:4px 0 0; color:#7f8579; font-size:11px; }.welcome-cards article>button { display:grid; width:28px; height:28px; place-items:center; border:0; border-radius:6px; color:#888f80; background:transparent; cursor:pointer; }.welcome-cards article>button:hover { color:#e3ebc1; background:#292e24; }
.marketing-head { display:flex; align-items:flex-start; gap:14px; width:min(1060px,calc(100% - 72px)); margin:0 auto; padding:42px 0 22px; }.back-button { display:grid; width:32px; height:32px; margin-top:4px; place-items:center; border:1px solid #34392e; border-radius:7px; color:#a5aa9a; background:#191c17; cursor:pointer; }.back-button:hover { color:#eef3d6; background:#272d22; }.marketing-head h1 { margin:12px 0 5px; font-size:36px; }.marketing-head p { margin:0; color:#888e82; font-size:13px; }.agent-badge { display:inline-flex; align-items:center; gap:6px; margin-left:auto; padding:7px 10px; border:1px solid #4b5734; border-radius:999px; color:#c3d28e; background:#283021; font-size:11px; white-space:nowrap; }.marketing-tabs { display:flex; gap:4px; width:min(1060px,calc(100% - 72px)); margin:0 auto 18px; padding-bottom:1px; border-bottom:1px solid #2b3029; }.marketing-tabs button { display:inline-flex; align-items:center; gap:7px; padding:10px 12px; border:0; border-bottom:2px solid transparent; color:#858b80; background:transparent; cursor:pointer; font-size:12px; }.marketing-tabs button.active { border-bottom-color:#d8e890; color:#e4edc2; }.marketing-grid { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px; width:min(1060px,calc(100% - 72px)); margin:0 auto; }.brief-panel,.plan-panel,.discussion-panel { border:1px solid #30352d; border-radius:10px; background:#181b16; }.brief-panel,.plan-panel { min-height:360px; padding:18px; }.panel-heading,.discussion-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }.panel-heading>div,.discussion-head>div { display:flex; align-items:center; gap:9px; }.section-index { color:#76815f; font-size:10px; font-weight:700; letter-spacing:.12em; }.panel-heading h2,.discussion-head h2 { margin:0; color:#e8eadf; font-size:14px; font-weight:650; }.panel-state,.discussion-head>span { color:#7d8478; font-size:10px; }.brief-panel textarea { min-height:124px; margin-top:20px; padding:12px 0; border-top:1px solid #2d322a; border-bottom:1px solid #2d322a; font-size:13px; }.source-note { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-top:14px; color:#6f766b; font-size:10px; }.source-note code { padding:3px 6px; border:1px solid #343b2e; border-radius:4px; color:#a9b986; background:#20251b; font-family:ui-monospace,monospace; }.materials-head { display:flex; align-items:center; justify-content:space-between; margin-top:20px; color:#afb5a5; font-size:12px; }.materials-head button { display:inline-flex; align-items:center; gap:5px; padding:4px 7px; border:0; border-radius:5px; color:#bdcc8d; background:transparent; cursor:pointer; font-size:11px; }.materials-head button:hover { background:#283023; }.upload-drop { display:grid; width:100%; place-items:center; gap:5px; min-height:92px; margin-top:10px; border:1px dashed #4a543b; border-radius:7px; color:#939b8a; background:#1b2018; cursor:pointer; font-size:11px; }.upload-drop svg { color:#b1c87c; }.upload-drop small { color:#656d61; font-size:10px; }.materials-list { display:grid; gap:6px; margin-top:10px; }.materials-list article { display:flex; align-items:center; gap:8px; min-width:0; padding:7px; border:1px solid #30372c; border-radius:6px; background:#1d221a; }.material-thumb,.material-icon { display:grid; width:30px; height:30px; flex:0 0 30px; place-items:center; overflow:hidden; border-radius:4px; color:#9aae76; background:#2c3525; }.material-thumb img,.material-thumb video { width:100%; height:100%; object-fit:cover; }.material-meta { min-width:0; flex:1; }.material-meta strong,.material-meta small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.material-meta strong { color:#d8ddce; font-size:11px; }.material-meta small { margin-top:2px; color:#737b6f; font-size:10px; }.materials-list article>button { display:grid; width:24px; height:24px; place-items:center; border:0; border-radius:4px; color:#737c6f; background:transparent; cursor:pointer; }.materials-list article>button:hover { color:#ea8776; background:#38241f; }.plan-steps { display:grid; gap:15px; margin:25px 0 20px; }.plan-step { display:flex; align-items:flex-start; gap:10px; }.step-mark { display:grid; width:20px; height:20px; flex:0 0 20px; place-items:center; border:1px solid #41483b; border-radius:50%; color:#162014; background:transparent; }.plan-step.done .step-mark { border-color:#c4db7a; background:#c4db7a; }.plan-step.active .step-mark { border-color:#c4db7a; box-shadow:0 0 0 4px #c4db7a18; }.plan-step.active .step-mark span { width:6px; height:6px; border-radius:50%; background:#c4db7a; }.plan-step strong { display:block; color:#cfd4c5; font-size:12px; }.plan-step p { margin:3px 0 0; color:#737b70; font-size:11px; }.plan-button { display:inline-flex; width:100%; height:38px; align-items:center; justify-content:center; gap:7px; border:1px solid #c8dd7f; border-radius:6px; color:#172011; background:#d8e890; cursor:pointer; font-size:12px; font-weight:700; }.plan-button:hover { background:#ebf5ae; }.plan-button:disabled { cursor:default; opacity:.55; }.plan-result { display:grid; gap:12px; margin-top:18px; padding-top:14px; border-top:1px solid #30362c; }.result-title { display:flex; justify-content:space-between; color:#dce7ad; font-size:11px; }.result-title small { color:#737b6c; }.result-row { display:grid; grid-template-columns:70px 1fr; gap:10px; color:#adb5a1; font-size:11px; line-height:1.6; }.result-row b { color:#838e73; font-size:10px; font-weight:600; }.result-row p,.result-row ul { margin:0; padding:0; }.result-row ul { list-style:none; }.tag-list { display:flex; flex-wrap:wrap; gap:5px; }.tag-list span { padding:3px 6px; border-radius:4px; color:#c4d88b; background:#293322; }.live-dot { display:inline-block; width:6px; height:6px; margin-right:4px; border-radius:50%; background:#b7d66c; box-shadow:0 0 0 3px #b7d66c18; }.discussion-panel { width:min(1060px,calc(100% - 72px)); margin:14px auto 40px; padding:18px; }.discussion-body { min-height:82px; max-height:180px; overflow:auto; margin-top:16px; padding:12px; border:1px solid #2b3229; border-radius:7px; background:#151812; }.discussion-empty { display:flex; align-items:flex-start; gap:8px; color:#70786b; }.discussion-empty svg { flex:0 0 auto; color:#b9cf7f; }.discussion-empty p { margin:0; font-size:11px; line-height:1.6; }.discussion-message { display:flex; align-items:flex-start; gap:8px; margin-bottom:10px; }.discussion-message:last-child { margin-bottom:0; }.discussion-message>span { display:grid; width:20px; height:20px; flex:0 0 20px; place-items:center; border-radius:50%; color:#192014; background:#c9df80; font-size:10px; font-weight:700; }.discussion-message.user>span { color:#dedfd5; background:#4b5245; }.discussion-message p { margin:0; color:#bbc2b1; font-size:11px; line-height:1.55; }.discussion-input { display:flex; gap:8px; margin-top:10px; }.discussion-input input { min-width:0; flex:1; height:34px; padding:0 10px; border:1px solid #343b30; border-radius:6px; outline:0; color:#dfe3d5; background:#151812; font:inherit; font-size:11px; }.discussion-input button { border:1px solid #39432f; }.discussion-input button:disabled { cursor:default; opacity:.4; }
.next-step-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; width:100%; margin-top:4px; padding:10px 12px; border:1px solid #c8dd7f; border-radius:6px; color:#172011; background:#d8e890; cursor:pointer; font-size:12px; font-weight:700; }
.next-step-button:hover { background:#ebf5ae; }
.task-review,.task-run { display:grid; gap:12px; margin-top:12px; padding:13px; border:1px solid #4c5b36; border-radius:7px; background:#20281a; }
.task-review-head,.task-run-head { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
.task-review-head strong,.task-run-head strong { color:#e3edbf; font-size:12px; }
.task-review-head p,.task-run-head p { margin:4px 0 0; color:#8e9883; font-size:10px; line-height:1.5; }
.simulation-badge { padding:3px 6px; border:1px solid #677c45; border-radius:4px; color:#cce693; font-size:9px; white-space:nowrap; }
.task-spec { display:grid; gap:8px; margin:0; padding-top:10px; border-top:1px solid #3a4730; }
.task-spec>div { display:grid; grid-template-columns:70px 1fr; gap:8px; color:#bfc9b3; font-size:10px; line-height:1.5; }
.task-spec dt { color:#7d896f; }.task-spec dd { margin:0; }
.spec-tag { display:inline-block; margin:0 4px 3px 0; padding:2px 5px; border-radius:3px; color:#cde694; background:#334225; }
.account-missing { color:#e3b76f !important; }
.account-missing button,.account-action { display:inline-flex; align-items:center; gap:4px; width:max-content; padding:0; border:0; color:#d8e890; background:transparent; cursor:pointer; font-size:10px; text-decoration:underline; }
.task-review-actions { display:flex; justify-content:flex-end; gap:7px; }
.secondary-action,.simulate-action { display:inline-flex; align-items:center; gap:6px; padding:7px 9px; border-radius:5px; cursor:pointer; font-size:10px; }
.secondary-action { border:1px solid #46513a; color:#aab49e; background:transparent; }
.simulate-action { border:1px solid #c8dd7f; color:#182111; background:#d8e890; font-weight:700; }
.simulate-action:hover { background:#ebf5ae; }
.task-run-head>span { color:#d8e890; font-size:15px; font-variant-numeric:tabular-nums; }
.progress-track { height:6px; overflow:hidden; border-radius:99px; background:#39462e; }
.progress-track span { display:block; height:100%; border-radius:inherit; background:#d8e890; transition:width .35s ease; }
.task-log { display:grid; gap:4px; max-height:105px; overflow:auto; margin:0; padding:0 0 0 17px; color:#afbca0; font-size:10px; line-height:1.5; }
.account-action { margin-top:2px; }
.account-dialog { position:fixed; z-index:20; inset:0; display:grid; place-items:center; padding:20px; background:rgba(5,7,4,.72); backdrop-filter:blur(10px); }
.account-dialog-card { width:min(450px,100%); padding:20px; border:1px solid #3d4735; border-radius:10px; color:#e9eee1; background:#1a1e18; box-shadow:0 24px 70px rgba(0,0,0,.48); }
.account-dialog-card header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }.account-dialog-card header h2 { margin:7px 0 0; font-size:18px; font-weight:650; }.account-dialog-card header button { display:grid; width:28px; height:28px; place-items:center; border:0; border-radius:6px; color:#9ca58f; background:transparent; cursor:pointer; }.account-dialog-card header button:hover { color:#edf4d9; background:#293024; }.account-dialog-card>p { margin:14px 0 16px; color:#8b9582; font-size:12px; line-height:1.6; }
.account-client-list { display:grid; gap:7px; }.account-client-list>button { display:flex; align-items:center; gap:10px; width:100%; padding:10px; border:1px solid #333c2e; border-radius:7px; color:#adb7a2; background:#171a15; cursor:pointer; text-align:left; }.account-client-list>button:hover,.account-client-list>button.selected { border-color:#a9c86d; color:#ebf1dc; background:#263020; }.account-client-list>button:disabled { cursor:default; opacity:.46; }.account-client-badge { display:grid; width:30px; height:30px; flex:0 0 30px; place-items:center; border-radius:6px; color:#172011; background:#cfe68a; font-size:10px; font-weight:750; }.account-client-copy { min-width:0; flex:1; }.account-client-copy strong,.account-client-copy small { display:block; }.account-client-copy strong { font-size:12px; }.account-client-copy small { margin-top:3px; overflow:hidden; color:#7f8976; font-size:10px; text-overflow:ellipsis; white-space:nowrap; }.account-client-list>button.selected svg { color:#d8e890; }.client-soon { color:#778070; font-size:10px; }
.account-dialog-card footer { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }.account-continue { display:inline-flex; align-items:center; gap:6px; padding:9px 12px; border:1px solid #c8dd7f; border-radius:6px; color:#172011; background:#d8e890; cursor:pointer; font-size:11px; font-weight:700; }.account-continue:hover { background:#ebf5ae; }.account-continue:disabled { cursor:default; opacity:.55; }.account-loading { width:13px; height:13px; border:2px solid rgba(23,32,17,.25); border-top-color:#172011; border-radius:50%; animation:account-spin .7s linear infinite; }@keyframes account-spin { to { transform:rotate(1turn); } }
@media (max-width: 800px) { .welcome-workspace { grid-template-columns:190px minmax(0,1fr); }.welcome-sidebar { padding-left:10px; padding-right:10px; }.welcome-home,.marketing-head,.marketing-tabs,.marketing-grid,.discussion-panel { width:calc(100% - 32px); }.welcome-cards,.marketing-grid { grid-template-columns:1fr; }.marketing-head { flex-wrap:wrap; }.agent-badge { margin-left:46px; } }
@media (max-width: 560px) { .welcome-workspace { display:block; overflow:auto; }.welcome-sidebar { display:flex; min-height:auto; padding:12px 14px; border-right:0; border-bottom:1px solid #2b2d28; }.welcome-sidebar-head { padding:0; }.welcome-nav { display:flex; margin-top:12px; }.welcome-nav button { width:auto; padding:7px 9px; }.welcome-sidebar-foot { display:none; }.welcome-main { min-height:calc(100% - 79px); }.welcome-home { width:calc(100% - 28px); padding-top:44px; }.welcome-home h1 { font-size:38px; }.marketing-head { padding-top:26px; }.marketing-head h1 { font-size:30px; }.marketing-tabs,.marketing-grid,.discussion-panel { width:calc(100% - 28px); }.brief-panel,.plan-panel { min-height:0; } }
</style>
