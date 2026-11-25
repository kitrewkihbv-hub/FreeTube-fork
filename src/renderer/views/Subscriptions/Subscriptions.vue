<template>
  <div>
    <FtCard class="card">
      <h2>
        <FontAwesomeIcon
          :icon="['fas', 'rss']"
          class="subscriptionIcon"
        />
        {{ $t("Subscriptions.Subscriptions") }}
      </h2>
      <FtFlexBox
        class="tabs"
        role="tablist"
        :aria-label="$t('Subscriptions.Subscriptions Tabs')"
      >
        <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
        <div
          v-if="!hideSubscriptionsVideos"
          ref="videosTab"
          class="tab"
          role="tab"
          :aria-selected="currentTab === 'videos'"
          aria-controls="subscriptionsPanel"
          :tabindex="currentTab === 'videos' ? 0 : -1"
          :class="{ selectedTab: currentTab === 'videos' }"
          @click="changeTab('videos')"
          @keydown.space.enter.prevent="changeTab('videos')"
          @keydown.left.right="focusTab($event, 'videos')"
        >
          <FontAwesomeIcon
            :icon="['fa', 'video']"
            class="subscriptionIcon"
          />
          {{ $t("Global.Videos") }}
        </div>
        <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
        <div
          v-if="!hideSubscriptionsShorts"
          ref="shortsTab"
          class="tab"
          role="tab"
          :aria-selected="currentTab === 'shorts'"
          aria-controls="subscriptionsPanel"
          :tabindex="currentTab === 'shorts' ? 0 : -1"
          :class="{ selectedTab: currentTab === 'shorts' }"
          @click="changeTab('shorts')"
          @keydown.space.enter.prevent="changeTab('shorts')"
          @keydown.left.right="focusTab($event, 'shorts')"
        >
          <FontAwesomeIcon
            :icon="['fa', 'clapperboard']"
            class="subscriptionIcon"
          />
          {{ $t("Global.Shorts") }}
        </div>
        <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
        <div
          v-if="!hideSubscriptionsLive"
          ref="liveTab"
          class="tab"
          role="tab"
          :aria-selected="currentTab === 'live'"
          aria-controls="subscriptionsPanel"
          :tabindex="currentTab === 'live' ? 0 : -1"
          :class="{ selectedTab: currentTab === 'live' }"
          @click="changeTab('live')"
          @keydown.space.enter.prevent="changeTab('live')"
          @keydown.left.right="focusTab($event, 'live')"
        >
          <FontAwesomeIcon
            :icon="['fa', 'tower-broadcast']"
            class="subscriptionIcon"
          />
          {{ $t("Global.Live") }}
        </div>
        <!-- eslint-disable-next-line vuejs-accessibility/interactive-supports-focus -->
        <div
          v-if="!hideSubscriptionsCommunity"
          ref="communityTab"
          class="tab"
          role="tab"
          :aria-selected="currentTab === 'community'"
          aria-controls="subscriptionsPanel"
          :tabindex="currentTab === 'community' ? 0 : -1"
          :class="{ selectedTab: currentTab === 'community' }"
          @click="changeTab('community')"
          @keydown.space.enter.prevent="changeTab('community')"
          @keydown.left.right="focusTab($event, 'community')"
        >
          <FontAwesomeIcon
            :icon="['fa', 'message']"
            class="subscriptionIcon"
          />
          {{ $t("Global.Posts") }}
        </div>
      </FtFlexBox>
      <div
        v-if="isSignedInToYouTubeAccount && currentTab === 'videos'"
        class="feedChoice"
      >
        <span>{{ $t('Subscriptions.Feed Source') }}</span>
        <FtButton
          :label="showYouTubeAccountFeed ? $t('Subscriptions.Switch to Local Feed') : $t('Subscriptions.Switch to YouTube Feed')"
          :icon="['fas', 'rotate']"
          @click="switchFeedSource"
        />
      </div>
      <SubscriptionsVideos
        v-if="currentTab === 'videos' && !showYouTubeAccountFeed"
        id="subscriptionsPanel"
        role="tabpanel"
      />
      <SubscriptionsShorts
        v-else-if="currentTab === 'shorts'"
        id="subscriptionsPanel"
        role="tabpanel"
      />
      <SubscriptionsLive
        v-else-if="currentTab === 'live'"
        id="subscriptionsPanel"
        role="tabpanel"
      />
      <SubscriptionsPosts
        v-else-if="currentTab === 'community'"
        id="subscriptionsPanel"
        role="tabpanel"
      />
      <div
        v-else-if="showYouTubeAccountFeed"
        id="subscriptionsPanel"
        class="accountFeed"
        role="tabpanel"
      >
        <div class="accountFeedHeader">
          <p class="accountFeedInfo">
            {{ $t('Subscriptions.YouTube Account Feed Info') }}
          </p>
          <FtButton
            :label="$t('Subscriptions.Refresh')"
            :icon="['fas', 'rotate']"
            :disabled="accountFeedLoading"
            @click="refreshAccountFeed"
          />
        </div>
        <FtLoader v-if="accountFeedLoading && accountFeed.length === 0" />
        <template v-else>
          <p
            v-if="accountFeedLoading"
            class="accountFeedInfo"
            role="status"
          >
            {{ $t('Subscriptions.YouTube Account Feed Refreshing') }}
          </p>
          <p
            v-if="accountFeedError"
            class="accountFeedInfo"
            role="alert"
          >
            {{ accountFeed.length > 0 ? $t('Subscriptions.YouTube Account Feed Refresh Error') : $t('Subscriptions.YouTube Account Feed Error') }}
          </p>
          <p
            v-if="!accountFeedError && !accountFeedLoading && accountFeed.length === 0"
            class="accountFeedInfo"
          >
            {{ $t('Subscriptions.YouTube Account Feed Empty') }}
          </p>
          <template v-if="accountFeed.length > 0">
            <p
              v-if="!accountFeedError && !accountFeedLoading && accountRefreshStatus === 'new'"
              class="accountFeedInfo"
              role="status"
            >
              {{ $t('Subscriptions.Account Feed New Results', { count: accountNewCount }) }}
            </p>
            <p
              v-if="!accountFeedError && !accountFeedLoading && accountRefreshStatus === 'rotated'"
              class="accountFeedInfo"
              role="status"
            >
              {{ $t('Subscriptions.Account Feed Rotated') }}
            </p>
            <p
              v-if="!accountFeedError && !accountFeedLoading && (accountRefreshStatus === 'cached' || accountRefreshStatus === 'cachedRotated')"
              class="accountFeedInfo"
              role="status"
            >
              {{ $t('Subscriptions.Account Feed Cooldown') }}
            </p>
            <p
              v-if="!accountFeedError && !accountFeedLoading && accountRefreshStatus === 'unchanged'"
              class="accountFeedInfo"
              role="status"
            >
              {{ $t('Subscriptions.Account Feed Unchanged') }}
            </p>
            <FtButton
              v-if="accountFeedOffset > 0"
              :label="$t('Subscriptions.Restore Feed Order')"
              @click="restoreAccountFeedOrder"
            />
            <p
              v-if="accountFeedInfo?.source === 'channelUploads' || accountFeedInfo?.source === 'mixed'"
              class="accountFeedInfo"
              role="status"
            >
              {{ $t('Subscriptions.Channel Uploads Fallback', { count: accountFeedInfo.channelCount, failed: accountFeedInfo.failedChannelCount }) }}
            </p>
            <p
              v-else-if="accountFeedInfo?.partial"
              class="accountFeedInfo"
              role="status"
            >
              {{ $t('Subscriptions.Account Feed Partial') }}
            </p>
            <FtElementList
              :data="displayedAccountFeed"
              :use-channels-hidden-preference="false"
            />
          </template>
        </template>
      </div>
      <p v-else>
        {{ $t("Subscriptions.All Subscription Tabs Hidden", {
          subsection: $t('Settings.Distraction Free Settings.Sections.Subscriptions Page'),
          settingsSection: $t('Settings.Distraction Free Settings.Distraction Free Settings')
        }) }}
      </p>
    </FtCard>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'

import FtCard from '../../components/ft-card/ft-card.vue'
import FtFlexBox from '../../components/ft-flex-box/ft-flex-box.vue'
import FtButton from '../../components/FtButton/FtButton.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import SubscriptionsVideos from '../../components/SubscriptionsVideos.vue'
import SubscriptionsLive from '../../components/SubscriptionsLive.vue'
import SubscriptionsShorts from '../../components/SubscriptionsShorts.vue'
import SubscriptionsPosts from '../../components/SubscriptionPosts/SubscriptionsPosts.vue'

import store from '../../store/index'

/** @type {import('vue').ComputedRef<boolean>} */
const isSignedInToYouTubeAccount = computed(() => {
  return store.getters.getIsSignedInToYouTubeAccount
})

/** @type {import('vue').ComputedRef<boolean>} */
const useYouTubeAccountFeed = computed(() => {
  return store.getters.getUseYouTubeAccountFeed
})

/** @type {import('vue').ComputedRef<boolean>} */
const accountFeedInfo = computed(() => store.getters.getYouTubeAccountFeedInfo)

/** @type {import('vue').ComputedRef<object[]|null>} */
const accountFeedCache = computed(() => {
  return store.getters.getYouTubeAccountFeed
})

/** @type {import('vue').Ref<'videos' | 'shorts' | 'live' | 'community' | null>} */
const currentTab = ref('videos')

/**
 * The account feed replaces the "videos" tab when the user signed in and opted in to use it.
 * The other tabs (Shorts, live, posts) only exist in FreeTube's own subscriptions feed.
 */
const showYouTubeAccountFeed = computed(() => {
  return isSignedInToYouTubeAccount.value && useYouTubeAccountFeed.value && currentTab.value === 'videos'
})

function switchFeedSource() {
  store.dispatch('updateUseYouTubeAccountFeed', !useYouTubeAccountFeed.value)
}

const accountFeedError = ref(false)
const accountFeedLoading = ref(false)
const accountFeedOffset = ref(0)
const accountRefreshStatus = ref(null)
const accountNewCount = ref(0)
const ACCOUNT_FEED_MAX_AGE_MS = 5 * 60 * 1000
const ACCOUNT_FEED_RETRY_DELAY_MS = 60 * 1000
let lastAccountFeedAttemptAt = 0
let refreshTimer

/** @type {import('vue').ComputedRef<object[]>} */
const accountFeed = computed(() => {
  return accountFeedCache.value ?? []
})

// Keep the cached YouTube order intact; only the visible order is changed.
const displayedAccountFeed = computed(() => {
  const feed = accountFeed.value
  const offset = feed.length ? accountFeedOffset.value % feed.length : 0
  return offset ? [...feed.slice(offset), ...feed.slice(0, offset)] : feed
})

function restoreAccountFeedOrder() {
  accountFeedOffset.value = 0
  accountRefreshStatus.value = null
}

async function requestAccountFeed(refresh = false, manual = false) {
  const previousIds = new Set(accountFeed.value.map(video => video.videoId).filter(Boolean))
  const previousInfo = accountFeedInfo.value
  accountFeedError.value = false
  accountFeedLoading.value = true
  lastAccountFeedAttemptAt = Date.now()
  try {
    await store.dispatch('grabYouTubeAccountFeed', { refresh, manual })
    // A subscription change or sign-out can invalidate this request while it runs.
    if (accountFeedCache.value !== null) {
      if (manual) {
        const feed = accountFeedCache.value
        accountNewCount.value = feed.filter(video => video.videoId && !previousIds.has(video.videoId)).length
        if (accountNewCount.value > 0) {
          accountFeedOffset.value = 0
          accountRefreshStatus.value = 'new'
        } else if (feed.length > 1) {
          const step = Math.min(20, Math.max(1, Math.floor(feed.length / 2)))
          accountFeedOffset.value = (accountFeedOffset.value + step) % feed.length
          accountRefreshStatus.value = accountFeedInfo.value === previousInfo
            ? (accountFeedOffset.value ? 'cachedRotated' : 'cached')
            : (accountFeedOffset.value ? 'rotated' : 'unchanged')
        } else {
          accountFeedOffset.value = 0
          accountRefreshStatus.value = accountFeedInfo.value === previousInfo ? 'cached' : 'unchanged'
        }
      } else {
        restoreAccountFeedOrder()
      }
    }
  } catch (error) {
    accountFeedError.value = true
    console.error('failed to load the YouTube account feed', error)
  } finally {
    accountFeedLoading.value = false
    // A subscription change can invalidate the feed while a request is in flight.
    if (!accountFeedError.value && showYouTubeAccountFeed.value && accountFeedCache.value === null) loadAccountFeed()
  }
}

function loadAccountFeed() {
  if (!showYouTubeAccountFeed.value || accountFeedLoading.value) return
  const hasCachedFeed = accountFeedCache.value !== null
  const fetchedAt = accountFeedInfo.value?.fetchedAt ?? 0
  const isStale = Date.now() - fetchedAt >= ACCOUNT_FEED_MAX_AGE_MS
  if (hasCachedFeed && !isStale) return
  if (accountFeedError.value && Date.now() - lastAccountFeedAttemptAt < ACCOUNT_FEED_RETRY_DELAY_MS) return
  requestAccountFeed(hasCachedFeed)
}

function refreshAccountFeed() {
  if (!accountFeedLoading.value) requestAccountFeed(true, true)
}

watch(accountFeedCache, value => {
  if (value !== null) {
    accountFeedError.value = false
  } else {
    restoreAccountFeedOrder()
    if (showYouTubeAccountFeed.value && !accountFeedLoading.value) loadAccountFeed()
  }
})

watch(showYouTubeAccountFeed, (value) => {
  if (value) {
    loadAccountFeed()
  }
})

// The feed has to be requested after the app has finished loading the account details
watch(isSignedInToYouTubeAccount, (value) => {
  if (value) {
    loadAccountFeed()
  }
})

function refreshAccountFeedWhenVisible() {
  if (document.visibilityState !== 'hidden') loadAccountFeed()
}

onMounted(() => {
  loadAccountFeed()
  // Refresh while this page is open, and when the app returns from the background.
  refreshTimer = window.setInterval(refreshAccountFeedWhenVisible, 60 * 1000)
  window.addEventListener('focus', refreshAccountFeedWhenVisible)
  document.addEventListener('visibilitychange', refreshAccountFeedWhenVisible)
})

onBeforeUnmount(() => {
  window.clearInterval(refreshTimer)
  window.removeEventListener('focus', refreshAccountFeedWhenVisible)
  document.removeEventListener('visibilitychange', refreshAccountFeedWhenVisible)
})

// The cached feed belongs to the account that signed in, so it is not reused after signing out
watch(isSignedInToYouTubeAccount, (signedIn, wasSignedIn) => {
  if (wasSignedIn === true && signedIn === false) {
    store.dispatch('clearYouTubeAccountFeed')
  }
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsVideos = computed(() => {
  return store.getters.getHideSubscriptionsVideos
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsShorts = computed(() => {
  return store.getters.getHideSubscriptionsShorts
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsLive = computed(() => {
  return store.getters.getHideLiveStreams || store.getters.getHideSubscriptionsLive
})

/** @type {import('vue').ComputedRef<boolean>} */
const hideSubscriptionsCommunity = computed(() => {
  return store.getters.getHideSubscriptionsCommunity
})

watch(currentTab, (value) => {
  if (value !== null) {
  // Save last used tab, restore when view mounted again
    sessionStorage.setItem('Subscriptions/currentTab', value)
  } else {
    sessionStorage.removeItem('Subscriptions/currentTab')
  }
})

const visibleTabs = computed(() => {
  /** @type {('videos' | 'shorts' | 'live' | 'community')[]} */
  const tabs = []

  if (!hideSubscriptionsVideos.value) {
    tabs.push('videos')
  }

  if (!hideSubscriptionsShorts.value) {
    tabs.push('shorts')
  }

  if (!hideSubscriptionsLive.value) {
    tabs.push('live')
  }

  if (!hideSubscriptionsCommunity.value) {
    tabs.push('community')
  }

  return tabs
})

watch(visibleTabs, (value) => {
  if (value.length === 0) {
    currentTab.value = null
  } else if (!value.includes(currentTab.value)) {
    currentTab.value = value[0]
  }
})

if (visibleTabs.value.length === 0) {
  currentTab.value = null
} else {
  // Restore currentTab
  const lastCurrentTabId = sessionStorage.getItem('Subscriptions/currentTab')
  if (lastCurrentTabId !== null) {
    changeTab(lastCurrentTabId)
  } else if (!visibleTabs.value.includes(currentTab.value)) {
    currentTab.value = visibleTabs.value[0]
  }
}

/**
 * @param {'videos' | 'shorts' | 'live' | 'community'} tab
 */
function changeTab(tab) {
  if (tab === currentTab.value) {
    return
  }

  if (visibleTabs.value.includes(tab)) {
    currentTab.value = tab
  } else {
    // First visible tab or no tab
    currentTab.value = visibleTabs.value.length > 0 ? visibleTabs.value[0] : null
  }
}

const videosTab = useTemplateRef('videosTab')
const liveTab = useTemplateRef('liveTab')
const shortsTab = useTemplateRef('shortsTab')
const communityTab = useTemplateRef('communityTab')

/**
 * @param {KeyboardEvent} event
 * @param {'videos' | 'shorts' | 'live' | 'community'} focusedTab
 */
function focusTab(event, focusedTab) {
  if (event.altKey) {
    return
  }

  event.preventDefault()

  const visibleTabsCached = visibleTabs.value

  if (visibleTabsCached.length === 1) {
    store.commit('setOutlinesHidden', false)
    return
  }

  let index = visibleTabsCached.indexOf(focusedTab)

  if (event.key === 'ArrowLeft') {
    index--
  } else {
    index++
  }

  if (index < 0) {
    index = visibleTabsCached.length - 1
  } else if (index > visibleTabsCached.length - 1) {
    index = 0
  }

  switch (visibleTabsCached[index]) {
    case 'videos':
      videosTab.value?.focus()
      break
    case 'live':
      liveTab.value?.focus()
      break
    case 'shorts':
      shortsTab.value?.focus()
      break
    case 'community':
      communityTab.value?.focus()
      break
  }

  store.commit('setOutlinesHidden', false)
}
</script>

<style scoped src="./Subscriptions.css" />
