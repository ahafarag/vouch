// Verifies .env.local before running the app: PayPal auth, order creation, Payouts access, and the AI model.
// Usage: npm run check   (add --payout to also send a real $1.00 sandbox payout to DEMO_FREELANCER_EMAIL)
import { generateText } from "ai";

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
let failures = 0;

async function step(name: string, fn: () => Promise<string>) {
  try {
    ok(`${name}: ${await fn()}`);
  } catch (e) {
    failures++;
    fail(`${name}: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
  }
}

console.log("\nEnvironment");
for (const k of ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "DEMO_CLIENT_EMAIL", "DEMO_FREELANCER_EMAIL"]) {
  if (process.env[k]) ok(k);
  else {
    failures++;
    fail(`${k} is not set`);
  }
}
if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) ok("AI key present");
else {
  failures++;
  fail("Set ANTHROPIC_API_KEY or OPENAI_API_KEY");
}

const paypal = await import("../src/lib/paypal");
const { model, modelLabel, paypalReadTools } = await import("../src/lib/ai");

console.log("\nPayPal sandbox");
let orderId = "";
await step("Create escrow order", async () => {
  const o = await paypal.createEscrowOrder({
    milestoneId: "setup-check",
    projectTitle: "Setup check",
    milestoneTitle: "Test",
    amount: 1,
    currency: "USD",
  });
  orderId = o.id;
  return `${o.id} (${o.status})`;
});
await step("Agent Toolkit get_order", async () => {
  const tools = paypalReadTools();
  const raw = await tools.paypal_get_order.execute!({ id: orderId }, { toolCallId: "check", messages: [] } as never);
  // The toolkit reports failures as a returned string/object rather than throwing.
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (/error/i.test(text)) throw new Error(text.slice(0, 200));
  return `status ${text.match(/"status"\s*:\s*"(\w+)"/)?.[1] ?? "?"}`;
});
if (process.argv.includes("--payout")) {
  await step("Payout $1.00 to freelancer", async () => {
    const r = await paypal.payoutToFreelancer({
      receiverEmail: process.env.DEMO_FREELANCER_EMAIL!,
      amount: 1,
      currency: "USD",
      note: "Vouch setup check",
      idempotencyKey: `setup-check-${Date.now()}`,
    });
    return `batch ${r.batchId} (${r.status})`;
  });
} else {
  console.log("  - Payouts not tested (run with --payout to send a $1 sandbox payout)");
}

console.log(`\nAI (${modelLabel()})`);
await step("Model responds", async () => {
  const { text } = await generateText({ model: model(), prompt: "Reply with exactly: ready" });
  return text.trim().slice(0, 40);
});

console.log(failures ? `\n${failures} check(s) failed.\n` : "\nAll checks passed. Run `npm run dev`.\n");
process.exit(failures ? 1 : 0);
