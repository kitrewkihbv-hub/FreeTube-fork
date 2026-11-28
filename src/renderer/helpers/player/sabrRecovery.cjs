// Recovery is attempted only after the streaming layer requests a reload.
// Do not assume that a client name or a 59-second failure identifies its cause.
function hasDirectDashUrl(format) {
  return !!format && !format.is_type_otf && [format.url, format.signature_cipher, format.cipher].some(value => typeof value === 'string' && value.length > 0)
}

function canTryDirectDash(formats) {
  if (!Array.isArray(formats)) return false
  return formats.some(format => format?.has_audio && hasDirectDashUrl(format)) &&
    formats.some(format => format?.has_video && hasDirectDashUrl(format))
}

function fallbackStageFor(selectedPlayer, advance) {
  const stage = selectedPlayer === 'authenticated-embedded' ? 0 : selectedPlayer === 'embedded' ? 1 : selectedPlayer === 'android-vr' ? 2 : 3
  return advance ? Math.min(stage + 1, 3) : stage
}

module.exports = { hasDirectDashUrl, canTryDirectDash, fallbackStageFor }
