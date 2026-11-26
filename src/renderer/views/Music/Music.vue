<template>
  <main class="musicHome">
    <section class="musicHero">
      <div class="heroCopy">
        <p class="eyebrow">
          {{ $t('Music.Eyebrow') }}
        </p>
        <h1>{{ $t('Music.Title') }}</h1>
        <p>{{ $t('Music.Description') }}</p>
        <form
          class="musicSearch"
          @submit.prevent="searchMusic"
        >
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
      </div>
      <div
        class="record"
        aria-hidden="true"
      >
        <font-awesome-icon :icon="['fas', 'music']" />
      </div>
    </section>
    <section class="musicLibrary">
      <h2>{{ $t('Music.Library') }}</h2>
      <div class="musicCards">
        <router-link :to="{ path: '/playlist/favorites', query: { playlistType: 'user', music: '1' } }">
          <span class="cardIcon"><font-awesome-icon :icon="['fas', 'heart']" /></span>
          <span><strong>{{ $t('Music.Favorites') }}</strong><small>{{ $t('Music.Favorites description') }}</small></span>
        </router-link>
        <router-link :to="{ path: '/userplaylists', query: { music: '1' } }">
          <span class="cardIcon"><font-awesome-icon :icon="['fas', 'list']" /></span>
          <span><strong>{{ $t('Music.Playlists') }}</strong><small>{{ $t('Music.Playlists description') }}</small></span>
        </router-link>
      </div>
      <p class="musicHint">
        {{ $t('Music.Hint') }}
      </p>
    </section>
  </main>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const query = ref('')
function searchMusic() {
  const value = query.value.trim()
  if (value) router.push({ path: `/search/${encodeURIComponent(value)}`, query: { music: '1' } })
}
</script>

<style scoped>
.musicHome { max-width: 1100px; margin: 0 auto; padding: 16px 20px 60px; }
.musicHero { display: flex; align-items: center; justify-content: space-between; gap: 25px; background: linear-gradient(125deg, #49246d, #21163b 65%, #171521); color: #fff; border-radius: 22px; padding: clamp(25px, 5vw, 55px); overflow: hidden; }
.heroCopy { flex: 1; min-width: 0; }
.eyebrow { color: #cbb0ff; font-size: 12px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
h1 { font-size: clamp(38px, 5vw, 64px); margin: 6px 0 14px; }
.heroCopy > p:not(.eyebrow) { max-width: 530px; color: #e0d7ea; line-height: 1.6; }
.musicSearch { display: flex; gap: 9px; margin-top: 24px; max-width: 540px; }
.musicSearch input { flex: 1; min-width: 0; border: 0; border-radius: 25px; padding: 13px 17px; background: #fff; color: #19151f; font-size: 15px; }
.musicSearch button { border: 0; border-radius: 25px; padding: 12px 22px; background: #c6a2ff; color: #211332; font-weight: 700; cursor: pointer; }
.musicSearch button:disabled { opacity: .5; cursor: default; }
.record { flex: 0 0 190px; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; font-size: 55px; color: #e0cbff; background: repeating-radial-gradient(circle, #281c36 0 4px, #16121e 5px 8px); box-shadow: 0 16px 42px #0007; }
.musicLibrary { padding: 24px 0; }
.musicCards { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; }
.musicCards a { display: flex; align-items: center; gap: 16px; padding: 16px; border-radius: 14px; color: var(--primary-text-color); background: var(--card-bg-color); text-decoration: none; }
.musicCards a:hover { outline: 2px solid #a77bdf; }
.cardIcon { width: 60px; height: 60px; display: grid; place-items: center; background: linear-gradient(135deg, #aa72e3, #56328d); border-radius: 10px; color: white; font-size: 22px; }
.musicCards strong, .musicCards small { display: block; }
.musicCards small { opacity: .75; margin-top: 5px; }
.musicHint { opacity: .75; line-height: 1.5; }
.visuallyHidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 700px) { .record { display: none; } .musicHome { padding: 8px 10px 35px; } }
</style>
