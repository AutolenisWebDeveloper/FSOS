// src/lib/ai/tools.ts
// Author model-invokable tools for the governed tool-calling loop (ADR-028) from a
// Zod schema, and enforce the per-agent authority contract. This is where the loop's
// abstract LoopTool is bound to FSOS's EXISTING governance vocabulary (§6 — one
// permission model, not a parallel one):
//   • `effect` sets the authority class; the v1 runner grants only 'read' (§11.1).
//   • `greenZone` ties the tool to the agent's roster green-zone set (roster.ts).
//     A tool the agent wasn't granted in AGENT_ROSTER can't be handed to the model.
// The Zod schema is the single source of truth for BOTH the input_schema advertised
// to the model AND the runtime validator that fails closed before any handler runs.

import { z } from 'zod'
import type { GreenZoneTool } from './roster'
import type { LoopTool, ToolEffect, ValidationResult } from './tool-loop'

/** A LoopTool that also carries its green-zone category for per-agent authorization. */
export interface GreenLoopTool extends LoopTool {
  greenZone: GreenZoneTool
}

export interface ZodToolSpec<S extends z.ZodType> {
  name: string
  description: string
  /** Authority class. v1 tools are 'read' (non-mutating, non-dispatching). */
  effect: ToolEffect
  /** The agent green-zone category this tool belongs to (must be in the agent's roster set). */
  greenZone: GreenZoneTool
  /** Input contract — drives both the model's input_schema and runtime validation. */
  schema: S
  handler: (input: z.infer<S>) => Promise<string>
}

/**
 * Minimal, explicit Zod → JSON Schema conversion for tool inputs. Supports the
 * shapes tool inputs actually use; throws loudly on anything unsupported so we never
 * silently advertise a wrong schema to the model (§4.3 — no invented behavior).
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def: any = schema._def
  const typeName: string = def.typeName
  const desc = schema.description
  const withDesc = (o: Record<string, unknown>) => (desc ? { ...o, description: desc } : o)

  switch (typeName) {
    case 'ZodString':
      return withDesc({ type: 'string' })
    case 'ZodNumber':
      return withDesc({ type: 'number' })
    case 'ZodBoolean':
      return withDesc({ type: 'boolean' })
    case 'ZodEnum':
      return withDesc({ type: 'string', enum: def.values })
    case 'ZodArray':
      return withDesc({ type: 'array', items: zodToJsonSchema(def.type) })
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return zodToJsonSchema(def.innerType)
    case 'ZodObject': {
      const shape = def.shape()
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, value] of Object.entries(shape)) {
        const v = value as z.ZodTypeAny
        properties[key] = zodToJsonSchema(v)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inner: string = (v._def as any).typeName
        if (inner !== 'ZodOptional' && inner !== 'ZodDefault') required.push(key)
      }
      return withDesc({
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      })
    }
    default:
      throw new Error(`zodTool: unsupported Zod type "${typeName}" — add explicit JSON-schema support`)
  }
}

/** Build a governed, model-invokable tool from a Zod schema. */
export function zodTool<S extends z.ZodType>(spec: ZodToolSpec<S>): GreenLoopTool {
  const jsonSchema = zodToJsonSchema(spec.schema as unknown as z.ZodTypeAny)
  return {
    name: spec.name,
    description: spec.description,
    effect: spec.effect,
    greenZone: spec.greenZone,
    jsonSchema,
    validate: (input: unknown): ValidationResult => {
      const parsed = spec.schema.safeParse(input)
      if (parsed.success) return { ok: true, value: parsed.data }
      const error = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
      return { ok: false, error }
    },
    handler: (input: unknown) => spec.handler(input as z.infer<S>),
  }
}

/** Thrown when a tool exceeds the authority the caller is allowed to grant. */
export class ToolAuthorityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolAuthorityError'
  }
}

/**
 * Assert every tool is within (a) the granted authority ceiling and (b) THIS agent's
 * roster green-zone set. Pure and unit-tested (tests/ai-tool-authority.test.mjs) so
 * the permission binding can't silently drift. Called by the runner before the loop.
 */
export function assertToolAuthority(
  agentGreenZone: readonly GreenZoneTool[],
  tools: GreenLoopTool[],
  allowedEffects: Set<ToolEffect>,
): void {
  for (const t of tools) {
    if (!allowedEffects.has(t.effect)) {
      throw new ToolAuthorityError(
        `tool "${t.name}" effect "${t.effect}" exceeds granted authority ` +
          `(allowed: ${[...allowedEffects].join(', ') || 'none'})`,
      )
    }
    if (!agentGreenZone.includes(t.greenZone)) {
      throw new ToolAuthorityError(
        `tool "${t.name}" green-zone "${t.greenZone}" is not in this agent's roster set ` +
          `(granted: ${agentGreenZone.join(', ') || 'none'})`,
      )
    }
  }
}
