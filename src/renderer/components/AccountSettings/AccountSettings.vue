<template>
  <FtSettingsSection
    :title="$t('Settings.Account Settings.Account Settings')"
  >
    <p
      v-if="!USING_ELECTRON"
      class="accountNotice"
    >
      {{ $t('Settings.Account Settings.Desktop Only') }}
    </p>
    <template v-else>
      <FtLoader
        v-if="!accountRestored"
        fullscreen
      />
      <div
        v-if="isSignedIn"
        class="accountDetails"
      >
        <img
          v-if="account.thumbnail"
          class="accountThumbnail"
          :src="account.thumbnail"
          alt=""
        >
        <FontAwesomeIcon
          v-else
          class="accountThumbnail accountThumbnailPlaceholder"
          :icon="['fas', 'circle-user']"
        />
        <div class="accountText">
          <p class="accountName">
            {{ accountName }}
          </p>
          <p
            v-if="account.handle"
            class="accountHandle"
          >
            {{ account.handle }}
          </p>
          <p
            v-if="account.channelId"
            class="accountChannelId"
          >
            {{ $t('Settings.Account Settings.Channel ID', { channelId: account.channelId }) }}
          </p>
        </div>
      </div>

      <FtFlexBox
        v-if="isSignedIn"
        class="settingsFlexStart460px"
      >
        <FtButton
          :label="$t('Settings.Account Settings.Import Subscriptions')"
          :icon="['fas', 'download']"
          :disabled="busy"
          @click="importSubscriptions"
        />
        <FtButton
          :label="$t('Settings.Account Settings.Export Subscriptions')"
          :icon="['fas', 'upload']"
          :disabled="busy"
          @click="exportSubscriptions"
        />
        <FtButton
          :label="$t('Settings.Account Settings.Refresh Account Details')"
          :icon="['fas', 'rotate']"
          :disabled="busy"
          @click="refreshAccountInfo"
        />
        <FtButton
          :label="$t('Settings.Account Settings.Sign Out')"
          :icon="['fas', 'right-from-bracket']"
          text-color="var(--destructive-text-color)"
          background-color="var(--destructive-color)"
          :disabled="busy"
          @click="confirmSignOut = true"
        />
      </FtFlexBox>

      <FtFlexBox
        v-if="accountRestored && !isSignedIn"
        class="settingsFlexStart460px"
      >
        <FtButton
          :label="signingIn ? $t('Settings.Account Settings.Sign In Waiting') : $t('Settings.Account Settings.Sign In')"
          :icon="signingIn ? ['fas', 'spinner'] : ['fas', 'right-to-bracket']"
          :disabled="signingIn"
          @click="startSignIn"
        />
      </FtFlexBox>

      <div
        v-if="accountRestored && isSignedIn"
        class="switchColumnGrid accountOptions"
      >
        <div class="switchColumn">
          <FtToggleSwitch
            :label="$t('Settings.Account Settings.Sync Subscriptions to the Active Profile')"
            :default-value="signInSyncSubscriptions"
            :tooltip="$t('Tooltips.Account Settings.Sync Subscriptions to the Active Profile')"
            compact
            @change="updateSignInSyncSubscriptions"
          />
          <FtToggleSwitch
            :label="$t('Settings.Account Settings.Use Account Feed')"
            :default-value="useYouTubeAccountFeed"
            :tooltip="$t('Tooltips.Account Settings.Use Account Feed')"
            compact
            @change="updateUseYouTubeAccountFeed"
          />
        </div>
        <div class="switchColumn">
          <FtToggleSwitch
            :label="$t('Settings.Account Settings.Sync Subscriptions to YouTube')"
            :default-value="signInSyncToYouTube"
            :tooltip="$t('Tooltips.Account Settings.Sync Subscriptions to YouTube')"
            compact
            @change="updateSignInSyncToYouTube"
          />
        </div>
      </div>

      <p
        v-if="accountRestored"
        class="accountDisclaimer"
      >
        <FontAwesomeIcon :icon="['fas', 'shield-halved']" />
        {{ $t('Settings.Account Settings.Disclaimer') }}
      </p>

      <FtPrompt
        v-if="signInPrompt !== null"
        theme="readable-width"
        @click="handleSignInPromptClose"
      >
        <template #label="{ labelId }">
          <h2
            :id="labelId"
            class="signInPromptTitle"
          >
            {{ $t('Settings.Account Settings.Sign In Title') }}
          </h2>
        </template>
        <p class="signInPromptText">
          {{ $t('Settings.Account Settings.Sign In Instructions') }}
        </p>
        <div class="signInPromptBody">
          <img
            v-if="signInQrCode !== null"
            class="signInQrCode"
            :src="signInQrCode"
            :alt="$t('Settings.Account Settings.Sign In QR Code Alt')"
          >
          <div class="signInCodeContainer">
            <p class="signInCodeLabel">
              {{ $t('Settings.Account Settings.Sign In Code Label') }}
            </p>
            <p class="signInCode">
              {{ signInPrompt.userCode }}
            </p>
          </div>
        </div>
        <p class="signInPromptText">
          {{ $t('Settings.Account Settings.Sign In Link Instructions') }}
        </p>
        <p class="signInPromptText">
          {{ $t('Settings.Account Settings.Sign In Second Screen Instructions') }}
        </p>
        <p class="signInStatus">
          <FontAwesomeIcon
            class="signInStatusIcon"
            :icon="['fas', 'spinner']"
            spin
          />
          {{ $t('Settings.Account Settings.Sign In Waiting') }}
        </p>
        <FtFlexBox>
          <FtButton
            :label="$t('Settings.Account Settings.Open Sign In Page')"
            :icon="['fas', 'arrow-up-right-from-square']"
            @click="openVerificationUrl"
          />
          <FtButton
            :label="$t('Settings.Account Settings.Copy Code')"
            :icon="['fas', 'copy']"
            :text-color="null"
            :background-color="null"
            @click="copyCode"
          />
          <FtButton
            :label="$t('Settings.Account Settings.Cancel Sign In')"
            :text-color="null"
            :background-color="null"
            @click="cancelSignIn"
          />
        </FtFlexBox>
      </FtPrompt>

      <FtPrompt
        v-if="confirmSignOut"
        :label="$t('Settings.Account Settings.Sign Out Confirmation')"
        :option-names="[$t('Yes'), $t('No')]"
        :option-values="['yes', 'no']"
        @click="handleSignOutPrompt"
      />
    </template>
  </FtSettingsSection>
</template>

<script setup>
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FtSettingsSection from '../FtSettingsSection/FtSettingsSection.vue'
import FtFlexBox from '../ft-flex-box/ft-flex-box.vue'
import FtToggleSwitch from '../FtToggleSwitch/FtToggleSwitch.vue'
import FtButton from '../FtButton/FtButton.vue'
import FtLoader from '../FtLoader/FtLoader.vue'
import FtPrompt from '../FtPrompt/FtPrompt.vue'
import qrcode from 'qrcode-generator'

import store from '../../store/index'

import { copyToClipboard, openExternalLink, showToast } from '../../helpers/utils'

const USING_ELECTRON = !!process.env.IS_ELECTRON

const { t } = useI18n()

const confirmSignOut = ref(false)

/** @type {import('vue').ComputedRef<import('../../store/modules/youtube-account').YouTubeAccountState>} */
const account = computed(() => store.getters.getYouTubeAccount)

const isSignedIn = computed(() => store.getters.getIsSignedInToYouTubeAccount)
const signingIn = computed(() => store.getters.getIsSigningInToYouTubeAccount)
const busy = computed(() => store.getters.getYouTubeAccountBusy)
const signInPrompt = computed(() => store.getters.getYouTubeAccountSignInPrompt)
const accountRestored = computed(() => store.getters.getYouTubeAccountRestored)

const accountName = computed(() => account.value.name ?? t('Settings.Account Settings.Signed In'))

/**
 * The page a phone opens when it scans the sign in QR code.
 *
 * This is the same link YouTube's own TV apps put in their QR codes (and the one
 * SmartTube uses): the code is part of the path, so the page opens with the code
 * already filled in and the user only has to pick an account and approve.
 * @param {string} userCode
 */
function getQrSignInUrl(userCode) {
  return `https://youtube.com/qr/activate/${userCode.trim().replaceAll(' ', '-')}`
}

/**
 * A QR code of the page the user has to visit to authorize the sign in.
 * Scanning it with a phone is enough to complete the sign in.
 * @type {import('vue').ComputedRef<string|null>}
 */
const signInQrCode = computed(() => {
  const prompt = signInPrompt.value

  if (prompt === null) {
    return null
  }

  try {
    const qrCode = qrcode(0, 'M')

    const url = prompt.userCode !== null && prompt.userCode !== ''
      ? getQrSignInUrl(prompt.userCode)
      : prompt.verificationUrl

    qrCode.addData(url)
    qrCode.make()

    return qrCode.createDataURL(8, 4)
  } catch (error) {
    console.error('failed to generate the sign in QR code', error)
    return null
  }
})

const signInSyncSubscriptions = computed(() => store.getters.getSignInSyncSubscriptions)
const useYouTubeAccountFeed = computed(() => store.getters.getUseYouTubeAccountFeed)
const signInSyncToYouTube = computed(() => store.getters.getSignInSyncToYouTube)

/** @param {boolean} value */
function updateSignInSyncSubscriptions(value) {
  store.dispatch('updateSignInSyncSubscriptions', value)
}

/** @param {boolean} value */
function updateUseYouTubeAccountFeed(value) {
  store.dispatch('updateUseYouTubeAccountFeed', value)
}

/** @param {boolean} value */
function updateSignInSyncToYouTube(value) {
  store.dispatch('updateSignInSyncToYouTube', value)
}

async function startSignIn() {
  try {
    await store.dispatch('signInToYouTubeAccount')
  } catch (error) {
    showToast(t('Settings.Account Settings.Sign In Error'))
    console.error(error)
  }
}

function openVerificationUrl() {
  // The plain verification page, so the code can be typed in on this computer.
  // The QR code uses a different link (see `getQrSignInUrl`).
  openExternalLink(signInPrompt.value.verificationUrl)
}

/** @param {any} option the prompt emits `null` when it is closed */
function handleSignInPromptClose(option) {
  // The prompt has no option buttons of its own, so the user closing it (e.g. with Escape)
  // means that they want to stop waiting for the authorization
  if (option === null) {
    cancelSignIn()
  }
}

function copyCode() {
  copyToClipboard(signInPrompt.value.userCode, {
    messageOnSuccess: t('Settings.Account Settings.Code Copied')
  })
}

function cancelSignIn() {
  store.dispatch('cancelYouTubeAccountSignIn')
}

async function importSubscriptions() {
  try {
    const { channelCount, addedCount } = await store.dispatch('syncSubscriptionsFromYouTubeAccount')

    showToast(t('Settings.Account Settings.Subscriptions Imported', { count: addedCount, total: channelCount }))
  } catch (error) {
    showToast(t('Settings.Account Settings.Subscriptions Import Error'))
    console.error(error)
  }
}

async function exportSubscriptions() {
  try {
    const channelCount = await store.dispatch('importProfileSubscriptionsToYouTubeAccount')

    showToast(t('Settings.Account Settings.Subscriptions Exported', { count: channelCount }))
  } catch (error) {
    showToast(t('Settings.Account Settings.Subscriptions Export Error'))
    console.error(error)
  }
}

function refreshAccountInfo() {
  store.dispatch('refreshYouTubeAccountInfo')
}

/**
 * @param {string|null} option
 */
async function handleSignOutPrompt(option) {
  confirmSignOut.value = false

  if (option !== 'yes') {
    return
  }

  await store.dispatch('signOutOfYouTubeAccount')

  showToast(t('Settings.Account Settings.Signed Out'))
}

/**
 * Copying the code is the most likely action while the prompt is open
 */
watch(signInPrompt, (newPrompt) => {
  if (newPrompt !== null) {
    copyToClipboard(newPrompt.userCode, {
      messageOnSuccess: t('Settings.Account Settings.Code Copied')
    })
  }
})

// The sign in attempt is intentionally not cancelled when this section is unmounted,
// so that the authorization can still complete while the user browses the app.
// The main process emits the result to the app, which shows it as a toast.
</script>

<style scoped src="./AccountSettings.css" />
