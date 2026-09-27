<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useShellStore } from '@/stores/shell'

const props = defineProps<{
  busy: boolean
  canceling: boolean
  message: string
  canExit: boolean
  product?: string
}>()

const emit = defineEmits<{
  login: [path: string]
  cancel: []
  exit: []
}>()

const shell = useShellStore()
const pathDraft = ref(shell.browserPath)
const picking = ref(false)
const statusMessage = computed(() => {
  const text = props.message.trim()
  if (!text) return ''
  if (props.busy || props.canceling) return text
  if (/失败|无法|错误|异常|超时/.test(text)) return text
  return ''
})

watch(() => shell.browserPath, (value) => {
  if (value && value !== pathDraft.value) pathDraft.value = value
}, { immediate: true })

async function chooseChrome() {
  picking.value = true
  try {
    await shell.saveBrowserPath(pathDraft.value.trim())
    pathDraft.value = shell.browserPath
  } catch (cause) {
    shell.error = cause instanceof Error ? cause.message : '无法选择 Chrome'
  } finally {
    picking.value = false
  }
}
</script>

<template>
  <div class="lz-login" :aria-label="props.product || '抖音登录'">
    <aside class="lz-login-brand">
      <div class="lz-login-mark">
        <img src="/icon.png" alt="" />
        <div>
          <h1>千寻</h1>
          <p>{{ props.product || '抖音自动营销与引流工具' }}</p>
        </div>
      </div>
    </aside>
    <section class="lz-login-form">
      <div class="lz-login-card">
        <h2>配置浏览器</h2>
        <label class="lz-login-field">
          可执行文件路径
          <span class="lz-login-path">
            <input
              v-model="pathDraft"
              type="text"
              spellcheck="false"
              :disabled="busy || canceling || picking"
              placeholder="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            />
            <button type="button" :disabled="busy || canceling || picking" @click="chooseChrome">选择</button>
          </span>
        </label>
        <p v-if="statusMessage" class="lz-login-message">{{ statusMessage }}</p>
        <button
          v-if="!busy"
          type="button"
          class="lz-login-submit"
          :disabled="shell.accountAction || canceling"
          @click="emit('login', pathDraft)"
        >登录账号</button>
        <button
          v-else
          type="button"
          class="lz-login-cancel"
          :disabled="canceling"
          @click="emit('cancel')"
        >{{ canceling ? '取消中…' : '取消登录' }}</button>
        <p class="lz-login-foot">登录后即可开始使用自动化评论功能</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lz-login {
  display: grid;
  grid-template-columns: minmax(280px, 42%) minmax(0, 1fr);
  width: 100%;
  height: 100%;
  min-height: 0;
  color: #111;
  background: #ececec;
  font-family: Inter, ui-sans-serif, system-ui, "PingFang SC", "Noto Sans SC", sans-serif;
}
.lz-login-brand {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 56px 64px;
  background: #fff;
}
.lz-login-mark {
  display: flex;
  align-items: center;
  gap: 16px;
}
.lz-login-mark img {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  object-fit: cover;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .08);
}
.lz-login-mark h1 {
  margin: 0;
  color: #111;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: .02em;
  line-height: 1.1;
}
.lz-login-mark p {
  margin: 8px 0 0;
  color: #6b6b6b;
  font-size: 14px;
  line-height: 1.5;
}
.lz-login-form {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 48px 72px;
  background: #ececec;
}
.lz-login-card {
  display: grid;
  width: min(560px, 100%);
  gap: 18px;
}
.lz-login-card h2 {
  margin: 0 0 4px;
  color: #111;
  font-size: 22px;
  font-weight: 700;
}
.lz-login-field {
  display: grid;
  gap: 8px;
  color: #6b6b6b;
  font-size: 13px;
}
.lz-login-path {
  display: flex;
  gap: 8px;
}
.lz-login-path input {
  min-width: 0;
  flex: 1;
  height: 42px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  color: #f5f5f5;
  background: #2a2a2a;
  font: inherit;
  font-size: 13px;
}
.lz-login-path input::placeholder { color: #8a8a8a; }
.lz-login-path button,
.lz-login-cancel {
  height: 42px;
  padding: 0 16px;
  border: 0;
  border-radius: 8px;
  color: #444;
  background: #d8d8d8;
  cursor: pointer;
  font-size: 14px;
}
.lz-login-submit {
  height: 46px;
  margin-top: 4px;
  border: 0;
  border-radius: 8px;
  color: #fff;
  background: #111;
  cursor: pointer;
  font-size: 15px;
  font-weight: 650;
}
.lz-login-submit:disabled,
.lz-login-path button:disabled,
.lz-login-cancel:disabled {
  cursor: wait;
  opacity: .55;
}
.lz-login-message {
  margin: 0;
  color: #c2410c;
  font-size: 13px;
  line-height: 1.5;
}
.lz-login-foot {
  margin: 2px 0 0;
  color: #8a8a8a;
  font-size: 13px;
}
@media (max-width: 860px) {
  .lz-login { grid-template-columns: 1fr; }
  .lz-login-brand { padding: 32px 24px 20px; }
  .lz-login-form { padding: 24px; align-items: start; }
}
</style>
