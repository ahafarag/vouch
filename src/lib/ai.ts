import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { tool, type LanguageModel, type ToolSet } from "ai";
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";

// Claude is the default; OpenAI is a drop-in fallback so judges can run with whichever key they have.
export function model(): LanguageModel {
  if (process.env.ANTHROPIC_API_KEY) return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5");
  if (process.env.OPENAI_API_KEY) return openai(process.env.OPENAI_MODEL ?? "gpt-5.5");
  throw new Error("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
}

export function modelLabel() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_MODEL ?? "gpt-5.5";
  return "no model configured";
}

let toolkit: PayPalAgentToolkit | null = null;

// Read-only PayPal tools from the official agent toolkit. The toolkit targets AI SDK v4,
// so each tool is re-wrapped with the v7 `tool()` helper (same zod schema, same executor).
export function paypalReadTools(): ToolSet {
  toolkit ??= new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: {
      actions: {
        orders: { get: true },
        payments: { getRefunds: true },
      },
      context: { sandbox: process.env.PAYPAL_ENVIRONMENT !== "PRODUCTION" },
    },
  });
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(toolkit.getTools())) {
    const legacy = t as unknown as {
      description: string;
      parameters: never;
      execute: (args: unknown) => Promise<unknown>;
    };
    out[`paypal_${name}`] = tool({
      description: legacy.description,
      inputSchema: legacy.parameters,
      execute: async (args: unknown) => {
        try {
          return await legacy.execute(args);
        } catch (e) {
          return { error: String(e) };
        }
      },
    });
  }
  return out;
}
