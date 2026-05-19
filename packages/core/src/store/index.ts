export { createCanvasStore } from './store'
export type {
  CanvasStore,
  OpOrigin,
  PresenceEvent,
  PresenceSlice,
  SpatialQuery,
  SpatialResult,
  StoreEventHandler,
  StoreEventName,
  StoreEvents,
  StoreOptions,
  Unsubscribe,
} from './types'
export type {
  DragOriginal,
  InteractionMode,
  InteractionState,
  PointerInfo,
} from './interaction'
export { idleInteractionState, isMoving } from './interaction'
export type { PresencePatch, PresenceState } from './presence'
export { emptyPresenceState, isNodeRemoteEditing } from './presence'
export { inverseBatch, inverseOp } from './inverse-op'
export type { ConflictRecord } from './conflict'
export { detectConflicts } from './conflict'
export type { SyncAdapter, SyncAdapterCapabilities } from './sync'
export { attachSync } from './sync'
export type { PalmRejectionState } from './palm-rejection'
export {
  PALM_REJECTION_GRACE_MS,
  createPalmRejectionState,
  notePenActive,
  notePenInactive,
  shouldRejectTouch,
} from './palm-rejection'
export type { EdgeGeometry } from '../edges/cache'
