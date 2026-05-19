/**
 * Branded ID types so node/edge/group ids never accidentally cross.
 */
export type NodeId = string & { readonly __brand: 'NodeId' }
export type EdgeId = string & { readonly __brand: 'EdgeId' }
export type GroupId = string & { readonly __brand: 'GroupId' }
export type ClientId = string & { readonly __brand: 'ClientId' }
export type BatchId = string & { readonly __brand: 'BatchId' }

export const asNodeId = (s: string): NodeId => s as NodeId
export const asEdgeId = (s: string): EdgeId => s as EdgeId
export const asGroupId = (s: string): GroupId => s as GroupId
export const asClientId = (s: string): ClientId => s as ClientId
export const asBatchId = (s: string): BatchId => s as BatchId

/**
 * A point in world coordinates.
 */
export type Vec2 = { x: number; y: number }

/**
 * An axis-aligned rectangle in world coordinates.
 * x/y is the top-left; w/h extend toward +x/+y.
 */
export type WorldRect = { x: number; y: number; w: number; h: number }

export const SCHEMA_VERSION = 1 as const
export type SchemaVersion = typeof SCHEMA_VERSION
