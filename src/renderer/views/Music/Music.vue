<template>
  <main class="musicPage">
    <section class="hero">
      <div class="heroCopy">
        <p class="eyebrow">
          {{ $t('Music.Eyebrow') }}
        </p>
        <h1>{{ $t('Music.Title') }}</h1>
        <p class="intro">
          {{ $t('Music.Description') }}
        </p>
        <form
          class="search"
          @submit.prevent="searchMusic"
        >
          <label
            class="srOnly"
            for="music-search"
          >{{ $t('Music.Search') }}</label>
          <input
            id="music-search"
            v-model="query"
            type="search"
            maxlength="255"
            :placeholder="$t('Music.Search Placeholder')"
          >
          <button
            type="submit"
            :disabled="!query.trim()"
          >
            <FontAwesomeIcon :icon="['fas', 'magnifying-glass']" />
            {{ $t('Music.Search') }}
          </button>
        </form>
      </div>
      <div
        class="heroArt"
        aria-hidden="true"
      >
        <div class="record">
          <FontAwesomeIcon :icon="['fas', 'music']" />
        </div>
      </div>
    </section>

    <section
      class="library"
      aria-labelledby="music-library"
    >
      <h2 id="music-library">
        {{ $t('Music.Library') }}
      </h2>
      <div class="libraryGrid">
        <RouterLink
          class="libraryCard favorites"
          :to="{ path: '/playlist/favorites', query: { playlistType: 'user' } }"
        >
          <span class="cardIcon"><FontAwesomeIcon :icon="['fas', 'heart']" /></span>
          <span><strong>{{ $t('Music.Liked Videos') }}</strong><small>{{ $t('Music.Liked Description') }}</small></span>
          <FontAwesomeIcon :icon="['fas', 'arrow-right']" />
        </RouterLink>
        <RouterLink
          class="libraryCard playlists"
          to="/userplaylists"
        >
          <span class="cardIcon"><FontAwesomeIcon :icon="['fas', 'list']" /></span>
          <span><strong>{{ $t('Music.Playlists') }}</strong><small>{{ $t('Music.Playlists Description') }}</small></span>
          <FontAwesomeIcon :icon="['fas', 'arrow-right']" />
        </RouterLink>
      </div>
    </section>

    <section
      class="discover"
      aria-labelledby="music-discover"
    >
      <h2 id="music-discover">
        {{ $t('Music.Discover') }}
      </h2>
      <p>{{ $t('Music.Discover Description') }}</p>
      <div class="discoveryLinks">
        <RouterLink
          v-for="item in discoveries"
          :key="item.query"
          :to="{ path: `/search/${item.query}` }"
        >
          {{ item.label }} <FontAwesomeIcon :icon="['fas', 'arrow-right']" />
        </RouterLink>
      </div>
      <p class="note">
        {{ $t('Music.Note') }}
      </p>
    </section>
  </main>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

const router = useRouter()
const { t } = useI18n()
const query = ref('')
const discoveries = computed(() => [
  { label: t('Music.Popular Music'), query: 'popular music' },
  { label: t('Music.Live Music'), query: 'live music' },
  { label: t('Music.New Music'), query: 'new music' },
])

function searchMusic() {
  const value = query.value.trim()
  if (value) {
    router.push({ path: `/search/${encodeURIComponent(value)}` })
  }
}
</script>

<style scoped src="./Music.css" />
