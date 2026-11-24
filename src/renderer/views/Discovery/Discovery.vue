<template>
  <div>
    <FtCard class="discoveryCard">
      <div class="discoveryHeader">
        <div>
          <h2>
            <FontAwesomeIcon
              class="discoveryIcon"
              :icon="['fas', 'compass']"
            />
            {{ $t('Discovery.Discover') }}
          </h2>
          <p class="discoveryHint">
            {{ $t('Discovery.Discover Info') }}
          </p>
        </div>
        <FtButton
          :label="$t('Discovery.Refresh')"
          :icon="['fas', 'rotate-right']"
          :disabled="loading"
          @click="refresh"
        />
      </div>
      <p
        v-if="!account.signedIn || safetyMode"
        class="discoveryHint"
      >
        {{ $t('Discovery.Public Home') }}
      </p>
      <FtLoader v-if="loading && videos.length === 0" />
      <template v-else>
        <p
          v-if="loading"
          class="discoveryHint"
          role="status"
        >
          {{ $t('Discovery.Loading') }}
        </p>
        <p
          v-if="!error && homeUnavailable"
          class="discoveryHint"
          role="status"
        >
          {{ $t('Discovery.Home Unavailable') }}
        </p>
        <p
          v-if="!loading && !error && newCount > 0"
          class="discoveryHint"
          role="status"
        >
          {{ $t('Discovery.New Results', { count: newCount }) }}
        </p>
        <p
          v-if="!loading && !error && limited"
          class="discoveryHint"
          role="status"
        >
          {{ $t('Discovery.Limited Results') }}
        </p>
        <p
          v-if="error"
          class="discoveryHint"
          role="alert"
        >
          {{ $t('Discovery.Error') }}
        </p>
        <FtElementList
          v-if="videos.length > 0"
          :data="videos"
        />
      </template>
    </FtCard>
  </div>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import FtButton from '../../components/FtButton/FtButton.vue'
import FtCard from '../../components/ft-card/ft-card.vue'
import FtElementList from '../../components/FtElementList/FtElementList.vue'
import FtLoader from '../../components/FtLoader/FtLoader.vue'
import { getLocalRelatedRecommendations, getLocalSearchContinuation, getLocalSearchResults, openDiscoveryFeed } from '../../helpers/api/local'
import { createDiscoveryBrowser, createInterestSearch } from '../../helpers/api/discoveryFeed'
import store from '../../store/index'

const videos = shallowRef([])
const loading = ref(false)
const error = ref(false)
const homeUnavailable = ref(false)
const limited = ref(false)
const newCount = ref(null)
const account = computed(() => store.getters.getYouTubeAccount)
const safetyMode = computed(() => store.getters.getShowFamilyFriendlyOnly)
let generation = 0
let browser

function resetBrowser() {
  generation++
  videos.value = []
  error.value = false
  homeUnavailable.value = false
  limited.value = false
  newCount.value = null
  loading.value = false
  const search = createInterestSearch({
    search: query => getLocalSearchResults(query, { type: 'video' }, safetyMode.value),
    next: cursor => getLocalSearchContinuation(cursor),
  })
  browser = createDiscoveryBrowser({
    open: kind => openDiscoveryFeed(kind, safetyMode.value, account.value.signedIn),
    getHistory: () => store.getters.getHistoryCacheSorted,
    search,
    related: videoId => getLocalRelatedRecommendations(videoId, safetyMode.value),
  })
  refresh()
}

async function refresh() {
  if (loading.value) return
  const requestGeneration = generation
  loading.value = true
  error.value = false
  try {
    const result = await browser.refresh()
    if (generation === requestGeneration) {
      videos.value = result
      const status = browser.getStatus()
      homeUnavailable.value = !status.homeAvailable
      limited.value = status.limited
      newCount.value = status.newCount
    }
  } catch (err) {
    if (generation === requestGeneration) error.value = true
    console.error('Could not load YouTube discovery content', err)
  } finally {
    if (generation === requestGeneration) loading.value = false
  }
}

onMounted(resetBrowser)
watch([() => account.value.signedIn, () => account.value.channelId, safetyMode], resetBrowser)
onBeforeUnmount(() => { generation++ })
</script>

<style scoped src="./Discovery.css" />
