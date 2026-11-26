<template>
  <main class="musicPage">
    <header class="musicHeader">
      <div>
        <p class="eyebrow">
          {{ $t('Music.Eyebrow') }}
        </p>
        <h1>{{ $t('Music.Title') }}<span>{{ $t('Music.Logo dot') }}</span></h1>
      </div>
      <form
        class="searchBar"
        @submit.prevent="submitSearch"
      >
        <font-awesome-icon
          :icon="['fas', 'search']"
          aria-hidden="true"
        />
        <label
          class="visuallyHidden"
          for="musicSearch"
        >{{ $t('Music.Search') }}</label>
        <input
          id="musicSearch"
          v-model="query"
          type="search"
          maxlength="100"
          :placeholder="$t('Music.Search placeholder')"
        >
        <button
          type="submit"
          :disabled="!query.trim()"
        >
          {{ $t('Music.Search') }}
        </button>
      </form>
    </header>

    <template v-if="!searchQuery">
      <section class="hero">
        <div class="heroText">
          <p class="eyebrow">
            {{ $t('Music.New eyebrow') }}
          </p>
          <h2>{{ $t('Music.Hero title') }}</h2>
          <p class="heroDescription">
            {{ $t('Music.Hero description') }}
          </p>
          <a
            href="#musicSearch"
            class="heroAction"
            @click.prevent="focusSearch"
          >{{ $t('Music.Start searching') }} <font-awesome-icon :icon="['fas', 'arrow-right']" /></a>
        </div>
        <div
          class="heroArtwork"
          aria-hidden="true"
        >
          <div class="record">
            <span class="recordLabel"><font-awesome-icon :icon="['fas', 'music']" /></span>
          </div>
          <div class="artBadge">
            <font-awesome-icon :icon="['fas', 'volume-high']" />
          </div>
        </div>
      </section>
      <section class="library">
        <div class="sectionHeading">
          <div>
            <p class="eyebrow">
              {{ $t('Music.Your collection') }}
            </p><h2>{{ $t('Music.Library') }}</h2>
          </div>
        </div>
        <div class="libraryGrid">
          <router-link
            class="libraryItem"
            :to="{ path: '/playlist/favorites', query: { playlistType: 'user', music: '1' } }"
          >
            <span class="libraryArt favoriteArt"><font-awesome-icon :icon="['fas', 'heart']" /></span>
            <span><strong>{{ $t('Music.Favorites') }}</strong><small>{{ $t('Music.Favorites description') }}</small></span>
            <font-awesome-icon
              class="libraryArrow"
              :icon="['fas', 'arrow-right']"
            />
          </router-link>
          <router-link
            class="libraryItem"
            :to="{ path: '/userplaylists', query: { music: '1' } }"
          >
            <span class="libraryArt playlistsArt"><font-awesome-icon :icon="['fas', 'list']" /></span>
            <span><strong>{{ $t('Music.Playlists') }}</strong><small>{{ $t('Music.Playlists description') }}</small></span>
            <font-awesome-icon
              class="libraryArrow"
              :icon="['fas', 'arrow-right']"
            />
          </router-link>
        </div>
        <p class="musicHint">
          {{ $t('Music.Hint') }}
        </p>
      </section>
    </template>

    <section
      v-else
      class="results"
    >
      <div class="resultsHeader">
        <div>
          <p class="eyebrow">
            {{ $t('Music.Search results') }}
          </p><h2>{{ searchQuery }}</h2><p class="resultsCaption">
            {{ $t('Music.Search source') }}
          </p>
        </div>
        <router-link
          class="backLink"
          to="/music"
        ><font-awesome-icon :icon="['fas', 'arrow-left']" /> {{ $t('Music.Back to music') }}</router-link>
      </div>
      <div
        class="filterTabs"
        :aria-label="$t('Music.Result type')"
      >
        <button
          type="button"
          class="filterTab"
          :class="{ selected: selectedType === 'song' }"
          :aria-pressed="selectedType === 'song'"
          @click="changeType('song')"
        >
          {{ $t('Music.Songs') }}
        </button>
        <button
          type="button"
          class="filterTab"
          :class="{ selected: selectedType === 'video' }"
          :aria-pressed="selectedType === 'video'"
          @click="changeType('video')"
        >
          {{ $t('Music.Music videos') }}
        </button>
      </div>
      <p
        v-if="loading"
        class="message"
        role="status"
      >
        {{ $t('Music.Loading') }}
      </p>
      <div
        v-else-if="error"
        class="message"
        role="alert"
      >
        <p>{{ $t('Music.Search failed') }}</p><button
          type="button"
          @click="runSearch"
        >
          {{ $t('Music.Try again') }}
        </button>
      </div>
      <p
        v-else-if="tracks.length === 0"
        class="message"
      >
        {{ $t('Music.No results') }}
      </p>
      <template v-else>
        <div class="listHeading">
          <span>{{ $t('Music.Number short') }}</span><span>{{ $t('Music.Track') }}</span><span class="albumHeading">{{ $t('Music.Album') }}</span><span>{{ $t('Music.Duration') }}</span>
        </div>
        <div class="trackList">
          <router-link
            v-for="(track, index) in tracks"
            :key="track.id"
            class="trackRow"
            :to="{ path: `/watch/${track.id}`, query: { music: '1' } }"
          >
            <span class="trackNumber">{{ index + 1 }}</span>
            <img
              :src="track.artwork"
              alt=""
              loading="lazy"
              class="trackArt"
            >
            <span class="trackText"><strong dir="auto">{{ track.title }}</strong><small dir="auto">{{ track.artist || $t('Music.Unknown artist') }}</small></span>
            <span
              class="trackAlbum"
              dir="auto"
            >{{ track.album }}</span>
            <span class="trackDuration">{{ track.duration }}</span>
            <font-awesome-icon
              class="trackPlay"
              :icon="['fas', 'play']"
            />
          </router-link>
        </div>
        <div
          v-if="continuation"
          class="moreWrap"
        >
          <button
            type="button"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? $t('Music.Loading') : $t('Music.More results') }}
          </button>
        </div>
        <p
          v-if="moreError"
          class="message"
          role="alert"
        >
          {{ $t('Music.More failed') }}
        </p>
      </template>
    </section>
  </main>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getLocalMusicSearch, getLocalMusicSearchContinuation } from '../../helpers/api/local'
import store from '../../store'

const route = useRoute()
const router = useRouter()
const query = ref('')
const selectedType = ref('song')
const tracks = shallowRef([])
const continuation = shallowRef(null)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref(false)
const moreError = ref(false)
const searchQuery = computed(() => typeof route.query.q === 'string' ? route.query.q.trim().slice(0, 100) : '')
let generation = 0

function focusSearch() { document.getElementById('musicSearch')?.focus() }
function submitSearch() {
  const value = query.value.trim().slice(0, 100)
  if (!value) return
  if (value === searchQuery.value) runSearch()
  else router.push({ path: '/music', query: { q: value } })
}
function changeType(type) {
  if (selectedType.value === type) return
  selectedType.value = type
  runSearch()
}
async function runSearch() {
  const term = searchQuery.value
  const current = ++generation
  tracks.value = []
  continuation.value = null
  error.value = false
  moreError.value = false
  loadingMore.value = false
  if (!term) { loading.value = false; return }
  loading.value = true
  try {
    const result = await getLocalMusicSearch(term, selectedType.value, store.getters.getShowFamilyFriendlyOnly)
    if (current !== generation) return
    tracks.value = result.results
    continuation.value = result.continuation
  } catch (err) {
    if (current === generation) error.value = true
    console.warn('Music search failed', err)
  } finally {
    if (current === generation) loading.value = false
  }
}
async function loadMore() {
  if (!continuation.value || loadingMore.value) return
  const current = generation
  const cursor = continuation.value
  loadingMore.value = true
  moreError.value = false
  try {
    const result = await getLocalMusicSearchContinuation(cursor)
    if (current !== generation) return
    const ids = new Set(tracks.value.map(track => track.id))
    tracks.value = [...tracks.value, ...result.results.filter(track => !ids.has(track.id))]
    continuation.value = result.continuation
  } catch (err) {
    if (current === generation) moreError.value = true
    console.warn('Music search continuation failed', err)
  } finally {
    if (current === generation) loadingMore.value = false
  }
}
watch(searchQuery, value => { query.value = value; selectedType.value = 'song'; runSearch() }, { immediate: true })
onBeforeUnmount(() => { generation++ })
</script>

<style scoped src="./Music.css" />
