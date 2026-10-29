import { generateText, Output, stepCountIs, tool, type UserContent } from "ai";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { z } from "zod";
import { model } from "../ai";
import type { Milestone, Submission, Verdict } from "../db";

const verdictSchema = z.object({
  overall: z.enum(["pass", "fail", "partial"]),
  confidence: z.number().min(0).max(1).describe("How sure you are, given the evidence you could actually inspect"),
  summary: z.string().describe("2-3 sentences a non-technical client can understand"),
  criteria: z.array(
    z.object({
      id: z.string(),
      met: z.boolean(),
      evidence: z.string().describe("What you inspected and what you found. Quote or cite specifics."),
    }),
  ),
  feedback_for_freelancer: z.string().describe("Concrete, actionable fixes for unmet criteria; empty if all met"),
});

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// The verifier fetches URLs chosen by the freelancer, from our server. In production, refuse
// anything that resolves to a private, loopback or link-local address (e.g. cloud metadata).
const privateRanges = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4],
] as const) privateRanges.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10]] as const)
  privateRanges.addSubnet(net, bits, "ipv6");

export async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`Only http(s) links can be inspected`);
  if (process.env.NODE_ENV !== "production") return;
  const host = u.hostname.replace(/^[|]$/g, "");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const { address, family } of addrs) {
    const v4 = address.match(/^::ffff:(d+.d+.d+.d+)$/)?.[1];
    if (privateRanges.check(v4 ?? address, v4 || family === 4 ? "ipv4" : "ipv6"))
      throw new Error(`${u.hostname} is not a public address`);
  }
}

// fetch() with redirects checked hop by hop, so a public URL can't bounce to a private one.
async function safeFetch(url: string, init: RequestInit) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const next = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !next) return res;
    current = new URL(next, current).toString();
  }
  throw new Error("Too many redirects");
}

async function inspectUrl(url: string): Promise<string> {
  const gh = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/);
  const headers = { "User-Agent": "Vouch-Verifier/1.0" };
  const signal = AbortSignal.timeout(12_000);
  if (gh) {
    // For repos, the README and file tree say far more than the rendered HTML page.
    const [, owner, repo] = gh;
    const api = `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, "")}`;
    const [meta, readme, tree] = await Promise.all([
      fetch(api, { headers, signal }).then((r) => r.json()),
      fetch(`${api}/readme`, { headers: { ...headers, Accept: "application/vnd.github.raw" }, signal }).then((r) =>
        r.ok ? r.text() : "(no README)",
      ),
      fetch(`${api}/git/trees/HEAD?recursive=1`, { headers, signal }).then((r) => r.json()),
    ]);
    const files = ((tree?.tree ?? []) as { path: string; type: string }[])
      .filter((f) => f.type === "blob")
      .map((f) => f.path)
      .slice(0, 200);
    return [
      `GitHub repo ${owner}/${repo}: ${meta?.description ?? ""} (pushed ${meta?.pushed_at ?? "?"}, license ${meta?.license?.spdx_id ?? "none"})`,
      `Files (${files.length}):\n${files.join("\n")}`,
      `README:\n${readme.slice(0, 8000)}`,
    ].join("\n\n");
  }
  const res = await safeFetch(url, { headers, signal });
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const text = type.includes("html") ? htmlToText(body) : body;
  const title = body.match(/<title>([^<]*)<\/title>/i)?.[1] ?? "";
  const viewport = /<meta[^>]+name=["']viewport["']/i.test(body);
  return `HTTP ${res.status} ${type}\nTitle: ${title}\nHas mobile viewport meta: ${viewport}\n\n${text.slice(0, 12000)}`;
}

const SYSTEM = `You are the Delivery Verifier at Vouch, an AI escrow service. Money for this milestone is held in PayPal escrow
and will be released to the freelancer based on your report, so be rigorous and fair to BOTH sides.

Process:
1. Read the acceptance criteria.
2. Use inspect_url on every link the freelancer submitted (and relevant pages they point to). Do not trust claims you have not checked.
3. Judge each criterion strictly by the evidence. If a criterion cannot be verified from what was submitted, it is NOT met; say what evidence is missing.
4. overall = "pass" only if every criterion is met; "partial" if most are met and the gaps are minor; otherwise "fail".`;

export async function verifySubmission(milestone: Milestone, submission: Submission): Promise<{ verdict: Verdict; inspected: string[] }> {
  const inspected: string[] = [];
  const content: UserContent = [
    {
      type: "text",
      text: [
        `Milestone: ${milestone.title}`,
        `Description: ${milestone.description}`,
        `Acceptance criteria:`,
        ...milestone.criteria.map((c) => `- [${c.id}] ${c.text}`),
        ``,
        `Freelancer's submission note:\n${submission.note}`,
        `Links: ${submission.links.length ? submission.links.join(", ") : "(none)"}`,
        submission.image ? `A screenshot is attached.` : ``,
      ].join("\n"),
    },
  ];
  if (submission.image) content.push({ type: "image", image: submission.image });

  const { output } = await generateText({
    model: model(),
    system: SYSTEM,
    messages: [{ role: "user", content }],
    tools: {
      inspect_url: tool({
        description: "Fetch a URL and return its readable content. For GitHub repos returns metadata, file tree and README.",
        inputSchema: z.object({ url: z.string().url() }),
        execute: async ({ url }) => {
          inspected.push(url);
          try {
            return await inspectUrl(url);
          } catch (e) {
            return `Could not fetch ${url}: ${String(e)}`;
          }
        },
      }),
    },
    stopWhen: stepCountIs(8),
    output: Output.object({ schema: verdictSchema }),
  });
  return { verdict: output, inspected };
}
