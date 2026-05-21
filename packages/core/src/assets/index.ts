/**
 * Asset utilities — used by `store.addImage` / `store.addSvg` and
 * exported for consumers who want to pre-validate or pre-process
 * inputs before adding nodes (e.g. show a preview, derive a default
 * filename, validate during drag-over).
 */
export {
  MAX_IMAGE_BYTES,
  blobToDataUri,
  downscaleImageBlob,
  toImageBlob,
  validateImageInput,
} from './image'
export {
  MAX_SVG_BYTES,
  applySvgColor,
  extractSvgDimensions,
  sanitizeSvg,
  validateSvgMarkup,
} from './svg'
