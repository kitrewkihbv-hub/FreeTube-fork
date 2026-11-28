// Only use complete indexed, direct adaptive streams for SABR recovery.
// OTF formats require separate segment discovery and may issue extra requests.
function isDirectDashFormat(format) {
  return !!format && !format.is_type_otf && !!format.init_range && !!format.index_range &&
    [format.url, format.signature_cipher, format.cipher].some(value => typeof value === 'string' && value.length > 0)
}
function hasDirectDashPair(formats) {
  return Array.isArray(formats) &&
    formats.some(format => format?.has_audio && !format.has_video && isDirectDashFormat(format)) &&
    formats.some(format => format?.has_video && !format.has_audio && isDirectDashFormat(format))
}
module.exports = { isDirectDashFormat, hasDirectDashPair }
