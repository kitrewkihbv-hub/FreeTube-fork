import shaka from 'shaka-player'
import i18n from '../../../i18n/index'

const LEVELS = [100, 125, 150, 200]

// Zoom only the video image, not the player controls. The container clips the edges.
export class VideoZoomButton extends shaka.ui.Element {
  constructor(getZoom, setZoom, parent, controls) {
    super(parent, controls)
    this.button = document.createElement('button')
    this.button.classList.add('video-zoom-button')
    this.button.type = 'button'
    const update = () => {
      const label = i18n.global.t('Video.Player.Video Zoom', { zoom: getZoom() })
      this.button.textContent = label
      this.button.setAttribute('aria-label', i18n.global.t('Video.Player.Video Zoom Hint', { zoom: getZoom() }))
      this.button.title = this.button.getAttribute('aria-label')
    }
    this.eventManager.listen(this.button, 'click', () => {
      setZoom(LEVELS[(LEVELS.indexOf(getZoom()) + 1) % LEVELS.length])
      update()
    })
    parent.appendChild(this.button)
    update()
  }
}
