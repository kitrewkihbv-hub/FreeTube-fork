import shaka from 'shaka-player'

import i18n from '../../../i18n/index'
import { PlayerIcons } from '../../../../constants'

const SIZES = [100, 75, 50]

export class VideoSizeButton extends shaka.ui.Element {
  /**
   * @param {() => number} getSize provides the current size percentage
   * @param {(size: number) => void} setSize applies a new size percentage
   * @param {EventTarget} events
   * @param {HTMLElement} parent
   * @param {shaka.ui.Controls} controls
   */
  constructor(getSize, setSize, events, parent, controls) {
    super(parent, controls)

    /** @private */
    this.getSize_ = getSize

    /** @private */
    this.setSize_ = setSize

    /** @private */
    this.button_ = document.createElement('button')
    this.button_.classList.add('video-size-button', 'shaka-tooltip')

    /** @private */
    this.icon_ = new shaka.ui.Icon(this.button_, PlayerIcons.RECTANGLE_DEFAULT)

    const label = document.createElement('label')
    label.classList.add(
      'shaka-overflow-button-label',
      'shaka-overflow-menu-only',
      'shaka-simple-overflow-button-label-inline'
    )

    /** @private */
    this.nameSpan_ = document.createElement('span')
    label.appendChild(this.nameSpan_)

    /** @private */
    this.currentState_ = document.createElement('span')
    this.currentState_.classList.add('shaka-current-selection-span')
    label.appendChild(this.currentState_)

    this.button_.appendChild(label)

    this.parent.appendChild(this.button_)

    // listeners

    this.eventManager.listen(this.button_, 'click', () => {
      const currentSize = this.getSize_()
      const nextSize = SIZES[SIZES.indexOf(currentSize) + 1] ?? SIZES[0]

      this.setSize_(nextSize)
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(events, 'videoSizeChanged', () => {
      this.updateLocalisedStrings_()
    })

    this.eventManager.listen(events, 'localeChanged', () => {
      this.updateLocalisedStrings_()
    })

    this.updateLocalisedStrings_()
  }

  /** @private */
  updateLocalisedStrings_() {
    const size = this.getSize_()

    this.button_.ariaLabel = i18n.global.t('Video.Player.Video Size', { size })
    this.nameSpan_.textContent = this.button_.ariaLabel
    this.currentState_.textContent = `${size}%`

    // Filled in when the video fills the window, outlined when it is scaled down
    this.icon_.use(size === SIZES[0] ? PlayerIcons.RECTANGLE_DEFAULT : PlayerIcons.VARIABLES_DEFAULT)
  }
}
