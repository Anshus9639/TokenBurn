import { z } from "zod";

const contentPartSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  z
    .object({
      type: z.literal("image_url"),
      image_url: z.object({ url: z.string().min(1), detail: z.enum(["auto", "low", "high"]).optional() }),
    })
    .passthrough(),
]);

const toolCallSchema = z
  .object({
    id: z.string().optional(),
    type: z.literal("function").optional(),
    function: z.object({ name: z.string().min(1), arguments: z.string() }).passthrough(),
  })
  .passthrough();

const messageSchema = z
  .object({
    role: z.enum(["system", "developer", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.array(contentPartSchema), z.null()]).optional(),
    name: z.string().max(120).optional(),
    tool_calls: z.array(toolCallSchema).optional(),
    tool_call_id: z.string().optional(),
  })
  .passthrough();

const toolSchema = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().min(1).max(120),
        description: z.string().optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
        strict: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const responseFormatSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text") }).passthrough(),
  z.object({ type: z.literal("json_object") }).passthrough(),
  z
    .object({
      type: z.literal("json_schema"),
      json_schema: z
        .object({
          name: z.string().min(1),
          schema: z.record(z.string(), z.unknown()),
          strict: z.boolean().optional(),
          description: z.string().optional(),
        })
        .passthrough(),
    })
    .passthrough(),
]);

const toolChoiceSchema = z.union([
  z.enum(["auto", "none", "required"]),
  z.object({ type: z.literal("function"), function: z.object({ name: z.string().min(1) }) }),
]);

export const gatewayRequestSchema = z
  .object({
    model: z.string().trim().min(1).max(120).optional(),
    messages: z.array(messageSchema).min(1).max(200),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().min(1).max(50_000_000).optional(),
    max_completion_tokens: z.number().int().min(1).max(50_000_000).optional(),
    stop: z.union([z.string(), z.array(z.string()).max(4)]).optional(),
    stream: z.boolean().optional(),
    stream_options: z.record(z.string(), z.unknown()).optional(),
    response_format: responseFormatSchema.optional(),
    tools: z.array(toolSchema).max(128).optional(),
    tool_choice: toolChoiceSchema.optional(),
    seed: z.number().int().optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    user: z.string().max(200).optional(),
    n: z.literal(1).optional(),
    tokenburn: z
      .object({
        mode: z.string().trim().max(40).optional(),
        strategy: z.string().trim().max(40).optional(),
        feature: z.string().trim().max(80).optional(),
        baselineModel: z.string().trim().max(120).optional(),
        environment: z.string().trim().max(40).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type GatewayRequestBody = z.infer<typeof gatewayRequestSchema>;
