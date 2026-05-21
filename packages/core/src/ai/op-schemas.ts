/**
 * Op schemas — see ARCHITECTURE.md §13.
 *
 * Hand-written JSON-Schema definitions for the `Op` discriminated
 * union. AI agents use these to validate generated ops before calling
 * `store.applyOp`; tool-use frameworks (Anthropic, OpenAI, Vertex)
 * advertise the schemas as callable tool definitions.
 *
 * Hand-written (not derived from TS) so the schemas survive when the
 * runtime shape evolves without an explicit schema update.
 */

const Vec2 = {
  type: 'object',
  required: ['x', 'y'],
  properties: { x: { type: 'number' }, y: { type: 'number' } },
} as const

const NodeBase = {
  type: 'object',
  required: ['id', 'type', 'x', 'y', 'w', 'h', 'angle', 'z', 'groups'],
  properties: {
    id: {
      type: 'string',
      description: 'Stable id (typically generated via `store.generateId()`).',
    },
    type: {
      type: 'string',
      description:
        'Node type — rect / ellipse / diamond / tag / capsule / thought-cloud / layered-rect / layered-ellipse / layered-diamond / text / a registered custom type.',
    },
    x: { type: 'number' },
    y: { type: 'number' },
    w: { type: 'number', minimum: 0 },
    h: { type: 'number', minimum: 0 },
    angle: { type: 'number', description: 'Rotation in radians (clockwise).' },
    z: { type: 'number' },
    groups: { type: 'array', items: { type: 'string' } },
    content: { type: 'string', description: 'Markdown content (for text-bearing shapes).' },
    style: { type: 'object', description: 'Style bag — see ARCHITECTURE.md §3.4 (Style type).' },
    hidden: { type: 'boolean' },
  },
} as const

const EdgeEnd = {
  oneOf: [
    {
      type: 'object',
      required: ['nodeId', 'localOffset'],
      properties: { nodeId: { type: 'string' }, localOffset: Vec2 },
    },
    {
      type: 'object',
      required: ['worldPoint'],
      properties: { worldPoint: Vec2 },
    },
  ],
} as const

const EdgeBase = {
  type: 'object',
  required: ['id', 'source', 'target', 'pathStyle', 'z', 'groups'],
  properties: {
    id: { type: 'string' },
    source: EdgeEnd,
    target: EdgeEnd,
    pathStyle: { type: 'string', enum: ['bezier', 'straight', 'polyline'] },
    z: { type: 'number' },
    groups: { type: 'array', items: { type: 'string' } },
    style: { type: 'object' },
    hidden: { type: 'boolean' },
  },
} as const

const GroupBase = {
  type: 'object',
  required: ['id', 'memberIds'],
  properties: {
    id: { type: 'string' },
    memberIds: { type: 'array', items: { type: 'string' } },
    name: { type: 'string' },
  },
} as const

/**
 * JSON-Schema definitions for every `Op` variant. Use to validate
 * agent-generated ops before calling `store.applyOp`, or to feed into
 * an LLM tool-use loop.
 *
 * @example
 * import Ajv from 'ajv'
 * const ajv = new Ajv()
 * const validate = ajv.compile(opSchemas.nodeAdd)
 * if (validate(generatedOp)) store.applyOp(generatedOp)
 */
export const opSchemas = {
  nodeAdd: {
    type: 'object',
    required: ['type', 'node'],
    properties: { type: { const: 'node.add' }, node: NodeBase },
  },
  nodeUpdate: {
    type: 'object',
    required: ['type', 'id', 'patch', 'prev'],
    properties: {
      type: { const: 'node.update' },
      id: { type: 'string' },
      patch: { type: 'object' },
      prev: { type: 'object' },
    },
  },
  nodeRemove: {
    type: 'object',
    required: ['type', 'node'],
    properties: { type: { const: 'node.remove' }, node: NodeBase },
  },
  edgeAdd: {
    type: 'object',
    required: ['type', 'edge'],
    properties: { type: { const: 'edge.add' }, edge: EdgeBase },
  },
  edgeUpdate: {
    type: 'object',
    required: ['type', 'id', 'patch', 'prev'],
    properties: {
      type: { const: 'edge.update' },
      id: { type: 'string' },
      patch: { type: 'object' },
      prev: { type: 'object' },
    },
  },
  edgeRemove: {
    type: 'object',
    required: ['type', 'edge'],
    properties: { type: { const: 'edge.remove' }, edge: EdgeBase },
  },
  groupUpsert: {
    type: 'object',
    required: ['type', 'group'],
    properties: { type: { const: 'group.upsert' }, group: GroupBase, prev: GroupBase },
  },
  groupRemove: {
    type: 'object',
    required: ['type', 'group'],
    properties: { type: { const: 'group.remove' }, group: GroupBase },
  },
} as const

/**
 * Tool definition in the Anthropic Messages API shape.
 */
export type AnthropicToolDef = {
  name: string
  description: string
  input_schema: object
}

/**
 * Returns op schemas wrapped as Anthropic Messages-API tool
 * definitions. Drop into the `tools` field of a `messages.create`
 * request to let an agent mutate the canvas directly.
 *
 * @example
 * const response = await anthropic.messages.create({
 *   model: 'claude-opus-4-7',
 *   tools: opSchemasAsAnthropicTools(),
 *   messages: [{ role: 'user', content: 'Add a red sticky note' }],
 * })
 * for (const block of response.content) {
 *   if (block.type === 'tool_use' && block.name.startsWith('canvas_')) {
 *     const op = toOp(block.name, block.input)
 *     store.applyOp(op)
 *   }
 * }
 */
export const opSchemasAsAnthropicTools = (): AnthropicToolDef[] => [
  {
    name: 'canvas_node_add',
    description: 'Add a new node to the canvas.',
    input_schema: opSchemas.nodeAdd,
  },
  {
    name: 'canvas_node_update',
    description: 'Update fields on an existing node.',
    input_schema: opSchemas.nodeUpdate,
  },
  {
    name: 'canvas_node_remove',
    description: 'Remove an existing node (the previous snapshot must be supplied for undo).',
    input_schema: opSchemas.nodeRemove,
  },
  {
    name: 'canvas_edge_add',
    description: 'Add a new edge connecting two nodes (or free world points).',
    input_schema: opSchemas.edgeAdd,
  },
  {
    name: 'canvas_edge_update',
    description: 'Update fields on an existing edge.',
    input_schema: opSchemas.edgeUpdate,
  },
  {
    name: 'canvas_edge_remove',
    description: 'Remove an existing edge.',
    input_schema: opSchemas.edgeRemove,
  },
]
