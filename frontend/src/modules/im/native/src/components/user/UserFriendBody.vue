<!--
 * @FileDescription: 联系人 / 消息列表项模板
 * @Author: Stapxs
 * @Date: 2022/08/14
 * @Version: 1.0
-->

<template>
    <div :id="'user-' + (data.user_id ?? data.group_id)"
        :class="'friend-body' + (select ? ' active' : menu ? ' onmenu' : '')"
        :data-name="data.user_id ? data.nickname : data.group_name"
        :data-nickname="data.user_id ? data.nickname : ''"
        :data-type="data.user_id ? 'friend' : 'group'">
        <div :class="data.new_msg === true ? 'new' : ''" />
        <font-awesome-icon v-if="data.user_id == -10000" :icon="['fas', 'bell']" />
        <font-awesome-icon v-else-if="data.user_id == -10001" :icon="['fas', 'user-group']" />
        <div v-else-if="botMark" class="chihiro-bot-avatar" :class="'is-' + botMark.mode">
            <img loading="lazy" :title="sessionName" :src="avatarSrc">
            <span class="chihiro-bot-badge" :class="{ working: botMark.working }">
                <template v-if="botMark.working"><i /><i /><i /></template>
                <template v-else>BOT</template>
            </span>
        </div>
        <img v-else loading="lazy" :title="sessionName" :src="avatarSrc">
        <div>
            <div>
                <p>{{ sessionName }}</p>
                <a class="time">{{ formatSessionTime(data.time) }}</a>
            </div>
            <div>
                <a v-if="data.highlight" class="highlight">
                    {{ data.highlight }}
                </a>
                <a :class="from == 'friend' ? 'nick' : ''">{{
                    from == 'friend' ? (data.longNick ?? '') : previewText
                }}</a>
                <div v-if="from == 'message'" class="chihiro-session-meta">
                    <font-awesome-icon
                        v-if="data.always_top === true"
                        class="chihiro-pin"
                        :icon="['fas', 'thumbtack']" />
                    <span v-if="unreadCount > 0" class="chihiro-unread">{{ unreadLabel }}</span>
                    <font-awesome-icon
                        v-else-if="muted"
                        class="chihiro-muted"
                        :icon="['fas', 'bell-slash']" />
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { library } from '@fortawesome/fontawesome-svg-core'
import { faBellSlash, faThumbTack } from '@fortawesome/free-solid-svg-icons'
import { formatSessionTime } from '@renderer/function/utils/systemUtil'
import { getShowName, isSessionMuted } from '@renderer/function/utils/msgUtil'
import { useSuggestStore } from '@/modules/assistant/suggest'

library.add(faBellSlash, faThumbTack)

defineOptions({ name: 'UserFriendBody' })

const props = defineProps<{
    data: any
    select?: boolean
    menu?: boolean
    from?: string
}>()

const suggest = useSuggestStore()
const sessionName = computed(() => getShowName(props.data?.group_name || props.data?.nickname, props.data?.remark))
const previewText = computed(() => String(props.data?.raw_msg || ''))
const avatarSrc = computed(() => props.data?.user_id
    ? 'https://q1.qlogo.cn/g?b=qq&s=0&nk=' + props.data.user_id
    : 'https://p.qlogo.cn/gh/' + props.data.group_id + '/' + props.data.group_id + '/0')
const botMark = computed(() => {
    if (props.from !== 'message') return null
    const userId = Number(props.data?.user_id)
    if (userId === -10000 || userId === -10001) return null
    const type = props.data?.group_id ? 'group' as const : 'private' as const
    const peerId = String(props.data?.group_id ?? props.data?.user_id ?? '')
    if (!/^\d+$/.test(peerId)) return null
    return suggest.listMark(type, peerId)
})

const unreadCount = computed(() => {
    const n = Number(props.data?.unread)
    if (n > 0) return n
    return props.data?.new_msg ? 1 : 0
})
const unreadLabel = computed(() => unreadCount.value > 99 ? '99+' : String(unreadCount.value))
const muted = computed(() => isSessionMuted(props.data || {}))

</script>


<style>
/* chihiro-moved-from-user-css */
#base-app .friend-body {
    margin: 2px 8px !important;
    padding: 6px 8px !important;
    min-height: 54px;
    align-items: center;
    border-radius: 10px !important;
}
#base-app .friend-body img,
#base-app .friend-body > svg {
    width: 36px !important;
    height: 36px !important;
    border-radius: 50% !important;
    border: 0 !important;
    padding: 0 !important;
    box-sizing: border-box !important;
}
#base-app .friend-body > svg {
    padding: 8px !important;
    background: var(--color-card-2) !important;
}
#base-app .friend-body > div:nth-child(1) {
    display: none !important;
}
#base-app .friend-body > .chihiro-bot-avatar {
    position: relative;
    flex: none !important;
    width: 36px;
    height: 36px;
    margin: 0 !important;
    overflow: visible !important;
}
#base-app .friend-body > .chihiro-bot-avatar img {
    width: 36px !important;
    height: 36px !important;
    display: block;
}
.chihiro-bot-badge {
    position: absolute;
    right: -3px;
    bottom: -3px;
    z-index: 1;
    min-width: 20px;
    height: 12px;
    padding: 0 3px;
    box-sizing: border-box;
    border: 1.5px solid var(--color-card);
    border-radius: 6px;
    color: #fff;
    font-size: 8px;
    font-weight: 800;
    letter-spacing: 0.02em;
    line-height: 9px;
    text-align: center;
    pointer-events: none;
}
.chihiro-bot-avatar.is-assist .chihiro-bot-badge {
    background: var(--color-main);
}
.chihiro-bot-avatar.is-auto .chihiro-bot-badge {
    background: #e08a1e;
}
#base-app .friend-body.active .chihiro-bot-badge {
    border-color: var(--color-main);
}
#base-app .friend-body.active .chihiro-bot-avatar.is-assist .chihiro-bot-badge {
    background: #fff;
    color: var(--color-main);
}
.chihiro-bot-badge.working {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-width: 18px;
    padding: 0 4px;
    letter-spacing: 0;
}
.chihiro-bot-badge.working i {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
    animation: chihiro-bot-dot 1s infinite ease-in-out;
}
.chihiro-bot-badge.working i:nth-child(2) { animation-delay: 0.15s; }
.chihiro-bot-badge.working i:nth-child(3) { animation-delay: 0.3s; }
@keyframes chihiro-bot-dot {
    0%, 80%, 100% { opacity: 0.28; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-1px); }
}
#base-app .friend-body > div {
    margin-left: 10px;
    min-width: 0;
}
#base-app .friend-body > div > div {
    min-width: 0;
    gap: 8px;
}
#base-app .friend-body p {
    flex: 1 1 0;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    margin-top: 0 !important;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#base-app .friend-body > div > div a {
    font-size: 12px;
    min-width: 0;
}
#base-app .friend-body > div > div a.time {
    flex: 0 0 auto;
    min-width: max-content;
    margin-left: 0;
    overflow: visible;
    text-overflow: unset;
    white-space: nowrap;
}
#base-app .friend-body.active {
    background: var(--color-main) !important;
    color: #fff !important;
}
#base-app .friend-body.active p,
#base-app .friend-body.active a,
#base-app .friend-body.active > div > div a,
#base-app .friend-body.active > a {
    color: #fff !important;
}
#base-app .friend-body.active > svg {
    background: rgba(255, 255, 255, 0.2) !important;
    color: #fff !important;
}
#base-app .friend-body:hover {
    background: rgba(127, 127, 127, 0.16) !important;
}
#base-app .friend-body.active:hover {
    background: var(--color-main) !important;
}
.chihiro-session-meta {
    margin-left: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    justify-content: flex-end;
}
#base-app .friend-body .chihiro-session-meta svg {
    width: 12px !important;
    height: 12px !important;
    margin: 0 !important;
    opacity: 0.75;
    flex: none !important;
}
#base-app .friend-body .chihiro-pin {
    transform: rotate(45deg) !important;
    color: var(--color-font-2);
}
#base-app .friend-body .chihiro-muted {
    transform: none !important;
    color: #8e8e93 !important;
}
.chihiro-unread {
    min-width: 16px;
    height: 16px;
    padding: 0 5px;
    box-sizing: border-box;
    border-radius: 999px;
    background: #8e8e93;
    color: #fff !important;
    font-size: 10px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    white-space: nowrap;
    flex: none !important;
    overflow: visible !important;
    opacity: 1 !important;
}
#base-app .friend-body.active .chihiro-unread {
    background: rgba(255, 255, 255, 0.42);
    color: #fff !important;
}
#base-app .friend-body.active .chihiro-pin,
#base-app .friend-body.active .chihiro-muted {
    color: rgba(255, 255, 255, 0.85) !important;
}

@media (max-width: 700px) {
    #base-app .friend-body {
        justify-content: flex-start !important;
        margin: 2px 8px !important;
        padding: 6px 8px !important;
        min-height: 54px;
    }
    #base-app .friend-body > div {
        display: block !important;
        flex: 1;
        overflow: hidden;
        margin-left: 10px;
    }
    #base-app .friend-body > div:nth-child(1) {
        display: none !important;
    }
    #base-app .friend-body > .chihiro-bot-avatar {
        flex: none !important;
        margin: 0 !important;
    }
    #base-app .friend-body img,
    #base-app .friend-body > svg {
        width: 36px !important;
        height: 36px !important;
    }
}
</style>
