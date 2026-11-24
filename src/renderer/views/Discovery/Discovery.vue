<template>
  <div>
    <FtCard class="discoveryCard">
      <div class="discoveryHeader">
        <div>
          <h2>
            <FontAwesomeIcon
              class="discoveryIcon"
              :icon="kind === 'live' ? ['fas', 'tower-broadcast'] : ['fas', 'compass']"
            />
            {{ kind === 'live' ? $t('Discovery.Live') : $t('Discovery.Discover') }}
          </h2>
          <p class="discoveryHint">
            {{ kind === 'live' ? $t('Discovery.Live Info') : $t('Discovery.Discover Info') }}
          </p>
        </div>
        <FtButton
          :label="$t('Discovery.Refresh')"
          :icon="['fas', 'rotate']"
          :disabled="loading"
          @click="refresh"
        />
      </div>
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
import { openDiscoveryFeed } from '../../helpers/api/local'
import { createDiscoveryBrowser } from '../../helpers/api/discoveryFeed'
import store from '../../store/index'

const props = defineProps({
  kind: { type: String, required: true },
})

const videos = shallowRef([])
const loading = ref(false)
const error = ref(false)
const account = computed(() => store.getters.getYouTubeAccount)
const safetyMode = computed(() => store.getters.getShowFamilyFriendlyOnly)
let generation = 0
let browser

function resetBrowser() {
  generation++
  videos.value = []
  error.value = false
  loading.value = false
  browser = createDiscoveryBrowser({ kind: props.kind, open: kind => openDiscoveryFeed(kind, safetyMode.value) })
  refresh()
}

async function refresh() {
  if (loading.value) return
  const requestGeneration = generation
  loading.value = true
  error.value = false
  try {
    const result = await browser.refresh()
    if (generation === requestGeneration) videos.value = result
  } catch (err) {
    if (generation === requestGeneration) error.value = true
    console.error('Could not load YouTube discovery content', err)
  } finally {
    if (generation === requestGeneration) loading.value = false
  }
}

onMounted(resetBrowser)
watch([() => props.kind, () => account.value.signedIn, () => account.value.channelId, safetyMode], resetBrowser)
onBeforeUnmount(() => { generation++ })
</script>

<style scoped src="./Discovery.css" />
