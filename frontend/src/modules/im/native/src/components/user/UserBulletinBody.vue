<!--
 * @FileDescription: 公告列表项模板
 * @Author: Stapxs
 * @Date: 2022-12-01
 * @Version: 1.0
-->

<template>
    <div class="base">
        <header @click="toggleExpand">
            <font-awesome-icon :icon="['fas', 'bookmark']" />
            <span>{{ $t('公告') }}</span>
            <div style="flex: 1" />
            <span>{{ Intl.DateTimeFormat(trueLang, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
            }).format(data.time) }}</span>
        </header>
        <div :id="'bulletins-msg-' + index"
            :class="'body' + (!showAll ? '' : ' all')"
            @click.stop="onBodyClick">
            <span
                style="margin-right: auto;margin-bottom: auto;"
                @click="textClick"
                v-html="parseText(noticeBody)" />
            <img v-if="data.img"
                :src="data.img.src"
                :class="{
                    img: true,
                    all: showAll,
                }"
                @click.stop="imgClick(data.img)">
        </div>
        <span v-show="needShow && !showAll" @click.stop="showAll = true">{{ $t('点击展开') }}</span>
        <div class="info" @click.stop>
            <img :src="'https://q1.qlogo.cn/g?b=qq&s=0&nk=' + data.sender">
            <a>{{
                chatStore.chatInfo.info.group_members.filter((item) => {
                    return Number(item.user_id) === Number(data.sender)
                })[0].nickname
            }}</a>
            <div />
            <span v-if="data.is_read">{{
                $t('{readNum} 人已读 | {isRead}', {
                    isRead: data.is_read ? $t('已读') : $t('未读'),
                    readNum: data.read_num,
                })
            }}</span>
        </div>
    </div>
</template>

<script lang="ts" setup>
    import xss from 'xss'
    import { ref, computed, onMounted, onBeforeUnmount, nextTick, inject } from 'vue'
    import { openLink } from '@renderer/function/utils/appUtil'
    import { getTrueLang } from '@renderer/function/utils/systemUtil'
    import { i18n } from '@chihiro/im-native/host'
    import { decodeNoticeHtml, noticeRawText } from '@chihiro/im-native/notice-text'
    import { Img } from '@renderer/function/model/img'
    import { useChatStore } from '@renderer/state/chat'

    defineOptions({ name: 'UserBulletinBody' })

    const $t = i18n.global.t
    const chatStore = useChatStore()

    const props = defineProps<{
        data: any
        index: number
    }>()

    const { viewer: viewerRef } = inject<{ viewer: any }>('viewer', { viewer: null })

    const trueLang = getTrueLang()
    const showAll = ref(false)
    const needShow = ref(true)
    const noticeBody = computed(() => noticeRawText(props.data))
    let overflowObserver: IntersectionObserver | null = null

    function measureOverflow() {
        const pan = document.getElementById('bulletins-msg-' + props.index)
        if (!pan) return false
        const style = getComputedStyle(pan)
        if (style.display === 'none') return false
        const maxHeight = parseFloat(style.maxHeight)
        if (!Number.isFinite(maxHeight) || maxHeight <= 0) {
            needShow.value = false
            return true
        }
        needShow.value = pan.scrollHeight > maxHeight + 1
        return pan.offsetHeight > 0
    }

    onMounted(() => {
        nextTick(() => {
            if (measureOverflow()) return
            const pan = document.getElementById('bulletins-msg-' + props.index)
            if (!pan || typeof IntersectionObserver === 'undefined') return
            overflowObserver = new IntersectionObserver((entries) => {
                if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
                    measureOverflow()
                    overflowObserver?.disconnect()
                    overflowObserver = null
                }
            })
            overflowObserver.observe(pan)
        })
    })

    onBeforeUnmount(() => {
        overflowObserver?.disconnect()
        overflowObserver = null
    })

    function parseText(text: string) {
        text = decodeNoticeHtml(text)
            .replaceAll('\r', '\n')
            .replaceAll('\n\n', '\n')
        text = xss(text, { whiteList: { a: ['href', 'target'] } })
        // 匹配链接
        const reg = /(http|https):\/\/[\w\-_]+(\.[\w\-_]+)+([\w\-.,@?^=%&:/~+#]*[\w\-@?^=%&/~+#])?/gi
        text = text.replaceAll(reg, '<a href="" data-link="$&" onclick="return false">$&</a>')
        return text
    }

    function toggleExpand() {
        showAll.value = !showAll.value
    }

    function onBodyClick(event: MouseEvent) {
        const target = event.target as HTMLElement
        if (target.dataset?.link) return
        if (!showAll.value) showAll.value = true
    }

    function textClick(event: Event) {
        const target = event.target as HTMLElement
        if (target.dataset.link) {
            event.stopPropagation()
            openLink(target.dataset.link)
        }
    }

    /**
     * 图片点击
     * @param img
     */
    function imgClick(img: Img) {
        if (viewerRef?.value) {
            viewerRef.value.open(img)
        }
    }
</script>

<style>
.bulletins > div.base > header,
.bulletins > div.base > span {
    cursor: pointer;
}
.bulletins > div.base > div.body,
.bulletins > div.base > div.body > span {
    -webkit-user-select: text;
    user-select: text;
}
.bulletins > div.base > div.body:not(.all) {
    cursor: pointer;
}
.bulletins > div.base > div.body.all,
.bulletins > div.base > div.body.all > span {
    cursor: text;
}
</style>
