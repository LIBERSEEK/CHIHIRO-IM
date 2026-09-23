<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import GrowthWorkbench from '@/modules/growth/GrowthWorkbench.vue'

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
    <Transition name="growth-settings">
      <div v-if="open" class="growth-settings-backdrop" role="presentation" @click.self="emit('close')" @keydown="onKeydown">
        <section class="growth-settings-window" role="dialog" aria-modal="true" :aria-label="title">
          <header class="growth-settings-toolbar">
            <h2>{{ title }}</h2>
            <button ref="closeButton" type="button" title="关闭" aria-label="关闭" @click="emit('close')">
              <X :size="18" />
            </button>
          </header>
          <div class="growth-settings-content">
            <GrowthWorkbench surface="settings" />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.growth-settings-backdrop {
  position: fixed;
  z-index: 5200;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px 32px;
  background: rgb(0 0 0 / 48%);
  backdrop-filter: blur(7px);
}
.growth-settings-window {
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
.growth-settings-toolbar {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 10px 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, .09);
  background: #18181c;
}
.growth-settings-toolbar h2 {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: #e6e6e6;
  font-size: 14px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.growth-settings-toolbar button {
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
.growth-settings-toolbar button:hover,
.growth-settings-toolbar button:focus-visible {
  color: #e6e6e6;
  background: rgba(255, 255, 255, .08);
  outline: none;
}
.growth-settings-content {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.growth-settings-enter-active,
.growth-settings-leave-active { transition: opacity .16s ease; }
.growth-settings-enter-active .growth-settings-window,
.growth-settings-leave-active .growth-settings-window { transition: transform .16s ease, opacity .16s ease; }
.growth-settings-enter-from,
.growth-settings-leave-to { opacity: 0; }
.growth-settings-enter-from .growth-settings-window,
.growth-settings-leave-to .growth-settings-window { opacity: 0; transform: translateY(5px) scale(.992); }
@media (max-width: 700px) {
  .growth-settings-backdrop { padding: 0; }
  .growth-settings-window {
    width: 100vw;
    height: 100vh;
    border: 0;
    border-radius: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .growth-settings-enter-active,
  .growth-settings-leave-active,
  .growth-settings-enter-active .growth-settings-window,
  .growth-settings-leave-active .growth-settings-window { transition: none; }
}
</style>
