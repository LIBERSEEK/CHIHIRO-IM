<script setup lang="ts">
import { computed } from 'vue'
import { useOutreachCampaignStore, type LibraryItem } from '../stores/campaign'

const emit = defineEmits<{
  pick: [item: LibraryItem]
  unpick: [id: string]
}>()

const campaign = useOutreachCampaignStore()
const selectedIds = computed(() => new Set(campaign.composerFiles.flatMap(file => file.libraryId ? [file.libraryId] : [])))

function toggle(item: LibraryItem) {
  if (selectedIds.value.has(item.id)) emit('unpick', item.id)
  else emit('pick', item)
}

function remove(id: string) {
  emit('unpick', id)
  void campaign.removeFromLibrary(id)
}
</script>

<template>
  <v-dialog v-model="campaign.libraryOpen" max-width="720" width="calc(100vw - 32px)" :z-index="3200">
    <v-card class="library-dialog" rounded="xl">
      <header>
        <div>
          <strong>资料库</strong>
          <p>点一下就加到输入框上方。右键对话里的文件，可以把它留在这里。</p>
        </div>
        <button type="button" class="library-close" @click="campaign.closeLibrary()">关闭</button>
      </header>
      <p v-if="campaign.error" class="library-error">{{ campaign.error }}</p>
      <p v-if="!campaign.items.length" class="library-empty">还没有文件。</p>
      <div v-else class="library-grid">
        <article v-for="item in campaign.items" :key="item.id" :class="{ selected: selectedIds.has(item.id) }">
          <button type="button" class="library-thumb" @click="toggle(item)">
            <img v-if="item.kind === 'image'" :src="campaign.fileUrl(item.id)" :alt="item.name" />
            <video v-else :src="campaign.fileUrl(item.id)" muted />
            <span>{{ item.name }}</span>
          </button>
          <button type="button" class="library-delete" @click="remove(item.id)">删除</button>
        </article>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.library-dialog {
  width: 100%;
  max-height: calc(100vh - 32px);
  overflow: auto;
  box-sizing: border-box;
  padding: 18px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}
.library-dialog header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.library-dialog header div { min-width: 0; margin-right: auto; }
.library-dialog strong { font-size: 16px; }
.library-dialog header p, .library-empty { margin: 6px 0 0; color: rgba(var(--v-theme-on-surface), 0.62); font-size: 13px; overflow-wrap: anywhere; }
.library-close, .library-delete {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.library-close { flex: 0 0 auto; padding: 6px 12px; font-size: 13px; white-space: nowrap; }
.library-error { margin: 0 0 10px; color: #d35b5b; font-size: 13px; }
.library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 10px; max-height: min(520px, 68vh); overflow: auto; }
.library-grid article { padding: 8px; border: 1px solid transparent; border-radius: 14px; background: rgba(var(--v-theme-on-surface), 0.03); }
.library-grid article.selected { border-color: rgba(var(--v-theme-on-surface), 0.45); }
.library-thumb { display: grid; width: 100%; gap: 6px; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.library-thumb img, .library-thumb video { width: 100%; height: 92px; object-fit: cover; border-radius: 10px; background: rgba(var(--v-theme-on-surface), 0.06); }
.library-thumb span { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.library-delete { margin-top: 8px; padding: 3px 8px; font-size: 12px; }
</style>
