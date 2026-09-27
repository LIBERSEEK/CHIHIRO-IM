<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import OutreachWorkbench from '@/modules/outreach/components/OutreachWorkbench.vue'

const props = defineProps<{
  open: boolean
  title: string
}>()

const emit = defineEmits<{ close: [] }>()
const closeButton = ref<HTMLButtonElement | null>(null)

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  closeButton.value?.focus()
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="outreach-settings">
      <div v-if="open" class="outreach-settings-backdrop" role="presentation" @click.self="emit('close')" @keydown="onKeydown">
        <section class="outreach-settings-window" role="dialog" aria-modal="true" :aria-label="title">
          <header class="outreach-settings-toolbar">
            <h2>{{ title }}</h2>
            <button ref="closeButton" type="button" title="关闭" aria-label="关闭" @click="emit('close')">
              <X :size="18" />
            </button>
          </header>
          <div class="outreach-settings-content">
            <OutreachWorkbench surface="settings" />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.outreach-settings-backdrop {
  position: fixed;
  z-index: 5200;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px 32px;
  background: rgb(0 0 0 / 48%);
  backdrop-filter: blur(7px);
}
.outreach-settings-window {
  display: grid;
  width: min(760px, calc(100vw - 64px));
  height: min(420px, calc(100vh - 48px));
  min-width: 0;
  min-height: 0;
  grid-template-rows: 48px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--shell-line);
  border-radius: 10px;
  color: var(--shell-text);
  background: #101014;
  box-shadow: 0 28px 80px rgb(0 0 0 / 48%);
}
.outreach-settings-toolbar {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 10px 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, .09);
  background: #18181c;
}
.outreach-settings-toolbar h2 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: #e6e6e6;
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.outreach-settings-toolbar button {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: #9a9aa0;
  background: transparent;
  cursor: pointer;
}
.outreach-settings-toolbar button:hover,
.outreach-settings-toolbar button:focus-visible {
  color: #e6e6e6;
  background: rgba(255, 255, 255, .08);
  outline: none;
}
.outreach-settings-content {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.outreach-settings-enter-active,
.outreach-settings-leave-active { transition: opacity .16s ease; }
.outreach-settings-enter-active .outreach-settings-window,
.outreach-settings-leave-active .outreach-settings-window { transition: transform .16s ease, opacity .16s ease; }
.outreach-settings-enter-from,
.outreach-settings-leave-to { opacity: 0; }
.outreach-settings-enter-from .outreach-settings-window,
.outreach-settings-leave-to .outreach-settings-window { opacity: 0; transform: translateY(5px) scale(.992); }
@media (max-width: 700px) {
  .outreach-settings-backdrop { padding: 0; }
  .outreach-settings-window {
    width: 100vw;
    height: 100vh;
    border: 0;
    border-radius: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .outreach-settings-enter-active,
  .outreach-settings-leave-active,
  .outreach-settings-enter-active .outreach-settings-window,
  .outreach-settings-leave-active .outreach-settings-window { transition: none; }
}
</style>
