import shaka from 'shaka-player'
import i18n from '../../../i18n/index'

// Opens independent width/height controls; the picture alone is transformed.
export class VideoZoomButton extends shaka.ui.Element {
  constructor(isOpen, toggle, panelId, events, parent, controls) {
    super(parent, controls)
    this.button = document.createElement('button')
    this.button.classList.add('video-zoom-button')
    this.button.type = 'button'
    this.button.setAttribute('aria-controls', panelId)
    const update = () => {
      const label = i18n.global.t('Video.Player.Adjust Picture')
      this.button.textContent = label
      this.button.setAttribute('aria-label', label)
      this.button.setAttribute('aria-expanded', String(isOpen()))
      this.button.title = label
    }
    this.eventManager.listen(this.button, 'click', toggle)
    this.eventManager.listen(events, 'videoAdjustmentsChanged', update)
    this.eventManager.listen(events, 'localeChanged', update)
    parent.appendChild(this.button)
    update()
  }
}
