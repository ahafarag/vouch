import { generateText, Output } from "ai";
import { z } from "zod";
import { model } from "../ai";

export const contractSchema = z.object({
  title: z.string().describe("Short project title, max 60 chars"),
  summary: z.string().describe("One-paragraph plain-English summary of the engagement"),
  milestones: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().describe("What will be delivered in this milestone"),
        amount: z.number().describe("Price in the contract currency; all milestones must sum to the budget"),
        due_days: z.number().int().describe("Days after funding that this milestone is due"),
        criteria: z
          .array(z.string())
          .min(2)
          .max(5)
          .describe("Objective, independently verifiable acceptance criteria"),
      }),
    )
    .min(1)
    .max(5),
  risks: z.array(z.string()).max(3).describe("Ambiguities in the brief the client should clarify before funding"),
});

export type DraftContract = z.infer<typeof contractSchema>;

const SYSTEM = `You are the Contract Architect at Vouch, an escrow service for freelance work paid through PayPal.
Turn a client's informal job brief into a milestone contract that an impartial AI reviewer can later verify.

Rules:
- 2-4 milestones for most jobs. Front-load a small first milestone so trust builds early.
- Milestone amounts MUST sum exactly to the stated budget. Use whole currency units.
- Every acceptance criterion must be objectively checkable from a deliverable (a URL, repo, file, screenshot or written report).
  Good: "Landing page is live at a public URL and loads on mobile width (375px) without horizontal scroll".
  Bad: "Looks professional", "Client is happy".
- Do not invent requirements the client didn't imply; list genuine ambiguities under risks instead.`;

export async function draftContract(brief: string, budget: number, currency: string): Promise<DraftContract> {
  const { output } = await generateText({
    model: model(),
    system: SYSTEM,
    prompt: `Budget: ${budget} ${currency}\n\nClient brief:\n${brief}`,
    output: Output.object({ schema: contractSchema }),
  });
  // Models occasionally drift by a unit or two; snap the last milestone so totals always match.
  const sum = output.milestones.reduce((s, m) => s + m.amount, 0);
  if (Math.abs(sum - budget) > 0.001) output.milestones.at(-1)!.amount += budget - sum;
  return output;
}
