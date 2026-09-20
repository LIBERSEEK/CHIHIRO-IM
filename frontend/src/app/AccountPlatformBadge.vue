<script setup lang="ts">
import type { AccountPlatform } from '@/contracts'
import { computed } from 'vue'
import { accountPlatformBrand } from '@/app/account-ui'

const props = defineProps<{
  platform: AccountPlatform
}>()

const brand = computed(() => accountPlatformBrand(props.platform))
</script>

<template>
  <span
    v-if="brand"
    class="account-platform-badge"
    :data-platform="brand.platform"
    :data-slug="brand.slug"
    :title="brand.title"
    :style="{ background: `#${brand.hex}` }"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path :d="brand.path" fill="currentColor" />
    </svg>
  </span>
</template>
