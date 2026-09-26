<template>
  <section class="sidebar-section project-list-shell">
    <div class="sidebar-section-header">
      <button
        type="button"
        class="section-toggle"
        :aria-expanded="sectionOpen"
        @click="toggleSection"
      >
        <span>{{ tm("project.title") }}</span>
        <ChevronDown v-if="sectionOpen" :size="14" class="section-chevron" />
        <ChevronRight v-else :size="14" class="section-chevron" />
      </button>
      <span class="section-header-actions" @click.stop>
        <v-btn
          icon
          size="x-small"
          variant="text"
          class="section-action-btn"
          :title="tm('project.create')"
          :aria-label="tm('project.create')"
          @click="$emit('createProject')"
        >
          <Plus :size="16" />
        </v-btn>
      </span>
    </div>

    <div v-show="sectionOpen" class="project-list-wrap">
      <div v-for="project in projects" :key="project.project_id">
        <div
          class="project-row project-item"
          :class="{ active: selectedProjectId === project.project_id }"
          role="button"
          tabindex="0"
          @click="handleProjectClick(project)"
          @keydown.enter="handleProjectClick(project)"
          @keydown.space.prevent="handleProjectClick(project)"
        >
          <span class="project-emoji">{{ project.emoji || "📁" }}</span>
          <span class="project-title-wrap">
            <span class="project-title">{{ project.title }}</span>
            <ChevronDown
              v-if="isProjectExpanded(project.project_id)"
              :size="16"
              class="project-chevron"
            />
            <ChevronRight v-else :size="16" class="project-chevron" />
          </span>
          <span class="project-actions" @click.stop>
            <StyledMenu location="bottom end" offset="6">
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  icon
                  size="x-small"
                  variant="text"
                  class="project-action-btn"
                  :title="tm('conversation.more')"
                  :aria-label="tm('conversation.more')"
                >
                  <MoreHorizontal :size="15" />
                </v-btn>
              </template>
              <v-list-item
                class="styled-menu-item"
                rounded="md"
                @click="$emit('editProject', project)"
              >
                <template #prepend>
                  <Settings :size="15" />
                </template>
                <v-list-item-title>{{ tm("project.edit") }}</v-list-item-title>
              </v-list-item>
              <v-list-item
                class="styled-menu-item sidebar-more-delete"
                rounded="md"
                @click="handleDeleteProject(project)"
              >
                <template #prepend>
                  <Trash2 :size="15" />
                </template>
                <v-list-item-title>{{ t("core.common.delete") }}</v-list-item-title>
              </v-list-item>
            </StyledMenu>
            <v-btn
              icon
              size="x-small"
              variant="text"
              class="project-action-btn"
              :title="tm('actions.newChat')"
              :aria-label="tm('actions.newChat')"
              @click="$emit('startChat', project.project_id)"
            >
              <SquarePen :size="15" />
            </v-btn>
          </span>
        </div>

        <Transition name="project-session-fade">
          <div
            v-if="isProjectExpanded(project.project_id)"
            class="project-session-list"
          >
            <div
              v-if="loadingProjectIds.includes(project.project_id)"
              class="project-session-empty"
            >
              {{ tm("project.loadingSessions") }}
            </div>
            <template v-else-if="projectSessionList(project.project_id).length">
              <div
                v-for="session in projectSessionList(project.project_id)"
                :key="session.session_id"
                class="project-session-row"
                :class="{
                  active: activeSessionId === session.session_id,
                  'is-pinned': isPinned(session.session_id),
                }"
                role="button"
                tabindex="0"
                @click="$emit('selectSession', session.session_id)"
                @keydown.enter="$emit('selectSession', session.session_id)"
                @keydown.space.prevent="$emit('selectSession', session.session_id)"
              >
                <input
                  v-if="renamingSessionId === session.session_id"
                  ref="renameInput"
                  v-model="renameDraft"
                  class="session-title-input"
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
                  {{ sessionTitle(session) }}
                </span>
                <span class="project-session-actions" @click.stop>
                  <v-btn
                    icon
                    size="x-small"
                    variant="text"
                    class="project-action-btn session-pin-btn"
                    :title="pinLabel(session.session_id)"
                    :aria-label="pinLabel(session.session_id)"
                    :aria-pressed="isPinned(session.session_id)"
                    @click="togglePin(session.session_id)"
                  >
                    <Pin
                      :size="15"
                      :fill="isPinned(session.session_id) ? 'currentColor' : 'none'"
                    />
                  </v-btn>
                  <v-btn
                    icon
                    size="x-small"
                    variant="text"
                    class="project-action-btn session-archive-btn"
                    :title="tm('conversation.archive')"
                    :aria-label="tm('conversation.archive')"
                    @click="archiveSession(session.session_id)"
                  >
                    <Archive :size="15" />
                  </v-btn>
                </span>
                <v-progress-circular
                  v-if="sessionRunning(session.session_id)"
                  class="project-session-progress"
                  indeterminate
                  size="14"
                  width="2"
                />
              </div>
            </template>
            <div v-else class="project-session-empty">
              {{ tm("project.noSessions") }}
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pin,
  Plus,
  Settings,
  SquarePen,
  Trash2,
} from "@lucide/vue";
import StyledMenu from "@/modules/agent/native/src/components/shared/StyledMenu.vue";
import { useI18n, useModuleI18n } from "@/modules/agent/native/src/i18n/composables";
import { useSidebarSessionFlags } from "@/modules/agent/native/src/use-sidebar-session-flags";
import { askForConfirmation, useConfirmDialog } from "@/modules/agent/native/src/utils/confirmDialog";

export interface Project {
  project_id: string;
  title: string;
  emoji?: string;
  description?: string;
  workspace_type?: "session" | "project" | "custom";
  workspace_path?: string | null;
  resolved_workspace_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectSession {
  session_id: string;
  display_name?: string | null;
  updated_at: string;
}

interface Props {
  projects: Project[];
  projectSessions: Record<string, ProjectSession[]>;
  loadingProjectIds: string[];
  selectedProjectId?: string | null;
  activeSessionId?: string | null;
  revealProjectId?: string | null;
  isSessionRunning?: (sessionId: string) => boolean;
}

const props = withDefaults(defineProps<Props>(), {
  selectedProjectId: null,
  activeSessionId: null,
  revealProjectId: null,
});

const emit = defineEmits<{
  selectProject: [projectId: string];
  createProject: [];
  editProject: [project: Project];
  deleteProject: [projectId: string];
  toggleProject: [projectId: string, expanded: boolean];
  selectSession: [sessionId: string];
  startChat: [projectId: string];
  renameSession: [sessionId: string, title: string];
}>();

const { t } = useI18n();
const { tm } = useModuleI18n("features/chat");
const confirmDialog = useConfirmDialog();
const { togglePin, archiveSession, isPinned, arrange } = useSidebarSessionFlags();
const renamingSessionId = ref("");
const renameDraft = ref("");
const renameInput = ref<HTMLInputElement | null>(null);
let renameCanceled = false;

const PROJECT_SECTION_KEY = "chihiro-sidebar-projects-open";
const sectionOpen = ref(readSectionOpen(PROJECT_SECTION_KEY));
const expandedProjectIds = ref<Set<string>>(readExpandedProjectIds());

function readSectionOpen(key: string) {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}

function toggleSection() {
  sectionOpen.value = !sectionOpen.value;
  try {
    localStorage.setItem(PROJECT_SECTION_KEY, sectionOpen.value ? "1" : "0");
  } catch {
    /* keep the in-memory choice when storage is unavailable */
  }
}

watch(
  () => props.selectedProjectId,
  (projectId) => {
    if (projectId) {
      setProjectExpanded(projectId, true);
    }
  },
);

watch(
  () => props.revealProjectId,
  (projectId) => {
    if (projectId) setProjectExpanded(projectId, true);
  },
);

watch(
  () => props.projects.map((project) => project.project_id).join(","),
  () => {
    const validProjectIds = new Set(
      props.projects.map((project) => project.project_id),
    );
    expandedProjectIds.value.forEach((projectId) => {
      if (validProjectIds.has(projectId)) {
        emit("toggleProject", projectId, true);
      }
    });
  },
  { immediate: true },
);

function readExpandedProjectIds() {
  try {
    const raw = localStorage.getItem("chat.projectExpandedIds");
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
  } catch {
    return new Set<string>();
  }
}

function persistExpandedProjectIds() {
  localStorage.setItem(
    "chat.projectExpandedIds",
    JSON.stringify([...expandedProjectIds.value]),
  );
}

function isProjectExpanded(projectId: string) {
  return expandedProjectIds.value.has(projectId);
}

function setProjectExpanded(projectId: string, expanded: boolean) {
  const next = new Set(expandedProjectIds.value);
  if (expanded) {
    next.add(projectId);
  } else {
    next.delete(projectId);
  }
  expandedProjectIds.value = next;
  persistExpandedProjectIds();
  emit("toggleProject", projectId, expanded);
}

function handleProjectClick(project: Project) {
  const nextExpanded = !isProjectExpanded(project.project_id);
  setProjectExpanded(project.project_id, nextExpanded);
  emit("selectProject", project.project_id);
}

function projectSessionList(projectId: string) {
  return arrange(props.projectSessions[projectId] || []);
}

function pinLabel(sessionId: string) {
  return isPinned(sessionId) ? tm("conversation.unpin") : tm("conversation.pin");
}

async function beginRename(session: ProjectSession) {
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

function commitRename(session: ProjectSession) {
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

function sessionRunning(sessionId: string) {
  return props.isSessionRunning?.(sessionId) || false;
}

function sessionTitle(session: ProjectSession) {
  return session.display_name?.trim() || tm("conversation.newConversation");
}

async function handleDeleteProject(project: Project) {
  const message = tm("project.confirmDelete", { title: project.title });
  if (await askForConfirmation(message, confirmDialog)) {
    emit("deleteProject", project.project_id);
  }
}

</script>

<style scoped>
.project-list-shell {
  margin-top: 2px;
}

.sidebar-section-header {
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px 4px 10px;
  color: var(--chat-section-label);
  font-size: 12px;
  font-weight: 500;
}

.section-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.section-chevron {
  flex: 0 0 auto;
  color: var(--chat-muted);
}

.section-header-actions {
  display: flex;
  align-items: center;
  margin-left: auto;
  opacity: 0;
  pointer-events: none;
}

.sidebar-section-header:hover .section-header-actions,
.sidebar-section-header:focus-within .section-header-actions {
  opacity: 1;
  pointer-events: auto;
}

.section-action-btn,
.project-action-btn {
  color: var(--chat-muted);
}

.section-action-btn :deep(svg),
.project-action-btn :deep(svg),
.project-chevron {
  flex: 0 0 auto;
  stroke-width: 2;
}

.section-action-btn {
  width: 24px;
  height: 24px;
  min-width: 24px;
}

.sidebar-more-delete {
  color: rgb(var(--v-theme-error));
}

@media (hover: none) {
  .section-header-actions,
  .project-actions,
  .project-session-actions,
  .session-archive-btn {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
  }
}

.section-action-btn:hover,
.project-action-btn:hover {
  color: rgb(var(--v-theme-on-surface));
}

.project-list-wrap,
.project-session-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.project-row,
.project-session-row {
  width: 100%;
  min-height: 30px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 64px 4px 10px;
  position: relative;
  box-sizing: border-box;
  cursor: pointer;
  text-align: left;
}

.project-row:hover,
.project-row.active,
.project-session-row:hover,
.project-session-row.active {
  background: var(--chat-session-active-bg);
}

.project-emoji {
  width: 18px;
  flex: 0 0 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}

.project-title-wrap {
  min-width: 0;
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.project-title,
.project-session-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 500;
}

.project-title {
  flex: 0 1 auto;
}

.project-session-title {
  flex: 1;
}

.project-chevron {
  flex: 0 0 auto;
  color: var(--chat-muted);
}

.project-actions,
.project-session-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  visibility: hidden;
}

.project-row:hover .project-actions,
.project-row:focus-within .project-actions,
.project-session-row:hover .project-session-actions,
.project-session-row:focus-within .project-session-actions,
.project-session-row.is-pinned .project-session-actions {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}

.project-session-row.is-pinned:not(:hover):not(:focus-within) .project-session-actions {
  pointer-events: none;
}

.project-session-row.is-pinned:not(:hover):not(:focus-within) .session-pin-btn {
  pointer-events: auto;
}

.project-session-row.is-pinned:not(:hover):not(:focus-within) .session-archive-btn {
  opacity: 0;
}

.session-title-input {
  min-width: 0;
  flex: 1;
  border: 0;
  padding: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  outline: none;
}

.project-session-list {
  padding: 2px 0 4px 26px;
}

.project-session-fade-enter-active {
  transition: opacity 0.1s ease-out;
}

.project-session-fade-leave-active {
  transition: opacity 0.08s ease-in;
}

.project-session-fade-enter-from,
.project-session-fade-leave-to {
  opacity: 0;
}

.project-session-progress {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  flex-shrink: 0;
  transition:
    opacity 0.14s ease,
    visibility 0.14s ease;
}

.project-session-row:hover .project-session-progress,
.project-session-row:focus-within .project-session-progress,
.project-session-row.is-pinned .project-session-progress {
  opacity: 0;
  visibility: hidden;
}

.project-session-empty {
  padding: 5px 10px;
  color: var(--chat-muted);
  font-size: 13px;
}

@media (hover: none) {
  .project-session-row.is-pinned:not(:hover):not(:focus-within) .project-session-actions,
  .project-session-row.is-pinned:not(:hover):not(:focus-within) .session-archive-btn {
    opacity: 1;
    pointer-events: auto;
    visibility: visible;
  }
}
</style>
