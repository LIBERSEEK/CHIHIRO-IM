<template>
    <aside
        class="chihiro-session-rail"
        :class="{ 'is-group-default': view === 'group' }"
        @click.stop>
        <div v-if="view === 'group'" class="chihiro-session-group">
            <section class="chihiro-session-notice" @click="emit('open-info')">
                <header>
                    <span>群公告</span>
                    <font-awesome-icon :icon="['fas', 'angle-right']" />
                </header>
                <p :class="{ 'is-empty': !latestNotice }">{{ latestNotice || '暂无公告' }}</p>
            </section>
            <section class="chihiro-session-members">
                <header>
                    <span>群聊成员 {{ members.length }}</span>
                    <button type="button" title="搜索" @click.stop="toggleSearch">
                        <font-awesome-icon :icon="['fas', 'magnifying-glass']" />
                    </button>
                </header>
                <div v-if="searchOpen" class="chihiro-session-search">
                    <input
                        ref="searchInput"
                        v-model="query"
                        type="search"
                        placeholder="搜索"
                        @click.stop>
                </div>
                <RecycleScroller
                    v-if="filteredMembers.length"
                    v-slot="{ item }"
                    class="chihiro-session-member-list"
                    :items="filteredMembers"
                    :item-size="48"
                    key-field="user_id">
                    <button
                        type="button"
                        class="chihiro-session-member"
                        @click="onMemberClick(item, $event)">
                        <img
                            loading="lazy"
                            alt=""
                            :src="`https://q1.qlogo.cn/g?b=qq&s=0&nk=${item.user_id}`">
                        <span class="chihiro-session-member-name">{{ memberName(item) }}</span>
                        <span v-if="item.role === 'owner'" class="chihiro-session-role is-owner">群主</span>
                        <span v-else-if="item.role === 'admin'" class="chihiro-session-role is-admin">管理员</span>
                    </button>
                </RecycleScroller>
                <div v-else class="chihiro-session-empty">
                    {{ query.trim() ? '没有找到匹配的群成员' : (members.length ? '' : '加载中…') }}
                </div>
            </section>
        </div>
        <UserBotHistoryPan
            v-if="view === 'history' && accountId && peerId"
            embedded
            :back="chatType === 'group'"
            :account-id="accountId"
            :type="historyType"
            :peer-id="peerId"
            :working="working"
            @close="emit('close')"
            @jump-to-msg="(messageId) => emit('jump-to-msg', messageId)" />
    </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { faAngleRight, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import UserBotHistoryPan from '@renderer/components/user/UserBotHistoryPan.vue'
import type { GroupMemberInfoElem } from '@renderer/function/elements/information'
import { noticePreviewText } from '@chihiro/im-native/notice-text'

library.add(faAngleRight, faMagnifyingGlass)

type RailMember = GroupMemberInfoElem & { user_id: number | string }

const props = defineProps<{
    view: 'group' | 'history'
    chat: any
    accountId?: string
    type?: 'private' | 'group'
    peerId?: string
    working?: boolean
}>()

const emit = defineEmits<{
    close: []
    'jump-to-msg': [messageId: string]
    'open-info': []
    'open-profile': [{
        userId: number
        nickname?: string
        card?: string
        anchor: { top: number; left: number; right: number; bottom: number; width: number; height: number }
    }]
}>()

const query = ref('')
const searchOpen = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)

const chatType = computed(() => String(props.chat?.show?.type || ''))
const historyType = computed<'private' | 'group'>(() => props.type === 'group' || chatType.value === 'group' ? 'group' : 'private')

const members = computed<RailMember[]>(() => {
    const list = props.chat?.info?.group_members
    return Array.isArray(list) ? list : []
})

const filteredMembers = computed(() => {
    const needle = query.value.trim().toLowerCase()
    if (!needle) return members.value
    return members.value.filter((item) => {
        const card = String(item.card || '').toLowerCase()
        const nickname = String(item.nickname || '').toLowerCase()
        const id = String(item.user_id || '')
        return card.includes(needle) || nickname.includes(needle) || id.includes(needle)
    })
})

const notices = computed<any[]>(() => {
    const raw = props.chat?.info?.group_notices
    if (Array.isArray(raw)) return raw
    if (raw && typeof raw === 'object') return Object.values(raw)
    return []
})

const latestNotice = computed(() => {
    const list = notices.value.slice().sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0))
    return noticePreviewText(list[0])
})

function memberName(item: RailMember) {
    return String(item.card || item.nickname || item.user_id || '')
}

function toggleSearch() {
    searchOpen.value = !searchOpen.value
    if (!searchOpen.value) query.value = ''
    else nextTick(() => searchInput.value?.focus())
}

function onMemberClick(item: RailMember, event: MouseEvent) {
    const el = event.currentTarget as HTMLElement | null
    const box = el?.getBoundingClientRect()
    emit('open-profile', {
        userId: Number(item.user_id),
        nickname: item.nickname,
        card: item.card,
        anchor: {
            top: box?.top ?? 0,
            left: box?.left ?? 0,
            right: box?.right ?? 0,
            bottom: box?.bottom ?? 0,
            width: box?.width ?? 0,
            height: box?.height ?? 0,
        },
    })
}
</script>

<style>
.chihiro-session-rail {
    pointer-events: all;
    position: absolute;
    top: var(--chihiro-chat-header-height, 52px);
    right: 0;
    bottom: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    width: var(--chihiro-session-rail-width, 272px);
    background: var(--color-card);
    border-left: 1px solid rgba(127, 127, 127, 0.18);
    color: var(--color-font);
    overflow: hidden;
}
.chihiro-session-group {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
}
.chihiro-session-notice {
    flex: 0 0 auto;
    padding: 14px 14px 12px;
    border-bottom: 1px solid rgba(127, 127, 127, 0.12);
    cursor: pointer;
}
.chihiro-session-notice > header,
.chihiro-session-members > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--color-font);
    font-size: 13px;
    font-weight: 650;
}
.chihiro-session-notice > header svg {
    color: var(--color-font-2);
    width: 12px;
    height: 12px;
}
.chihiro-session-notice > p {
    margin: 8px 0 0;
    color: var(--color-font-1);
    font-size: 12px;
    line-height: 1.55;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
}
.chihiro-session-notice > p.is-empty {
    color: var(--color-font-2);
}
.chihiro-session-members {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}
.chihiro-session-members > header {
    padding: 12px 8px 8px 14px;
}
.chihiro-session-members > header button {
    appearance: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-font-2);
    cursor: pointer;
}
.chihiro-session-members > header button:hover {
    background: rgba(127, 127, 127, 0.14);
}
.chihiro-session-search {
    padding: 0 12px 8px;
}
.chihiro-session-search input {
    width: 100%;
    height: 30px;
    margin: 0;
    padding: 0 10px;
    border: 0;
    border-radius: 8px;
    background: rgba(127, 127, 127, 0.12);
    color: var(--color-font);
    font-size: 12px;
}
.chihiro-session-member-list {
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
}
.chihiro-session-member-list.vue-recycle-scroller {
    height: 100%;
}
.chihiro-session-member {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 48px;
    margin: 0;
    padding: 0 14px;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
}
.chihiro-session-member:hover {
    background: rgba(127, 127, 127, 0.1);
}
.chihiro-session-member img {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
    flex: 0 0 auto;
    background: var(--color-card-2);
}
.chihiro-session-member-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
}
.chihiro-session-role {
    flex: 0 0 auto;
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 10px;
    line-height: 16px;
    font-weight: 650;
}
.chihiro-session-role.is-owner {
    background: #c45c26;
    color: #fff;
}
.chihiro-session-role.is-admin {
    background: #4d6b8a;
    color: #fff;
}
.chihiro-session-empty {
    padding: 24px 12px;
    color: var(--color-font-2);
    font-size: 12px;
    text-align: center;
}
@media (max-width: 900px) {
    .chihiro-session-rail {
        width: min(320px, 100%);
        z-index: 26;
        box-shadow: -12px 0 32px rgba(0, 0, 0, 0.18);
    }
    .chihiro-session-rail.is-group-default {
        display: none;
    }
}
</style>
