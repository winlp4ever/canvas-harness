/**
 * Raster image utilities used by `store.addImage` and the renderer's
 * asset cache.
 *
 * Inputs accepted: `File`, `Blob`, or a `data:image/(png|jpeg)` URI.
 * External URLs are rejected — scenes must be self-contained (no
 * out-of-document references, no CORS surprises).
 *
 * Anything larger than `MAX_IMAGE_BYTES` or not PNG/JPEG is rejected
 * up front with a clear error so consumers can show a useful message.
 */

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const ACCEPTED_MIME = new Set<string>(['image/png', 'image/jpeg'])

/**
 * Validates that the input is a PNG/JPEG within the size cap. Throws
 * on rejection — meant for the synchronous prologue of an async
 * `addImage` call so consumers see the failure immediately, not after
 * an in-flight load.
 */
export const validateImageInput = (input: File | Blob | string): void => {
  if (typeof input === 'string') {
    if (!input.startsWith('data:')) {
      throw new Error(
        'addImage: external URL strings are not supported. Pass a File, Blob, or `data:image/(png|jpeg)` URI.',
      )
    }
    const mimeMatch = /^data:([^;,]+)/.exec(input)
    const mime = mimeMatch?.[1] ?? ''
    if (!ACCEPTED_MIME.has(mime)) {
      throw new Error(
        `addImage: unsupported MIME "${mime || '(unknown)'}". Only image/png and image/jpeg are supported.`,
      )
    }
    // base64-encoded payload ≈ 4/3 of decoded byte count
    const comma = input.indexOf(',')
    if (comma < 0) throw new Error('addImage: malformed data URI (missing payload separator)')
    const decodedBytes = Math.floor(((input.length - comma - 1) * 3) / 4)
    if (decodedBytes > MAX_IMAGE_BYTES) {
      throw new Error(
        `addImage: image exceeds the 2 MB limit (${Math.round(decodedBytes / 1024)} KB).`,
      )
    }
    return
  }
  if (!ACCEPTED_MIME.has(input.type)) {
    throw new Error(
      `addImage: unsupported file type "${input.type || '(unknown)'}". Only image/png and image/jpeg are supported.`,
    )
  }
  if (input.size > MAX_IMAGE_BYTES) {
    throw new Error(`addImage: file exceeds the 2 MB limit (${Math.round(input.size / 1024)} KB).`)
  }
}

/** Normalize any accepted `addImage` input to a `Blob`. */
export const toImageBlob = async (input: File | Blob | string): Promise<Blob> => {
  if (typeof input === 'string') {
    // data URIs round-trip through fetch reliably across browsers.
    const res = await fetch(input)
    return res.blob()
  }
  return input
}

/**
 * Downscales a blob's image if its longer side exceeds `maxDim`. Returns
 * the original blob unchanged when no downscale is needed. The output
 * MIME mirrors the input (PNG stays PNG to preserve alpha; JPEG stays
 * JPEG with q=0.9).
 *
 * `maxDim <= 0` disables downscaling entirely — useful when the caller
 * wants the original bytes (e.g. they're going to do their own
 * processing or they need full fidelity).
 */
export const downscaleImageBlob = async (
  blob: Blob,
  maxDim: number,
): Promise<{ blob: Blob; naturalW: number; naturalH: number }> => {
  const bitmap = await createImageBitmap(blob)
  const naturalW = bitmap.width
  const naturalH = bitmap.height
  const maxSide = Math.max(naturalW, naturalH)
  if (maxDim <= 0 || maxSide <= maxDim) {
    bitmap.close?.()
    return { blob, naturalW, naturalH }
  }
  const scale = maxDim / maxSide
  const w = Math.max(1, Math.round(naturalW * scale))
  const h = Math.max(1, Math.round(naturalH * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('addImage: failed to acquire OffscreenCanvas 2d context')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const outType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const outBlob = await canvas.convertToBlob({ type: outType, quality: 0.9 })
  return { blob: outBlob, naturalW: w, naturalH: h }
}

/**
 * Encodes a blob as a `data:` URI. The store persists this string on
 * `node.data.src` so the node round-trips through serialize/restore
 * without needing an external asset store.
 */
export const blobToDataUri = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('FileReader returned non-string result'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}
