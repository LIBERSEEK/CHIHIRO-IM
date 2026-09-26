<template>
  <div class="project-sessions-container fade-in">
    <section class="project-header">
      <div class="project-title-row">
        <span class="project-header-emoji" aria-hidden="true">
          {{ project?.emoji || "📁" }}
        </span>
        <div class="project-title-copy">
          <h2 class="project-header-title">{{ project?.title }}</h2>
          <p class="project-header-description" v-if="project?.description">
            {{ project.description }}
          </p>
        </div>
      </div>
      <div
        v-if="workspaceSummary"
        class="project-workspace-summary"
        :title="workspaceSummary"
      >
        <FolderCog :size="15" />
        <span>{{ workspaceSummary }}</span>
      </div>
    </section>

    <section class="project-sessions-list">
      <div v-if="visibleSessions.length > 0" class="project-session-list">
        <div
          v-for="session in visibleSessions"
          :key="session.session_id"
          class="project-session-item"
          :class="{ 'is-pinned': isPinned(session.session_id) }"
          role="button"
          tabindex="0"
          @click="$emit('selectSession', session.session_id)"
          @keydown.enter="$emit('selectSession', session.session_id)"
        >
          <span class="project-session-copy">
            <input
              v-if="renamingSessionId === session.session_id"
              ref="renameInput"
              v-model="renameDraft"
              class="project-session-title-input"
              :aria-label="tm('conversation.editDisplayName')"
              @click.stop
              @dblclick.stop
              @keydown.enter.stop.prevent="commitRename(session)"
              @keydown.esc.stop.prevent="cancelRename"
              @blur="commitRename(session)"
            />
            <span
              v-else
              class="project-session-title"
              @dblclick.stop="beginRename(session)"
            >
              {{ session.display_name || tm("conversation.newConversation") }}
            </span>
            <span class="project-session-time">
              {{ formatDate(session.updated_at) }}
            </span>
          </span>
          <span class="session-actions" @click.stop>
            <button
              type="button"
              class="project-session-action session-pin-btn"
              :title="pinLabel(session.session_id)"
              :aria-label="pinLabel(session.session_id)"
              :aria-pressed="isPinned(session.session_id)"
              @click="togglePin(session.session_id)"
            >
              <Pin
                :size="17"
                :fill="isPinned(session.session_id) ? 'currentColor' : 'none'"
              />
            </button>
            <button
              type="button"
              class="project-session-action session-archive-btn"
              :title="tm('conversation.archive')"
              :aria-label="tm('conversation.archive')"
              @click="archiveSession(session.session_id)"
            >
              <Archive :size="17" />
            </button>
          </span>
        </div>
      </div>
      <div v-else class="no-sessions-in-project">
        <MessageSquare :size="22" />
        <p>{{ tm("project.noSessions") }}</p>
      </div>
    </section>

    <div class="project-input-slot">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { Archive, FolderCog, MessageSquare, Pin } from "@lucide/vue";
import { useModuleI18n } from "@/modules/agent/native/src/i18n/composables";
import type { Project } from "@/modules/agent/native/src/components/chat/ProjectList.vue";
import { useSidebarSessionFlags } from "@/modules/agent/native/src/use-sidebar-session-flags";

interface Session {
  session_id: string;
  display_name?: string | null;
  updated_at: string;
}

interface Props {
  project?: Project | null;
  sessions: Session[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  selectSession: [sessionId: string];
  renameSession: [sessionId: string, title: string];
}>();

const { tm } = useModuleI18n("features/chat");
const { togglePin, archiveSession, isPinned, arrange } = useSidebarSessionFlags();
const visibleSessions = computed(() => arrange(props.sessions));
const renamingSessionId = ref("");
const renameDraft = ref("");
const renameInput = ref<HTMLInputElement | null>(null);
let renameCanceled = false;

const workspaceSummary = computed(() => {
  const project = props.project;
  if (!project) return "";
  const workspaceType = project.workspace_type || "session";
  if (workspaceType === "session") {
    return tm("project.workspace.session");
  }
  const path = project.resolved_workspace_path || project.workspace_path || "";
  if (workspaceType === "project") {
    return path
      ? `${tm("project.workspace.project")} · ${path}`
      : tm("project.workspace.project");
  }
  return path
    ? `${tm("project.workspace.custom")} · ${path}`
    : tm("project.workspace.custom");
});

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function pinLabel(sessionId: string) {
  return isPinned(sessionId) ? tm("conversation.unpin") : tm("conversation.pin");
}

async function beginRename(session: Session) {
  renameCanceled = false;
  renamingSessionId.value = session.session_id;
  renameDraft.value = session.display_name || "";
  await nextTick();
  const input = Array.isArray(renameInput.value) ? renameInput.value[0] : renameInput.value;
  input?.focus();
  input?.select();
}

function cancelRename() {
  renameCanceled = true;
  renamingSessionId.value = "";
}

function commitRename(session: Session) {
  if (renameCanceled) {
    renameCanceled = false;
    return;
  }
  if (renamingSessionId.value !== session.session_id) return;
  const title = renameDraft.value.trim();
  renamingSessionId.value = "";
  if ((session.display_name || "") === title) return;
  emit("renameSession", session.session_id, title);
}
</script>

<style scoped>
.project-sessions-container {
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: clamp(44px, 8vh, 88px) 32px 24px;
  overflow: hidden;
}

.project-header {
  flex: 0 0 auto;
  width: var(--chat-content-width, 76%);
  max-width: var(--chat-content-max-width, 760px);
  margin: 0 auto 18px;
}

.project-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.project-header-emoji {
  flex: 0 0 auto;
  font-size: 28px;
  line-height: 1;
}

.project-title-copy {
  min-width: 0;
}

.project-header-title {
  margin: 0;
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface));
  font-size: 28px;
  font-weight: 750;
  line-height: 1.12;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-header-description {
  margin: 5px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.56);
  font-size: 14px;
  line-height: 1.45;
}

.project-workspace-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  margin-top: 12px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 12px;
  line-height: 18px;
}

.project-workspace-summary svg {
  flex: 0 0 auto;
  stroke-width: 2;
}

.project-workspace-summary span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-input-slot {
  flex: 0 0 auto;
  width: 100%;
  padding-top: 18px;
}

.project-sessions-list {
  flex: 1;
  min-height: 0;
  width: var(--chat-content-width, 76%);
  max-width: var(--chat-content-max-width, 760px);
  overflow-y: auto;
  background-color: transparent !important;
}

.project-session-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.project-session-item {
  width: 100%;
  min-height: 54px;
  border: 0;
  border-radius: 10px;
  background: transparent !important;
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 10px;
  cursor: pointer;
  text-align: left;
}

.project-session-item:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.04) !important;
}

.project-session-item:hover .session-actions,
.project-session-item:focus-within .session-actions,
.project-session-item.is-pinned .session-actions {
  opacity: 1;
  visibility: visible;
}

.project-session-item.is-pinned:not(:hover):not(:focus-within) .session-actions {
  pointer-events: none;
}

.project-session-item.is-pinned:not(:hover):not(:focus-within) .session-pin-btn {
  pointer-events: auto;
}

.project-session-item.is-pinned:not(:hover):not(:focus-within) .session-archive-btn {
  opacity: 0;
}

.project-session-title-input {
  width: 100%;
  border: 0;
  padding: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  font-size: 15px;
  font-weight: 520;
  line-height: 20px;
  outline: none;
}

.project-session-copy {
  min-width: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.project-session-title {
  overflow: hidden;
  font-size: 15px;
  font-weight: 520;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-session-time {
  color: rgba(var(--v-theme-on-surface), 0.52);
  font-size: 13px;
  line-height: 18px;
}

.session-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  opacity: 0;
  transition: opacity 0.14s ease;
  visibility: hidden;
}

.project-session-action {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.project-session-action:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-on-surface));
}

.no-sessions-in-project {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
  color: rgba(var(--v-theme-on-surface), 0.52);
}

.no-sessions-in-project p {
  margin: 8px 0 0;
  font-size: 14px;
}

@media (max-width: 768px) {
  .project-sessions-container {
    padding: 28px 14px 16px;
  }

  .project-header,
  .project-sessions-list {
    width: calc(100% - 20px);
    max-width: 100%;
  }

  .project-header-title {
    font-size: 24px;
  }

  .session-actions {
    opacity: 1;
    visibility: visible;
  }
}

.fade-in {
  animation: fadeIn 0.3s ease-in-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
