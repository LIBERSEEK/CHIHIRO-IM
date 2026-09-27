<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { accountId } from '@/contracts'
import { useShellStore } from '@/stores/shell'
import { useWorkspace } from '@/modules/workspace/workspace'
import { COMMENT_IMAGE_COPY, commentModelOptions, libraryImageIds, shouldAdoptChatImages, type CardImageSource, type CommentModelOption, type SchemaCard, type SchemaField } from './schema-card'

const props = defineProps<{ card: SchemaCard, sources?: CardImageSource[] }>()

const shell = useShellStore()
const workspace = useWorkspace()
const router = useRouter()
const value = ref<Record<string, unknown>>({ ...props.card.value })
const imageIds = ref<string[]>(libraryImageIds(props.card.value?.commentImageIds))
const serverStatus = ref(props.card.status === 'started' ? 'started' : 'ready')
const hydrating = ref(true)
const adopting = ref(false)
const starting = ref(false)
const error = ref('')
const notice = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const models = ref<CommentModelOption[]>([])
let awaitingLogin = false
let sawLogin = false
let loginRetries = 0

const copy = COMMENT_IMAGE_COPY
const imageKey = `chihiro.card.images.${props.card.draftId}`

watch(() => props.card.draftId, () => {
  value.value = { ...props.card.value }
  imageIds.value = libraryImageIds(props.card.value?.commentImageIds)
  serverStatus.value = props.card.status === 'started' ? 'started' : 'ready'
  void hydrate()
})

const fields = computed(() => (props.card.schema?.fields || []).filter((field) => field.key !== 'goal'))
const textFields = computed(() => fields.value.filter((field) => field.type !== 'enum' && field.key !== 'maxCount'))
const interactionField = computed(() => fields.value.find((field) => field.key === 'interaction'))
const countField = computed(() => fields.value.find((field) => field.key === 'maxCount'))
const formField = computed(() => fields.value.find((field) => field.key === 'form'))
const platformField = computed(() => fields.value.find((field) => field.key === 'platform') || {
  key: 'platform',
  label: '平台',
  type: 'enum' as const,
  options: [
    { value: 'douyin', label: '抖音' },
    { value: 'xiaohongshu', label: '小红书' },
    { value: 'bilibili', label: '哔哩哔哩' },
  ],
})
const cardPlatform = computed(() => value.value.platform === 'xiaohongshu' || value.value.platform === 'bilibili' ? value.value.platform : 'douyin')
const startAction = computed(() => props.card.actions?.find((action) => action.id === 'start') || null)
const locked = computed(() => serverStatus.value === 'started' || !startAction.value)
const showImages = computed(() => value.value.form === 'image')
const needsImage = computed(() => showImages.value && imageIds.value.length === 0)

function wordsText(key: string) {
  const list = value.value[key]
  return Array.isArray(list) ? list.join('、') : ''
}

function fieldText(field: SchemaField) {
  return String(value.value[field.key] ?? '')
}

function splitWords(text: string) {
  return [...new Set(text.split(/[、，,\s]+/).map((item) => item.trim()).filter((item) => item.length >= 2 && item.length <= 16))].slice(0, 12)
}

function commitText(field: SchemaField, event: Event) {
  value.value = { ...value.value, [field.key]: (event.target as HTMLInputElement).value.trim() }
  void save()
}

function commitWords(field: SchemaField, event: Event) {
  value.value = { ...value.value, [field.key]: splitWords((event.target as HTMLInputElement).value) }
  void save()
}

function commitNumber(field: SchemaField, event: Event) {
  const count = Math.max(field.min || 1, Math.min(field.max || 999, Math.floor(Number((event.target as HTMLInputElement).value) || 10)))
  value.value = { ...value.value, [field.key]: count }
  void save()
}

async function choose(field: SchemaField, option: string) {
  if (locked.value) return
  value.value = { ...value.value, [field.key]: option }
  if (field.key === 'form' && option === 'image') await adoptSources()
  await save()
}

function chooseEnum(field: SchemaField, event: Event) {
  void choose(field, (event.target as HTMLSelectElement).value)
}

const modelOptions = computed(() => {
  const options = [...models.value]
  const provider = String(value.value.commentProvider || '')
  const model = String(value.value.commentModel || '')
  if (provider && !options.some((item) => item.provider === provider)) {
    options.unshift({ provider, model: model || provider, label: model || provider })
  }
  return options
})

async function loadModels() {
  try {
    const response = await fetch('/astrbot/api/v1/providers?capability=chat&enabled=true', { cache: 'no-store' })
    if (!response.ok) return
    models.value = commentModelOptions(await response.json())
  } catch {
    models.value = []
  }
}

function chooseModel(event: Event) {
  if (locked.value) return
  const provider = (event.target as HTMLSelectElement).value
  const picked = modelOptions.value.find((item) => item.provider === provider)
  value.value = {
    ...value.value,
    commentProvider: provider,
    commentModel: picked?.model || '',
  }
  void save()
}

function imageUrl(id: string) {
  return `/api/runtime/library/${encodeURIComponent(id)}/file`
}

function rememberImages() {
  localStorage.setItem(imageKey, 'kept')
}

function rememberedImages() {
  return localStorage.getItem(imageKey) === 'kept'
}

async function hydrate() {
  hydrating.value = true
  try {
    const response = await fetch(`/api/runtime/outreach/brief?id=${encodeURIComponent(props.card.draftId)}`, { cache: 'no-store' })
    if (!response.ok) return
    const body = await response.json().catch(() => ({})) as { brief?: Record<string, unknown> }
    const brief = body.brief
    if (!brief || brief.id !== props.card.draftId) return
    serverStatus.value = brief.status === 'started' ? 'started' : 'ready'
    imageIds.value = libraryImageIds(brief.commentImageIds)
    value.value = {
      ...value.value,
      audience: brief.audience ?? value.value.audience,
      tags: brief.tags ?? value.value.tags,
      excludes: brief.excludes ?? value.value.excludes,
      tone: brief.tone ?? value.value.tone,
      interaction: brief.interaction ?? value.value.interaction,
      maxCount: brief.maxCount ?? value.value.maxCount,
      form: brief.form === 'image' || brief.form === 'text' ? brief.form : value.value.form,
      commentImageIds: imageIds.value,
      commentProvider: typeof brief.commentProvider === 'string' ? brief.commentProvider : value.value.commentProvider,
      commentModel: typeof brief.commentModel === 'string' ? brief.commentModel : value.value.commentModel,
      platform: brief.platform === 'xiaohongshu' || brief.platform === 'bilibili' || brief.platform === 'douyin'
        ? brief.platform
        : (value.value.platform === 'xiaohongshu' || value.value.platform === 'bilibili' ? value.value.platform : 'douyin'),
    }
  } finally {
    hydrating.value = false
  }
  if (showImages.value) await adoptSources()
}

async function adoptSources() {
  if (!shouldAdoptChatImages({
    form: String(value.value.form || ''),
    ids: imageIds.value,
    locked: locked.value,
    remembered: rememberedImages(),
    sourceCount: props.sources?.length || 0,
  })) return
  adopting.value = true
  error.value = ''
  try {
    const ids: string[] = []
    for (const source of props.sources || []) {
      const id = await uploadSource(source)
      if (id) ids.push(id)
    }
    imageIds.value = libraryImageIds(ids)
    value.value = { ...value.value, commentImageIds: imageIds.value }
    rememberImages()
    if (!imageIds.value.length) error.value = '图片没有放上卡片，可以再添加一张。'
    else await save()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '图片没有放上卡片，可以再添加一张。'
  } finally {
    adopting.value = false
  }
}

async function uploadSource(source: CardImageSource) {
  const response = await fetch(source.url)
  if (!response.ok) return ''
  const blob = await response.blob()
  return uploadBlob(blob, source.name || '配图')
}

async function uploadBlob(blob: Blob, name: string) {
  const mime = blob.type || guessMime(name)
  if (!mime.startsWith('image/')) return ''
  const dataBase64 = await blobToBase64(blob)
  const response = await fetch('/api/runtime/library', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mime, dataBase64 }),
  })
  const body = await response.json().catch(() => ({})) as { item?: { id?: string }, message?: string }
  if (!response.ok || !body.item?.id) throw new Error(body.message || '图片没有放上卡片')
  return body.item.id
}

function guessMime(name: string) {
  const lower = name.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      resolve(text.slice(text.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function addImages(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files || [])]
  input.value = ''
  if (!files.length || locked.value) return
  adopting.value = true
  error.value = ''
  try {
    const ids = [...imageIds.value]
    for (const file of files) {
      const id = await uploadBlob(file, file.name || '配图')
      if (id) ids.push(id)
    }
    imageIds.value = libraryImageIds(ids)
    value.value = { ...value.value, form: 'image', commentImageIds: imageIds.value }
    rememberImages()
    await save()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '图片没有放上卡片'
  } finally {
    adopting.value = false
  }
}

function removeImage(id: string) {
  if (locked.value) return
  imageIds.value = imageIds.value.filter((item) => item !== id)
  value.value = { ...value.value, commentImageIds: imageIds.value }
  rememberImages()
  void save()
}

async function save() {
  if (locked.value || hydrating.value) return
  error.value = ''
  const response = await fetch('/api/runtime/outreach/brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brief: {
        id: props.card.draftId,
        status: 'ready',
        ...value.value,
        commentImageIds: imageIds.value,
        excludesAsked: true,
      },
    }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string }
    error.value = body.message || '没有保存这次修改'
  }
}

function missingRequired() {
  return fields.value.some((field) => {
    if (!field.required) return false
    const current = value.value[field.key]
    if (field.type === 'words') return !Array.isArray(current) || !current.length
    return !String(current || '').trim()
  })
}

async function start() {
  const action = startAction.value
  if (!action || starting.value || locked.value || needsImage.value) return
  if (!action.path.startsWith('/api/runtime/outreach/')) {
    error.value = '这张卡片没有可执行的启动动作'
    return
  }
  starting.value = true
  error.value = ''
  try {
    const response = await fetch(action.path, {
      method: action.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: props.card.draftId,
        ...value.value,
        commentImageIds: imageIds.value,
        platform: cardPlatform.value,
        accountId: shell.activeAccount?.platform === cardPlatform.value ? shell.activeAccount.id : '',
      }),
    })
    const body = await response.json().catch(() => ({})) as { needsLogin?: boolean; started?: boolean; accountId?: string; message?: string }
    if (body.needsLogin) {
      if (sawLogin) {
        awaitingLogin = false
        sawLogin = false
        notice.value = '登录还没完成，任务卡留在这里。'
        return
      }
      awaitingLogin = true
      sawLogin = false
      const platformName = cardPlatform.value === 'xiaohongshu' ? '小红书' : cardPlatform.value === 'bilibili' ? '哔哩哔哩' : '抖音'
      notice.value = `登录${platformName}后会自动开始。取消登录的话，任务卡留在这里。`
      if (body.accountId) await shell.reloginAccount(accountId(body.accountId))
      else await shell.addAccount(cardPlatform.value)
      return
    }
    if (!response.ok || !body.started) throw new Error(body.message || '没有启动')
    awaitingLogin = false
    sawLogin = false
    loginRetries = 0
    notice.value = ''
    if (body.accountId) shell.selectAccount(accountId(body.accountId))
    workspace.outreachChatRequest = true
    workspace.selectList('messages')
    workspace.mobilePane = 'chat'
    void router.replace({ path: '/im' })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '没有启动'
  } finally {
    starting.value = false
  }
}

watch(
  () => `${shell.runtimePhase}|${shell.pendingAdd}|${shell.accounts.map((account) => `${account.id}:${account.status}`).join(',')}`,
  async () => {
    if (!awaitingLogin || starting.value) return
    const logging = shell.pendingAdd || shell.runtimePhase === 'browser_setup' || shell.runtimePhase === 'logging_in' || shell.runtimePhase === 'cancelling'
    if (logging) {
      sawLogin = true
      return
    }
    if (!sawLogin) return
    const online = shell.accounts.some((account) => account.platform === cardPlatform.value && account.status === 'online')
    if (!online) {
      awaitingLogin = false
      sawLogin = false
      notice.value = '登录已取消，任务卡留在这里。'
      return
    }
    if (loginRetries >= 1) {
      awaitingLogin = false
      sawLogin = false
      notice.value = '登录还没完成，任务卡留在这里。'
      return
    }
    loginRetries += 1
    sawLogin = false
    awaitingLogin = false
    notice.value = ''
    await start()
  },
)

onMounted(() => {
  void hydrate()
  void loadModels()
})
</script>

<template>
  <form class="schema-card" @submit.prevent="start">
    <header>
      <strong>{{ card.title || card.schema.title || '任务卡' }}</strong>
      <em>{{ locked ? '已启动' : '可以启动' }}</em>
    </header>
    <div class="schema-fields">
      <label v-for="field in textFields" :key="field.key">
        {{ field.label }}
        <input
          v-if="field.type === 'words'"
          :value="wordsText(field.key)"
          :placeholder="field.placeholder"
          :disabled="locked || hydrating"
          @change="commitWords(field, $event)"
        />
        <input
          v-else
          :value="fieldText(field)"
          :placeholder="field.placeholder"
          :disabled="locked || hydrating"
          @change="commitText(field, $event)"
        />
      </label>
    </div>
    <div class="schema-controls">
      <label class="schema-platform">
        {{ platformField.label }}
        <span class="schema-select">
          <select :value="cardPlatform" :disabled="locked || hydrating" @change="chooseEnum(platformField, $event)">
            <option v-for="option in platformField.options || []" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </span>
      </label>
      <label v-if="interactionField">
        {{ interactionField.label }}
        <span class="schema-select">
          <select :value="String(value.interaction || '')" :disabled="locked || hydrating" @change="chooseEnum(interactionField, $event)">
            <option v-for="option in interactionField.options || []" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </span>
      </label>
      <label v-if="countField">
        {{ countField.label }}
        <input
          type="number"
          :min="countField.min || 1"
          :max="countField.max || 999"
          :value="fieldText(countField)"
          :disabled="locked || hydrating"
          @change="commitNumber(countField, $event)"
        />
      </label>
      <label v-if="formField">
        {{ formField.label }}
        <span class="schema-select">
          <select :value="String(value.form || '')" :disabled="locked || hydrating" @change="chooseEnum(formField, $event)">
            <option v-for="option in formField.options || []" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </span>
      </label>
      <label class="schema-model" title="这条任务的评论交给这个模型写。">
        模型
        <span class="schema-select">
          <select :value="String(value.commentProvider || '')" :disabled="locked || hydrating" @focus="loadModels" @change="chooseModel">
            <option value="">跟随默认</option>
            <option v-for="item in modelOptions" :key="item.provider" :value="item.provider">{{ item.label }}</option>
          </select>
        </span>
      </label>
    </div>
    <section v-if="showImages" class="schema-images">
      <span>配图</span>
      <div class="schema-image-line">
        <figure v-for="id in imageIds" :key="id">
          <img :src="imageUrl(id)" :alt="copy.title" />
          <button v-if="!locked" type="button" :aria-label="copy.remove" @click="removeImage(id)">×</button>
        </figure>
        <button v-if="!locked" class="schema-image-add" type="button" @click="fileInput?.click()">{{ copy.add }}</button>
      </div>
      <input ref="fileInput" class="schema-image-file" type="file" accept="image/jpeg,image/png,image/gif,image/webp" multiple @change="addImages" />
    </section>
    <p v-if="adopting" class="schema-note">{{ copy.adding }}</p>
    <p v-else-if="showImages && !imageIds.length" class="schema-note">{{ copy.empty }}</p>
    <p v-if="notice" class="schema-note">{{ notice }}</p>
    <p v-if="error" class="schema-error">{{ error }}</p>
    <button
      v-if="startAction && serverStatus !== 'started'"
      class="schema-start"
      type="submit"
      :disabled="starting || hydrating || missingRequired() || needsImage"
    >
      {{ starting ? '正在启动…' : startAction.label }}
    </button>
  </form>
</template>

<style scoped>
.schema-card {
  display: grid;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 14px;
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.schema-card header { display: flex; justify-content: space-between; align-items: center; }
.schema-card header strong { font-size: 14px; }
.schema-card header em { color: rgba(var(--v-theme-on-surface), 0.62); font-style: normal; font-size: 12px; }
.schema-fields {
  display: grid;
  gap: 6px;
}
.schema-card label { display: grid; gap: 3px; font-size: 12px; }
.schema-card input,
.schema-card select {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  color-scheme: dark;
  font-size: 13px;
}
.schema-card input[type='number'] {
  appearance: textfield;
}
.schema-card input[type='number']::-webkit-outer-spin-button,
.schema-card input[type='number']::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}
.schema-select {
  position: relative;
  display: block;
  min-width: 0;
}
.schema-select::after {
  content: '';
  position: absolute;
  top: 11px;
  right: 10px;
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  opacity: 0.72;
  transform: rotate(45deg);
  pointer-events: none;
}
.schema-card select {
  appearance: none;
  padding-right: 26px;
  cursor: pointer;
}
.schema-card select:disabled { cursor: default; }
.schema-controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 8px;
  align-items: end;
}
.schema-platform { grid-column: 1 / -1; }
.schema-start,
.schema-image-add {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
.schema-start { justify-self: start; padding: 4px 12px; border-radius: 999px; }
.schema-start:disabled { opacity: 0.5; cursor: default; }
.schema-images { display: grid; gap: 6px; font-size: 12px; }
.schema-image-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.schema-image-add {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  border-style: dashed;
  display: grid;
  place-items: center;
  padding: 4px;
  line-height: 1.2;
}
.schema-note, .schema-error { margin: 0; font-size: 12px; }
.schema-note { color: rgba(var(--v-theme-on-surface), 0.62); }
.schema-image-line figure {
  position: relative;
  width: 72px;
  height: 72px;
  margin: 0;
  flex: 0 0 auto;
}
.schema-image-line img {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 10px;
  display: block;
}
.schema-image-line figure button {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.72);
  color: white;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.schema-image-file { display: none; }
.schema-error { color: rgb(var(--v-theme-error)); }
</style>
