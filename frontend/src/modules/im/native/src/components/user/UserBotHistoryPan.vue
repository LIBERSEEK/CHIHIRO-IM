<template>
    <div class="chihiro-bot-history-pan" :class="{ 'is-embedded': embedded }" @click.stop>
        <header>
            <button v-if="back" type="button" title="返回" @click="emit('close')">
                <font-awesome-icon :icon="['fas', 'angle-left']" />
            </button>
            <span>处理历史</span>
            <button v-if="!back" type="button" title="关闭" @click="emit('close')">
                <font-awesome-icon :icon="['fas', 'xmark']" />
            </button>
        </header>
        <div ref="listEl" class="chihiro-bot-history-list" @scroll.passive="onScroll">
            <div v-if="loading && !thread.length && !working" class="chihiro-bot-history-empty">加载中…</div>
            <div v-else-if="!thread.length && !working" class="chihiro-bot-history-empty">还没有处理记录</div>
            <article
                v-for="(item, index) in thread"
                :key="item.id"
                class="chihiro-bot-history-beat"
                :class="{ 'is-working': item.inProgress || (working && index === lastIndex) }">
                <p v-if="item.peerExcerpt" class="chihiro-bot-history-peer">{{ item.peerExcerpt }}</p>
                <button type="button" class="chihiro-bot-think-toggle" @click="toggleOpen(item.id, index)">
                    <span class="chihiro-bot-think-label">
                        <span v-if="item.inProgress" class="chihiro-bot-think-dot" />
                        <span>{{ processLabel(item) }}</span>
                    </span>
                    <span class="chihiro-bot-history-meta">
                        <span>{{ formatTime(item.at) }}</span>
                        <span>{{ triggerLabel(item.trigger) }}</span>
                        <span v-if="item.joinReason">{{ joinLabel(item.joinReason) }}</span>
                    </span>
                    <span class="chihiro-bot-think-caret" :class="{ open: isOpen(item, index) }" />
                </button>
                <div v-if="isOpen(item, index)" class="chihiro-bot-think-body">
                    <ul v-if="item.steps.length" class="chihiro-bot-think-steps">
                        <li v-for="(step, stepIndex) in item.steps" :key="stepIndex" :class="'is-' + step.kind">
                            <span class="ttl">{{ step.title }}</span>
                            <span v-if="step.detail" class="det">{{ step.detail }}</span>
                        </li>
                    </ul>
                    <p v-else-if="item.inProgress || (working && index === lastIndex)" class="chihiro-bot-history-lookup">
                        ChatBot 正在处理
                        <span class="chihiro-bot-history-dots" aria-hidden="true"><i /><i /><i /></span>
                    </p>
                </div>
                <ul v-if="item.points.length" class="chihiro-bot-history-points">
                    <li v-for="point in item.points" :key="point.id">
                        <button
                            v-if="point.messageId"
                            type="button"
                            class="chihiro-bot-history-point-link"
                            @click.stop="emit('jump-to-msg', point.messageId)">{{ point.text }}</button>
                        <span v-else>{{ point.text }}</span>
                    </li>
                </ul>
                <ul v-if="item.replies.length" class="chihiro-bot-history-chips">
                    <li v-for="reply in item.replies" :key="reply.id">{{ reply.text }}</li>
                </ul>
                <p v-if="item.summary" class="chihiro-bot-history-summary">{{ item.summary }}</p>
                <p v-if="item.sent" class="is-sent">已发送：{{ item.sent }}</p>
                <p v-else-if="item.skipped" class="is-skip">{{ skipLabel(item.skipped) }}</p>
            </article>
            <div v-if="working && !thread.some((row) => row.inProgress)" class="chihiro-bot-history-lookup">
                ChatBot 正在处理
                <span class="chihiro-bot-history-dots" aria-hidden="true"><i /><i /><i /></span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { faAngleLeft, faXmark } from '@fortawesome/free-solid-svg-icons'

library.add(faAngleLeft, faXmark)

type HistoryReply = { id: string; text: string; score: number }
type HistoryPoint = { id: string; text: string; messageId: string }
type HistoryStep = { kind: string; title: string; detail: string; at: number }
type HistoryItem = {
    id: string
    at: number
    inProgress: boolean
    trigger: 'auto' | 'menu' | 'digest'
    joinReason: string
    lastMessageId: string
    peerExcerpt: string
    lookupExcerpt: string
    replies: HistoryReply[]
    points: HistoryPoint[]
    summary: string
    sent: string
    skipped: string
    steps: HistoryStep[]
}

const props = defineProps<{
    accountId: string
    type: 'private' | 'group'
    peerId: string
    working?: boolean
    embedded?: boolean
    back?: boolean
}>()
const emit = defineEmits<{ close: []; 'jump-to-msg': [messageId: string] }>()

const items = ref<HistoryItem[]>([])
const loading = ref(false)
const openIds = ref<Record<string, boolean>>({})
const listEl = ref<HTMLElement | null>(null)
let stickToBottom = true
let pollTimer = 0

const thread = computed(() => [...items.value].reverse())
const lastIndex = computed(() => Math.max(0, thread.value.length - 1))

const JOIN_LABELS: Record<string, string> = {
    private: '私聊',
    at: '@我',
    question: '提问',
    request: '请求',
    'follow-up': '接话',
    'open-discussion': '多人讨论',
    skip: '未接话',
    unread: '未读',
}
const SKIP_LABELS: Record<string, string> = {
    join: '未接话',
    'empty-draft': '没有可发内容',
    'empty-digest': '没有可总结的内容',
    error: '生成失败',
    suggest: '生成失败',
    send: '发送失败',
}

function triggerLabel(value: string) {
    if (value === 'menu') return '手动'
    if (value === 'digest') return '总结'
    return '自动'
}
function processLabel(item: HistoryItem) {
    if (item.trigger === 'digest') return item.inProgress ? '正在总结' : '已总结'
    return item.inProgress ? '正在处理' : '已处理'
}
function joinLabel(value: string) {
    return JOIN_LABELS[value] || value
}
function skipLabel(value: string) {
    return SKIP_LABELS[value] || value
}
function formatTime(at: number) {
    if (!at) return ''
    const date = new Date(at)
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    const ss = String(date.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
}

function normalizeItem(raw: any): HistoryItem | null {
    if (!raw || typeof raw !== 'object' || !raw.id) return null
    return {
        id: String(raw.id),
        at: Number(raw.at) || 0,
        inProgress: raw.inProgress === true,
        trigger: raw.trigger === 'menu' ? 'menu' : raw.trigger === 'digest' ? 'digest' : 'auto',
        joinReason: String(raw.joinReason || ''),
        lastMessageId: String(raw.lastMessageId || ''),
        peerExcerpt: String(raw.peerExcerpt || ''),
        lookupExcerpt: String(raw.lookupExcerpt || ''),
        replies: Array.isArray(raw.replies) ? raw.replies : [],
        points: Array.isArray(raw.points) ? raw.points.flatMap((point: any) => {
            const text = String(point?.text || '').trim()
            if (!text) return []
            return [{
                id: String(point?.id || text),
                text,
                messageId: String(point?.messageId || point?.message_id || ''),
            }]
        }) : [],
        summary: String(raw.summary || ''),
        sent: String(raw.sent || ''),
        skipped: String(raw.skipped || ''),
        steps: Array.isArray(raw.steps) ? raw.steps : [],
    }
}

function isOpen(item: HistoryItem, index: number) {
    if (item.inProgress) return true
    if (openIds.value[item.id] === true) return true
    if (openIds.value[item.id] === false) return false
    return index === lastIndex.value
}

function toggleOpen(id: string, index: number) {
    const item = thread.value.find((row) => row.id === id)
    if (!item) return
    openIds.value = { ...openIds.value, [id]: !isOpen(item, index) }
}

function onScroll() {
    const el = listEl.value
    if (!el) return
    stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
}

async function scrollIfNeeded() {
    await nextTick()
    const el = listEl.value
    if (!el || !stickToBottom) return
    el.scrollTop = el.scrollHeight
}

function stopPoll() {
    if (!pollTimer) return
    window.clearInterval(pollTimer)
    pollTimer = 0
}

function startPoll() {
    if (pollTimer) return
    pollTimer = window.setInterval(() => { void load(true) }, 1200)
}

async function load(quiet = false) {
    if (!props.accountId || !props.peerId) return
    if (!quiet) loading.value = true
    try {
        const response = await fetch(
            `/api/runtime/bot/history?accountId=${encodeURIComponent(props.accountId)}&type=${encodeURIComponent(props.type)}&peerId=${encodeURIComponent(props.peerId)}`,
            { cache: 'no-store' },
        )
        const data = await response.json().catch(() => ({ items: [] }))
        items.value = Array.isArray(data?.items) ? data.items.flatMap((row: any) => {
            const item = normalizeItem(row)
            return item ? [item] : []
        }) : []
        if (props.working || items.value.some((row) => row.inProgress)) startPoll()
        else stopPoll()
        await scrollIfNeeded()
    } catch {
        if (!quiet) items.value = []
    } finally {
        if (!quiet) loading.value = false
    }
}

onMounted(() => { void load() })
onBeforeUnmount(() => { stopPoll() })
watch(() => [props.accountId, props.type, props.peerId].join(':'), () => {
    openIds.value = {}
    stickToBottom = true
    void load()
})
watch(() => props.working, (next, prev) => {
    if (next) startPoll()
    else {
        stopPoll()
        if (prev) void load()
    }
}, { immediate: true })
</script>

<style>
.chihiro-bot-history-pan {
    pointer-events: all;
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 26;
    display: flex;
    flex-direction: column;
    width: min(320px, 86%);
    background: var(--color-card);
    border-left: 1px solid rgba(127, 127, 127, 0.18);
    box-shadow: -12px 0 32px rgba(0, 0, 0, 0.18);
    color: var(--color-font);
}
.chihiro-bot-history-pan.is-embedded {
    position: relative;
    inset: auto;
    width: 100%;
    height: 100%;
    min-height: 0;
    z-index: auto;
    border-left: 0;
    box-shadow: none;
}
.chihiro-bot-history-pan > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 52px;
    min-height: 52px;
    padding: 0 10px 0 16px;
    border-bottom: 1px solid rgba(127, 127, 127, 0.12);
    font-size: 15px;
    font-weight: 650;
}
.chihiro-bot-history-pan > header > span {
    flex: 1;
}
.chihiro-bot-history-pan > header button {
    appearance: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-font);
    cursor: pointer;
}
.chihiro-bot-history-list {
    flex: 1;
    overflow: auto;
    padding: 12px 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.chihiro-bot-history-empty {
    margin: 24px 8px;
    color: var(--color-font-2);
    font-size: 13px;
    text-align: center;
}
.chihiro-bot-history-beat {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}
.chihiro-bot-history-beat.is-working .chihiro-bot-think-toggle {
    color: var(--color-main);
}
.chihiro-bot-think-toggle {
    appearance: none;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin: 0;
    padding: 2px 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
}
.chihiro-bot-think-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 650;
    flex: 0 0 auto;
}
.chihiro-bot-think-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--color-main);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-main) 45%, transparent);
    animation: chihiro-bot-think-pulse 1.2s ease-out infinite;
}
@keyframes chihiro-bot-think-pulse {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-main) 45%, transparent); }
    70% { box-shadow: 0 0 0 6px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
}
.chihiro-bot-think-caret {
    width: 7px;
    height: 7px;
    margin-left: auto;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(-45deg);
    opacity: 0.55;
    flex: 0 0 auto;
}
.chihiro-bot-think-caret.open {
    transform: rotate(45deg);
}
.chihiro-bot-think-body {
    margin: 0;
}
.chihiro-bot-history-peer {
    margin: 0;
    align-self: flex-start;
    max-width: 100%;
    padding: 7px 10px;
    border-radius: 4px 12px 12px 12px;
    background: rgba(127, 127, 127, 0.12);
    color: var(--color-font);
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
}
.chihiro-bot-think-steps {
    margin: 0 0 0 4px;
    padding: 0 0 0 2px;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-left: 1px solid rgba(127, 127, 127, 0.22);
}
.chihiro-bot-think-steps li {
    padding-left: 12px;
    color: var(--color-font-2);
    font-size: 12px;
    line-height: 1.45;
}
.chihiro-bot-think-steps li .ttl {
    display: block;
    color: var(--color-font);
}
.chihiro-bot-think-steps li .det {
    display: block;
    margin-top: 2px;
    word-break: break-word;
    white-space: pre-wrap;
}
.chihiro-bot-history-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--color-font-2);
    font-size: 11px;
}
.chihiro-bot-history-beat p {
    margin: 0;
    word-break: break-word;
}
.chihiro-bot-history-lookup {
    color: var(--color-font-2);
    font-size: 12px;
}
.chihiro-bot-history-points {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-self: stretch;
}
.chihiro-bot-history-points li {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    word-break: break-word;
}
.chihiro-bot-history-point-link {
    appearance: none;
    display: inline;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: #4c9fff;
    font: inherit;
    text-align: left;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
}
.chihiro-bot-history-point-link:hover {
    color: var(--color-main);
}
.chihiro-bot-history-chips {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-self: flex-end;
    max-width: 100%;
}
.chihiro-bot-history-chips li {
    padding: 6px 8px;
    border-radius: 12px 4px 12px 12px;
    background: color-mix(in srgb, var(--color-main) 16%, transparent);
    font-size: 12px;
}
.chihiro-bot-history-summary {
    align-self: flex-end;
    max-width: 100%;
    color: var(--color-font-2);
    font-size: 12px;
}
.chihiro-bot-history-beat .is-sent {
    align-self: flex-end;
    max-width: 100%;
    padding: 7px 10px;
    border-radius: 12px 4px 12px 12px;
    background: color-mix(in srgb, var(--color-main) 22%, transparent);
    color: var(--color-font);
    font-size: 12px;
    line-height: 1.45;
}
.chihiro-bot-history-beat .is-skip {
    color: var(--color-font-2);
    font-size: 12px;
}
.chihiro-bot-history-dots {
    display: inline-flex;
    align-items: center;
    gap: 3px;
}
.chihiro-bot-history-dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    animation: chihiro-bot-dot 1s infinite ease-in-out;
}
.chihiro-bot-history-dots i:nth-child(2) { animation-delay: 0.15s; }
.chihiro-bot-history-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes chihiro-bot-dot {
    0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-2px); }
}
@media (max-width: 700px) {
    .chihiro-bot-history-pan {
        width: 100%;
        background: color-mix(in srgb, var(--color-card) 96%, black);
    }
}
</style>
