<template>
  <div
    class="videoLayout"
    :class="{
      isLoading,
      musicSession: $route.query.music === '1',
      useTheatreMode: useTheatreMode && !isLoading,
      noSidebar: !theatrePossible
    }"
  >
    <ft-loader
      v-if="isLoading"
      :fullscreen="true"
    />
    <div
      v-if="(isFamilyFriendly || !showFamilyFriendlyOnly)"
      class="videoArea"
    >
      <div class="videoAreaMargin">
        <section
          v-if="$route.query.music === '1' && !isLoading && videoTitle"
          class="musicDeck"
          :aria-label="$t('Music.Now playing')"
        >
          <div class="musicDeckTop">
            <router-link
              to="/music"
              class="musicBack"
            ><font-awesome-icon :icon="['fas', 'arrow-left']" /> {{ $t('Music.Back to music') }}</router-link>
            <button
              type="button"
              class="musicDetails"
              :aria-pressed="musicShowDetails"
              @click="musicShowDetails = !musicShowDetails"
            >
              {{ musicShowDetails ? $t('Music.Hide details') : $t('Music.Show details') }}
            </button>
          </div>
          <div class="musicDeckInfo">
            <img
              :src="thumbnail"
              alt=""
              class="musicCover"
            >
            <div>
              <p class="musicEyebrow">
                {{ $t('Music.Now playing') }}
              </p>
              <h1 dir="auto">
                {{ videoTitle }}
              </h1>
              <p dir="auto">
                {{ channelName }}
              </p>
            </div>
          </div>
          <div class="musicControls">
            <button
              type="button"
              :disabled="!watchingPlaylist"
              :aria-pressed="musicShuffle"
              :title="$t('Music.Shuffle playlists')"
              @click="toggleMusicShuffle"
            >
              <font-awesome-icon :icon="['fas', 'random']" />
            </button>
            <button
              type="button"
              :disabled="!watchingPlaylist || !videoPlayerLoaded"
              :title="$t('Music.Previous')"
              @click="handleSkipToPrev"
            >
              <font-awesome-icon :icon="['fas', 'step-backward']" />
            </button>
            <button
              type="button"
              class="musicPlay"
              :disabled="!videoPlayerLoaded"
              :title="musicPlaying ? $t('Music.Pause') : $t('Music.Play')"
              :aria-label="musicPlaying ? $t('Music.Pause') : $t('Music.Play')"
              @click="toggleMusicPlayback"
            >
              <font-awesome-icon :icon="['fas', musicPlaying ? 'pause' : 'play']" />
            </button>
            <button
              type="button"
              :disabled="!videoPlayerLoaded"
              :title="$t('Music.Next')"
              @click="handleSkipToNext"
            >
              <font-awesome-icon :icon="['fas', 'step-forward']" />
            </button>
            <button
              type="button"
              class="musicCaptions"
              :disabled="!videoPlayerLoaded"
              :title="$t('Music.Captions')"
              @click="toggleMusicCaptions"
            >
              {{ $t('Music.Captions short') }}
            </button>
          </div>
          <div class="musicProgress">
            <span>{{ musicTime(musicCurrentTime) }}</span>
            <input
              type="range"
              min="0"
              :max="Math.max(videoLengthSeconds, 0)"
              :value="musicCurrentTime"
              :disabled="!videoPlayerLoaded || !videoLengthSeconds"
              :aria-label="$t('Music.Seek')"
              @input="seekMusic"
            >
            <span>{{ musicTime(videoLengthSeconds) }}</span>
          </div>
          <p class="musicNote">
            {{ $t('Music.Caption note') }}
          </p>
        </section>
        <ft-shaka-video-player
          v-if="!isLoading && (!isUpcoming || playabilityStatus === 'OK') && !errorMessage"
          ref="player"
          :manifest-src="manifestSrc"
          :manifest-mime-type="manifestMimeType"
          :sabr-data="sabrData"
          :legacy-formats="legacyFormats"
          :start-time="startTimeSeconds"
          :captions="captions"
          :hls-audio-metadata="hlsAudioMetadata"
          :storyboard-src="videoStoryboardSrc"
          :format="activeFormat"
          :thumbnail="thumbnail"
          :video-id="videoId"
          :channel-id="channelId"
          :chapters="videoChapters"
          :current-chapter-index="videoCurrentChapterIndex"
          :chapters-src="chaptersSrc"
          :title="videoTitle"
          :theatre-possible="theatrePossible"
          :use-theatre-mode="useTheatreMode"
          :autoplay-possible="autoplayPossible"
          :autoplay-enabled="autoplayEnabled"
          :watching-playlist="watchingPlaylist"
          :vr-projection="vrProjection"
          :start-in-fullscreen="startNextVideoInFullscreen"
          :start-in-fullwindow="startNextVideoInFullwindow"
          :start-in-pip="startNextVideoInPip"
          :current-playback-rate="currentPlaybackRate"
          :delay-load-until-unix="adEndTimeUnixMs"
          class="videoPlayer"
          @error="handlePlayerError"
          @loaded="handleVideoLoaded"
          @playback-state-changed="musicPlaying = $event"
          @timeupdate="handleTimeUpdate"
          @ended="handleVideoEnded"
          @toggle-theatre-mode="useTheatreMode = !useTheatreMode"
          @toggle-autoplay="toggleAutoplay"
          @playback-rate-updated="updatePlaybackRate"
          @skip-to-next="handleSkipToNext"
          @skip-to-prev="handleSkipToPrev"
          @player-reload-requested="onSabrReloadRequested"
        />
        <div
          v-if="!isLoading && (isUpcoming || errorMessage)"
          class="videoPlayer"
        >
          <img
            v-if="!isUpcoming || playabilityStatus !== 'OK'"
            :src="thumbnail"
            class="videoThumbnail"
            alt=""
          >
          <div
            v-if="isUpcoming"
            class="premiereDate"
            :class="{trailer: isUpcoming && playabilityStatus === 'OK'}"
          >
            <font-awesome-icon
              :icon="['fas', 'satellite-dish']"
              class="premiereIcon"
            />
            <p
              v-if="upcomingTimestamp !== null"
              class="premiereText"
            >
              <span
                class="premiereTextTimeLeft"
              >
                {{ $t("Video.Premieres") }} {{ upcomingTimeLeft }}
              </span>
              <br>
              <span
                class="premiereTextTimestamp"
              >
                {{ upcomingTimestamp }}
              </span>
            </p>
            <p
              v-else
              class="premiereText"
            >
              {{ $t("Video.Starting soon, please refresh the page to check again") }}
            </p>
          </div>
          <div
            v-else-if="errorMessage"
            class="errorContainer"
          >
            <div
              class="errorWrapper"
            >
              <font-awesome-icon
                :icon="customErrorIcon || ['fas', 'exclamation-circle']"
                aria-hidden="true"
                class="errorIcon"
              />
              <p
                class="errorMessage"
              >
                {{ errorMessage }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
    <ft-age-restricted
      v-if="(!isLoading && !isFamilyFriendly && showFamilyFriendlyOnly)"
      class="ageRestricted"
    />
    <div
      v-if="(isFamilyFriendly || !showFamilyFriendlyOnly)"
      v-show="$route.query.music !== '1' || musicShowDetails"
      class="infoArea"
    >
      <watch-video-info
        v-if="!isLoading"
        :id="videoId"
        :title="videoTitle"
        :channel-id="channelId"
        :channel-name="channelName"
        :channel-thumbnail="channelThumbnail"
        :published="videoPublished"
        :premiere-date="premiereDate"
        :subscription-count-text="channelSubscriptionCountText"
        :like-count="videoLikeCount"
        :dislike-count="videoDislikeCount"
        :view-count="videoViewCount"
        :get-timestamp="getTimestamp"
        :is-live-content="isLiveContent"
        :is-live="isLive"
        :is-upcoming="isUpcoming"
        :playlist-id="playlistId"
        :get-playlist-state="getPlaylistState"
        :length-seconds="videoLengthSeconds"
        :video-thumbnail="thumbnail"
        :in-user-playlist="!!selectedUserPlaylist"
        :is-unlisted="isUnlisted"
        :content-disclosures="contentDisclosures"
        :can-save-watched-progress="canSaveWatchProgress"
        class="watchVideo"
        :class="{ theatreWatchVideo: useTheatreMode }"
        @change-format="handleFormatChange"
        @pause-player="pausePlayer"
        @save-watched-progress="handleWatchProgressManualSave"
        @reload-player="onManualReloadRequested"
      />
      <watch-video-chapters
        v-if="!hideChapters && !isLoading && videoChapters.length > 0"
        :chapters="videoChapters"
        :current-chapter-index="videoCurrentChapterIndex"
        :kind="videoChaptersKind"
        class="watchVideo"
        :class="{ theatreWatchVideo: useTheatreMode }"
        @timestamp-event="changeTimestamp"
      />
      <watch-video-description
        v-if="!isLoading && !hideVideoDescription"
        :description="videoDescription"
        :description-html="videoDescriptionHtml"
        :license="license"
        :content-disclosures="contentDisclosures"
        class="watchVideo"
        :class="{ theatreWatchVideo: useTheatreMode }"
        @timestamp-event="changeTimestamp"
      />
      <CommentSection
        v-if="!isLoading && !isLive && !hideComments"
        :id="videoId"
        class="watchVideo"
        :class="{ theatreWatchVideo: useTheatreMode }"
        :channel-thumbnail="channelThumbnail"
        :channel-name="channelName"
        :video-player-ready="videoPlayerLoaded"
        @timestamp-event="changeTimestamp"
      />
    </div>
    <div
      v-if="(isFamilyFriendly || !showFamilyFriendlyOnly)"
      class="sidebarArea"
    >
      <watch-video-live-chat
        v-if="!isLoading && !hideLiveChat && (isLive || isUpcoming)"
        :live-chat="liveChat"
        :video-id="videoId"
        :channel-id="channelId"
        class="watchVideoSideBar watchVideoPlaylist"
        :class="{ theatrePlaylist: useTheatreMode }"
      />
      <watch-video-playlist
        v-if="watchingPlaylist"
        v-show="!isLoading"
        ref="watchVideoPlaylist"
        :watch-view-loading="isLoading"
        :playlist-id="playlistId"
        :playlist-type="playlistType"
        :video-id="videoId"
        :playlist-item-id="playlistItemId"
        class="watchVideoSideBar watchVideoPlaylist"
        :class="{ theatrePlaylist: useTheatreMode }"
        @pause-player="pausePlayer"
        @shuffle-changed="musicShuffle = $event"
      />
      <watch-video-recommendations
        v-if="!isLoading && !hideRecommendedVideos"
        :data="recommendedVideos"
        class="watchVideoSideBar watchVideoRecommendations"
        :class="{
          theatreRecommendations: useTheatreMode,
          watchVideoRecommendationsLowerCard: watchingPlaylist || isLive,
          watchVideoRecommendationsNoCard: !watchingPlaylist || !isLive
        }"
        @pause-player="pausePlayer"
      />
    </div>
  </div>
</template>

<script src="./Watch.js" />
<style scoped src="./Watch.scss" lang="scss" />
