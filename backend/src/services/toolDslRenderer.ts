/**
 * Tool Definition DSL Renderer
 *
 * Renders a ToolDSL into the model-facing ToolDefinition. This is the
 * translation layer that composes the final description sent to the LLM
 * FROM the DSL fields, and compiles input_schema with format hints folded in.
 */

import type { ToolDSL, ToolDefinition } from '../types.js';

/**
 * Compose the model-facing description from DSL fields.
 *
 * Old flat schema: just the stored description string.
 * New: intent + when_to_use + error guidance + sequencing notes.
 */
export function renderDescription(dsl: ToolDSL): string {
  const parts: string[] = [];

  // Core intent
  if (dsl.intent) parts.push(dsl.intent);

  // Decision rule for when to use
  if (dsl.when_to_use) parts.push(`When to use: ${dsl.when_to_use}`);

  // Error semantics — short note on notable codes
  if (dsl.error_semantics && dsl.error_semantics.length > 0) {
    const notes = dsl.error_semantics
      .map(e => `${e.condition}: ${e.meaning}`)
      .join('; ');
    parts.push(`Error handling: ${notes}`);
  }

  // Sequencing
  if (dsl.sequencing) {
    const notes: string[] = [];
    if (dsl.sequencing.typically_follows?.length) {
      notes.push(`typically follows: ${dsl.sequencing.typically_follows.join(', ')}`);
    }
    if (dsl.sequencing.typically_precedes?.length) {
      notes.push(`typically precedes: ${dsl.sequencing.typically_precedes.join(', ')}`);
    }
    if (notes.length) parts.push(`Sequencing: ${notes.join('; ')}`);
  }

  // Side effects
  if (dsl.side_effects !== 'none') {
    parts.push(`Side effects: ${dsl.side_effects.replace(/_/g, ' ')}.`);
  }

  return parts.join('\n\n');
}

/**
 * Render DSL parameters into a JSON Schema input_schema for the model.
 * Format hints and examples are folded into each property's description
 * so the model sees them at argument-fill time.
 */
export function renderInputSchema(dsl: ToolDSL): ToolDefinition['input_schema'] {
  const properties: Record<string, ToolDefinition['input_schema']['properties'][string]> = {};
  const required: string[] = [];

  for (const param of dsl.parameters) {
    let desc = param.description;
    if (param.format_hint) desc += ` (${param.format_hint})`;
    if (param.example) desc += ` e.g. "${param.example}"`;

    properties[param.name] = {
      type: param.json_type,
      description: desc,
      enum: param.enum_values,
    };

    if (param.required) required.push(param.name);
  }

  // Compile parameter_groups into JSON Schema constraints
  const schema: ToolDefinition['input_schema'] = {
    type: 'object',
    properties,
    required: required.length > 0 ? required : undefined,
  };

  // require_one_of → oneOf at schema level
  const oneOfGroups = (dsl.parameter_groups ?? []).filter(g => g.type === 'require_one_of');
  if (oneOfGroups.length > 0) {
    // Use dependentRequired: if any param in the group is present, at least one must be
    // JSON Schema doesn't have native "require one of" — we encode as description guidance
    // and add dependent validation in the execution layer
    const groupDesc = oneOfGroups
      .map(g => `one of [${g.params.join(', ')}] is required`)
      .join('; ');
    if (schema.properties) {
      for (const param of dsl.parameters) {
        const group = oneOfGroups.find(g => g.params.includes(param.name));
        if (group) {
          const existing = properties[param.name]?.description ?? '';
          properties[param.name] = {
            ...properties[param.name]!,
            description: `${existing} — ${groupDesc}`,
          };
        }
      }
    }
  }

  // require_together → all must be present if any is
  const togetherGroups = (dsl.parameter_groups ?? []).filter(g => g.type === 'require_together');
  if (togetherGroups.length > 0) {
    const groupDesc = togetherGroups
      .map(g => `[${g.params.join(', ')}] must all be provided together`)
      .join('; ');
    if (schema.properties) {
      for (const param of dsl.parameters) {
        const group = togetherGroups.find(g => g.params.includes(param.name));
        if (group) {
          const existing = properties[param.name]?.description ?? '';
          properties[param.name] = {
            ...properties[param.name]!,
            description: `${existing} — ${groupDesc}`,
          };
        }
      }
    }
  }

  return schema;
}

/**
 * Render a full ToolDSL into a model-facing ToolDefinition.
 * This is the single translation point — every downstream consumer
 * (the model schema, the execution layer) sees the output.
 */
export function renderToolDefinition(dsl: ToolDSL): ToolDefinition {
  return {
    name: dsl.name,
    description: renderDescription(dsl),
    input_schema: renderInputSchema(dsl),
    execution: dsl.execution,
    auth: dsl.auth,
    parameter_groups: dsl.parameter_groups,
  };
}
