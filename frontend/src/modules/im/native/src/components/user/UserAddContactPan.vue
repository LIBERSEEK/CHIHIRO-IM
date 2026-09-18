<template>
    <Teleport to="#chihiro-im-overlays">
        <div
            v-if="open"
            class="chihiro-add-root"
            @mousedown.self="onBackdrop">
            <div
                v-if="showSearch"
                v-esc="close"
                class="chihiro-add-search"
                role="dialog"
                aria-modal="true"
                aria-label="加好友/群"
                @mousedown.stop>
                <header class="chihiro-add-search-head">{{ $t('加好友/群') }}</header>
                <form class="chihiro-add-search-bar" @submit.prevent="search">
                    <label class="chihiro-add-search-field">
                        <font-awesome-icon :icon="['fas', 'magnifying-glass']" />
                        <input
                            ref="queryInput"
                            v-model="query"
                            type="text"
                            :placeholder="$t('输入搜索关键词')"
                            autocomplete="off">
                    </label>
                    <button type="submit" class="chihiro-add-search-go" :disabled="searching">
                        {{ $t('搜索') }}
                    </button>
                </form>
                <div class="chihiro-add-search-body">
                    <div v-if="searching" class="chihiro-add-empty">{{ $t('正在搜索…') }}</div>
                    <div v-else-if="error" class="chihiro-add-empty">{{ error }}</div>
                    <div v-else-if="searched && !user && !groups.length" class="chihiro-add-empty">
                        {{ $t('未找到相关用户或群聊') }}
                    </div>
                    <template v-else>
                        <section v-if="user" class="chihiro-add-section">
                            <header>
                                <span>{{ user.user_id }} - {{ $t('用户') }}</span>
                            </header>
                            <div class="chihiro-add-row">
                                <img class="chihiro-add-avatar" :src="userAvatar(user.user_id)" alt="">
                                <div class="chihiro-add-meta">
                                    <div class="chihiro-add-name">
                                        {{ user.nickname || user.user_id }}
                                        <span>({{ user.user_id }})</span>
                                    </div>
                                    <div v-if="userSearchTags(user).length" class="chihiro-add-tags">
                                        <span v-for="tag in userSearchTags(user)" :key="tag">{{ tag }}</span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    class="chihiro-add-action"
                                    @click="onUserAction(user)">
                                    {{ user.already ? $t('发消息') : $t('添加') }}
                                </button>
                            </div>
                        </section>
                        <section v-if="groups.length" class="chihiro-add-section">
                            <header>
                                <span>{{ groups.length === 1 ? groups[0].group_id + ' - ' : '' }}{{ $t('群聊') }}</span>
                            </header>
                            <div
                                v-for="group in groups"
                                :key="group.group_id"
                                class="chihiro-add-row">
                                <img class="chihiro-add-avatar" :src="groupAvatar(group.group_id)" alt="">
                                <div class="chihiro-add-meta">
                                    <div class="chihiro-add-name">
                                        {{ group.name || group.group_id }}
                                        <span>({{ group.group_id }})</span>
                                    </div>
                                    <div class="chihiro-add-tags">
                                        <span v-if="groupMemberLabel(group)">{{ groupMemberLabel(group) }}</span>
                                        <span v-if="group.muted">{{ $t('禁言中') }}</span>
                                    </div>
                                    <div v-if="group.memo" class="chihiro-add-memo">{{ group.memo }}</div>
                                </div>
                                <button
                                    type="button"
                                    class="chihiro-add-action"
                                    @click="onGroupAction(group)">
                                    {{ group.already ? $t('发消息') : $t('加入') }}
                                </button>
                            </div>
                        </section>
                    </template>
                </div>
            </div>

            <div
                v-if="apply"
                class="chihiro-add-apply-wrap"
                @mousedown.self="closeApply">
                <div
                    v-esc="closeApply"
                    class="chihiro-add-apply"
                    role="dialog"
                    aria-modal="true"
                    :aria-label="applyTitle"
                    @mousedown.stop>
                    <header>{{ applyTitle }}</header>
                    <div v-if="apply.kind === 'friend'" class="chihiro-add-apply-head">
                        <img class="chihiro-add-apply-avatar" :src="userAvatar(apply.user.user_id)" alt="">
                        <div>
                            <div class="chihiro-add-apply-name">
                                {{ apply.user.nickname || apply.user.user_id }}
                                <span>({{ apply.user.user_id }})</span>
                            </div>
                            <div class="chihiro-add-apply-sub">{{ apply.user.user_id }}</div>
                        </div>
                    </div>
                    <div v-else class="chihiro-add-apply-head">
                        <img class="chihiro-add-apply-avatar" :src="groupAvatar(apply.group.group_id)" alt="">
                        <div>
                            <div class="chihiro-add-apply-name">
                                {{ apply.group.name || apply.group.group_id }}
                                <span>({{ apply.group.group_id }})</span>
                            </div>
                            <div v-if="groupMemberLabel(apply.group)" class="chihiro-add-apply-sub">
                                {{ groupMemberLabel(apply.group) }}
                            </div>
                        </div>
                    </div>
                    <label v-if="applyFieldLabel" class="chihiro-add-field">
                        <span>{{ applyFieldLabel }}</span>
                        <textarea v-model="message" rows="3" />
                    </label>
                    <div v-if="applyError" class="chihiro-add-apply-error">{{ applyError }}</div>
                    <div class="chihiro-add-apply-actions">
                        <button type="button" @click="closeApply">{{ $t('取消') }}</button>
                        <button
                            type="button"
                            class="is-primary"
                            :disabled="busy"
                            @click="submitApply">
                            {{ $t('发送') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Connector } from '@renderer/function/connect'
import { PopInfo, PopType } from '@renderer/function/base'
import { vEsc } from '@renderer/function/utils/appUtil'
import { useAuthStore } from '@renderer/state/auth'
import { useContactStore } from '@renderer/state/contact'
import type { BaseChatInfoElem } from '@renderer/function/elements/information'
import { i18n } from '@chihiro/im-native/host'
import {
    addContactUi,
    applyLocalMembership,
    closeAddContact,
    defaultFriendMessage,
    groupAvatar,
    groupsFromContactList,
    groupMemberLabel,
    isUnsupportedContactAction,
    joinGroupForm,
    type SearchGroup,
    type SearchUser,
    userAvatar,
    userFromStranger,
    userSearchTags,
} from '@chihiro/im-native/add-contact'
import { prepareGroupChat, preparePrivateChat } from '@chihiro/im-native/session-open'

defineOptions({ name: 'UserAddContactPan' })

const emit = defineEmits<{
    'start-chat': [info: BaseChatInfoElem]
}>()

const $t = i18n.global.t
const authStore = useAuthStore()
const contactStore = useContactStore()
const queryInput = ref<HTMLInputElement | null>(null)
const query = ref('')
const searching = ref(false)
const searched = ref(false)
const error = ref('')
const user = ref<SearchUser | null>(null)
const groups = ref<SearchGroup[]>([])
const message = ref('')
const busy = ref(false)
const applyError = ref('')
const apply = ref<
    | { kind: 'friend'; user: SearchUser }
    | { kind: 'group'; group: SearchGroup }
    | null
>(null)

const open = computed(() => addContactUi.open)
const showSearch = computed(() => open.value && addContactUi.seed.mode === 'search')
const applyForm = computed(() => {
    if (!apply.value || apply.value.kind !== 'group') return null
    return joinGroupForm(apply.value.group)
})
const applyTitle = computed(() => {
    if (!apply.value) return ''
    return apply.value.kind === 'friend' ? $t('申请加好友') : $t('申请加群')
})
const applyFieldLabel = computed(() => {
    if (!apply.value) return ''
    if (apply.value.kind === 'friend') return $t('填写验证信息')
    const form = applyForm.value
    if (!form || form.kind === 'none') return ''
    if (form.kind === 'question') return form.question || $t('填写验证信息')
    if (form.kind === 'verify') return $t('填写验证信息')
    return ''
})

function resetSearch() {
    query.value = ''
    searching.value = false
    searched.value = false
    error.value = ''
    user.value = null
    groups.value = []
}

function closeApply() {
    apply.value = null
    applyError.value = ''
    busy.value = false
    if (addContactUi.seed.mode === 'friend') close()
}

function close() {
    apply.value = null
    applyError.value = ''
    busy.value = false
    resetSearch()
    closeAddContact()
}

function onBackdrop() {
    if (apply.value) closeApply()
    else close()
}

function actionError(err: unknown) {
    const text = err instanceof Error ? err.message : String(err || '')
    return text || $t('请求失败')
}

async function fallbackSearch(keyword: string): Promise<{ user: SearchUser | null; groups: SearchGroup[] }> {
    let foundUser: SearchUser | null = null
    if (/^\d+$/.test(keyword)) {
        try {
            const data = await Connector.requestAction('get_stranger_info', {
                user_id: Number(keyword),
                no_cache: true,
            })
            const already = contactStore.userList.some((item) => Number(item.user_id) === Number(keyword))
            foundUser = userFromStranger(data, already)
        } catch {
            foundUser = null
        }
    }
    const foundGroups = groupsFromContactList(contactStore.userList, keyword)
    if (/^\d+$/.test(keyword) && !foundGroups.some((item) => item.group_id === keyword)) {
        let name = keyword
        let memberNum = 0
        let maxNum = 0
        try {
            const info = await Connector.requestAction('get_group_info', { group_id: Number(keyword) })
            if (info && typeof info === 'object') {
                name = String(info.group_name || name)
                memberNum = Number(info.member_count) || 0
                maxNum = Number(info.max_member_count) || 0
            }
        } catch {
            // Public group info is optional; membership comes from the contact list.
        }
        foundGroups.unshift({
            group_id: keyword,
            name,
            already: false,
            member_num: memberNum,
            max_member_num: maxNum,
            option: 2,
        })
    }
    return applyLocalMembership({ user: foundUser, groups: foundGroups }, contactStore.userList)
}

async function searchHits(keyword: string) {
    try {
        const data = await Connector.requestAction('search_contact', { keyword })
        return applyLocalMembership({
            user: data?.user && typeof data.user === 'object' ? data.user as SearchUser : null,
            groups: Array.isArray(data?.groups) ? data.groups as SearchGroup[] : [],
        }, contactStore.userList)
    } catch (err) {
        if (!isUnsupportedContactAction(err)) throw err
        return fallbackSearch(keyword)
    }
}

async function search() {
    const keyword = query.value.trim()
    if (!keyword) return
    searching.value = true
    searched.value = false
    error.value = ''
    user.value = null
    groups.value = []
    try {
        const data = await searchHits(keyword)
        user.value = data.user
        groups.value = data.groups
        searched.value = true
    } catch (err) {
        error.value = actionError(err)
    } finally {
        searching.value = false
    }
}

function openChat(info: BaseChatInfoElem) {
    close()
    emit('start-chat', info)
}

function onUserAction(row: SearchUser) {
    if (row.already) {
        openChat(preparePrivateChat({
            userId: Number(row.user_id),
            nickname: row.nickname,
        }))
        return
    }
    message.value = defaultFriendMessage(String(authStore.loginInfo.nickname || ''))
    applyError.value = ''
    apply.value = { kind: 'friend', user: row }
}

function onGroupAction(row: SearchGroup) {
    const form = joinGroupForm(row)
    if (form.kind === 'already' || row.already) {
        openChat(prepareGroupChat({
            groupId: Number(row.group_id),
            name: row.name,
        }))
        return
    }
    if (form.kind === 'forbid') {
        new PopInfo().add(PopType.ERR, $t('该群不允许加入'), true)
        return
    }
    message.value = ''
    applyError.value = ''
    apply.value = { kind: 'group', group: row }
}

async function submitApply() {
    if (!apply.value || busy.value) return
    busy.value = true
    applyError.value = ''
    try {
        if (apply.value.kind === 'friend') {
            const result = await Connector.requestAction('add_friend', {
                user_id: Number(apply.value.user.user_id),
                message: message.value,
            })
            if (result?.already) {
                new PopInfo().add(PopType.INFO, $t('已经是好友'), true)
                openChat(preparePrivateChat({
                    userId: Number(apply.value.user.user_id),
                    nickname: apply.value.user.nickname,
                }))
                return
            }
            new PopInfo().add(PopType.INFO, $t('已发送好友申请'), true)
            close()
            return
        }
        const form = joinGroupForm(apply.value.group)
        const payload: Record<string, unknown> = {
            group_id: Number(apply.value.group.group_id),
        }
        if (form.kind === 'question') payload.answer = message.value
        else payload.comment = message.value
        const result = await Connector.requestAction('join_group', payload)
        if (result?.already) {
            new PopInfo().add(PopType.INFO, $t('已在群中'), true)
            openChat(prepareGroupChat({
                groupId: Number(apply.value.group.group_id),
                name: apply.value.group.name,
            }))
            return
        }
        new PopInfo().add(PopType.INFO, $t('已发送加群申请'), true)
        close()
    } catch (err) {
        applyError.value = actionError(err)
    } finally {
        busy.value = false
    }
}

watch(() => [addContactUi.open, addContactUi.seed] as const, async ([isOpen, seed]) => {
    if (!isOpen) {
        apply.value = null
        resetSearch()
        return
    }
    if (seed.mode === 'friend') {
        resetSearch()
        message.value = defaultFriendMessage(String(authStore.loginInfo.nickname || ''))
        applyError.value = ''
        apply.value = { kind: 'friend', user: seed.user }
        return
    }
    apply.value = null
    await nextTick()
    queryInput.value?.focus()
}, { immediate: true })
</script>

<style scoped>
.chihiro-add-root {
    position: fixed;
    inset: 0;
    z-index: 4300;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
}
.chihiro-add-search {
    width: min(640px, calc(100vw - 32px));
    height: min(560px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    background: var(--color-card);
    border: 1px solid rgba(127, 127, 127, 0.22);
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
    color: var(--color-font);
    overflow: hidden;
}
.chihiro-add-search-head {
    flex: 0 0 auto;
    text-align: center;
    font-size: 13px;
    padding: 12px 16px 8px;
    color: var(--color-font-1);
}
.chihiro-add-search-bar {
    display: flex;
    gap: 10px;
    padding: 0 16px 12px;
}
.chihiro-add-search-field {
    flex: 1;
    min-width: 0;
    height: 36px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-radius: 8px;
    background: rgba(127, 127, 127, 0.14);
}
.chihiro-add-search-field svg {
    width: 12px;
    height: 12px;
    color: var(--color-font-2);
    flex-shrink: 0;
}
.chihiro-add-search-field input {
    flex: 1;
    min-width: 0;
    height: 100%;
    border: 0;
    background: transparent;
    color: var(--color-font);
    font-size: 13px;
    outline: none;
}
.chihiro-add-search-go {
    appearance: none;
    height: 36px;
    padding: 0 16px;
    border: 0;
    border-radius: 8px;
    background: #0078ff;
    color: #fff;
    font-size: 13px;
    cursor: pointer;
}
.chihiro-add-search-go:disabled {
    opacity: 0.65;
    cursor: default;
}
.chihiro-add-search-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 16px 16px;
}
.chihiro-add-empty {
    padding: 48px 12px;
    text-align: center;
    color: var(--color-font-2);
    font-size: 13px;
}
.chihiro-add-section {
    margin-bottom: 14px;
    padding: 8px 10px 10px;
    border-radius: 10px;
    background: rgba(127, 127, 127, 0.08);
}
.chihiro-add-section > header {
    font-size: 12px;
    color: var(--color-font-2);
    padding: 4px 6px 8px;
}
.chihiro-add-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 6px;
}
.chihiro-add-avatar,
.chihiro-add-apply-avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
    background: var(--color-card-1);
    flex: 0 0 44px;
}
.chihiro-add-meta {
    min-width: 0;
    flex: 1;
}
.chihiro-add-name {
    font-size: 14px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.chihiro-add-name span,
.chihiro-add-apply-name span {
    font-weight: 400;
    color: var(--color-font-1);
}
.chihiro-add-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
}
.chihiro-add-tags span {
    font-size: 11px;
    line-height: 18px;
    padding: 0 6px;
    border-radius: 4px;
    background: rgba(127, 127, 127, 0.18);
    color: var(--color-font-1);
}
.chihiro-add-memo {
    margin-top: 6px;
    font-size: 12px;
    color: var(--color-font-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.chihiro-add-action {
    appearance: none;
    flex-shrink: 0;
    height: 30px;
    padding: 0 14px;
    border-radius: 15px;
    border: 1px solid rgba(160, 160, 160, 0.45);
    background: transparent;
    color: var(--color-font);
    font-size: 13px;
    cursor: pointer;
}
.chihiro-add-apply-wrap {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.28);
}
.chihiro-add-apply {
    width: min(380px, calc(100vw - 32px));
    min-height: 280px;
    max-height: min(520px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    padding: 14px 16px 16px;
    background: var(--color-card);
    border: 1px solid rgba(127, 127, 127, 0.22);
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
    color: var(--color-font);
    box-sizing: border-box;
}
.chihiro-add-apply > header {
    text-align: center;
    font-size: 13px;
    color: var(--color-font-1);
    margin-bottom: 16px;
}
.chihiro-add-apply-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
}
.chihiro-add-apply-name {
    font-size: 14px;
    font-weight: 600;
}
.chihiro-add-apply-sub {
    margin-top: 4px;
    font-size: 12px;
    color: var(--color-font-2);
}
.chihiro-add-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-height: 0;
}
.chihiro-add-field span {
    font-size: 13px;
    color: var(--color-font-1);
}
.chihiro-add-field textarea {
    width: 100%;
    min-height: 88px;
    resize: none;
    border: 0;
    border-radius: 8px;
    padding: 10px 12px;
    background: rgba(127, 127, 127, 0.16);
    color: var(--color-font);
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
}
.chihiro-add-apply-error {
    margin-top: 10px;
    font-size: 12px;
    color: #ff6b6b;
}
.chihiro-add-apply-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: auto;
    padding-top: 18px;
}
.chihiro-add-apply-actions button {
    appearance: none;
    height: 32px;
    min-width: 72px;
    padding: 0 14px;
    border-radius: 8px;
    border: 1px solid rgba(160, 160, 160, 0.45);
    background: transparent;
    color: var(--color-font);
    font-size: 13px;
    cursor: pointer;
}
.chihiro-add-apply-actions button.is-primary {
    border-color: transparent;
    background: #0078ff;
    color: #fff;
}
.chihiro-add-apply-actions button:disabled {
    opacity: 0.65;
    cursor: default;
}
</style>
