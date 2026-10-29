import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type Criterion = { id: string; text: string };

export type MilestoneStatus =
  | "draft" // created, not yet funded
  | "funded" // client paid into escrow
  | "submitted" // freelancer submitted, AI reviewing
  | "revision" // AI or client asked for changes
  | "awaiting_client" // AI passed it, client must confirm (auto-release off)
  | "disputed" // client disputed, waiting for mediator
  | "released" // freelancer paid in full
  | "refunded" // client refunded in full
  | "split"; // mediator split funds

export type Project = {
  id: string;
  title: string;
  summary: string;
  client_name: string;
  client_email: string;
  freelancer_name: string;
  freelancer_email: string;
  currency: string;
  auto_release: number;
  created_at: string;
};

export type Milestone = {
  id: string;
  project_id: string;
  idx: number;
  title: string;
  description: string;
  amount: number;
  due_days: number;
  criteria: Criterion[];
  status: MilestoneStatus;
  order_id: string | null;
  capture_id: string | null;
  released: number;
  refunded: number;
};

export type Verdict = {
  overall: "pass" | "fail" | "partial";
  confidence: number;
  summary: string;
  criteria: { id: string; met: boolean; evidence: string }[];
  feedback_for_freelancer: string;
};

export type Submission = {
  id: string;
  milestone_id: string;
  note: string;
  links: string[];
  image: string | null;
  verdict: Verdict | null;
  created_at: string;
};

export type Statement = { party: "client" | "freelancer"; text: string; created_at: string };

export type Dispute = {
  id: string;
  milestone_id: string;
  statements: Statement[];
  ruling: Ruling | null;
  created_at: string;
};

export type Ruling = {
  freelancer_share_pct: number;
  release_amount: number;
  refund_amount: number;
  reasoning: string;
};

export type Actor = "client" | "freelancer" | "ai" | "paypal" | "system";

export type LedgerEvent = {
  id: string;
  project_id: string;
  milestone_id: string | null;
  type: string;
  actor: Actor;
  message: string;
  amount: number | null;
  paypal_ref: string | null;
  created_at: string;
};

const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "vouch.db");
mkdirSync(path.dirname(dbPath), { recursive: true });

const g = globalThis as unknown as { __vouchDb?: DatabaseSync };
const db = g.__vouchDb ?? new DatabaseSync(dbPath);
g.__vouchDb = db;

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, title TEXT, summary TEXT,
    client_name TEXT, client_email TEXT, freelancer_name TEXT, freelancer_email TEXT,
    currency TEXT, auto_release INTEGER, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS milestones (
    id TEXT PRIMARY KEY, project_id TEXT, idx INTEGER, title TEXT, description TEXT,
    amount REAL, due_days INTEGER, criteria TEXT, status TEXT,
    order_id TEXT, capture_id TEXT, released REAL DEFAULT 0, refunded REAL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY, milestone_id TEXT, note TEXT, links TEXT, image TEXT,
    verdict TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY, milestone_id TEXT, statements TEXT, ruling TEXT, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, project_id TEXT, milestone_id TEXT, type TEXT, actor TEXT,
    message TEXT, amount REAL, paypal_ref TEXT, created_at TEXT
  );
`);

const now = () => new Date().toISOString();
type Row = Record<string, unknown>;

function toMilestone(r: Row): Milestone {
  return { ...(r as unknown as Milestone), criteria: JSON.parse(r.criteria as string) };
}
function toSubmission(r: Row): Submission {
  return {
    ...(r as unknown as Submission),
    links: JSON.parse(r.links as string),
    verdict: r.verdict ? JSON.parse(r.verdict as string) : null,
  };
}
function toDispute(r: Row): Dispute {
  return {
    ...(r as unknown as Dispute),
    statements: JSON.parse(r.statements as string),
    ruling: r.ruling ? JSON.parse(r.ruling as string) : null,
  };
}

export function createProject(
  p: Omit<Project, "id" | "created_at">,
  milestones: Pick<Milestone, "title" | "description" | "amount" | "due_days" | "criteria">[],
): string {
  const id = randomUUID().slice(0, 8);
  db.prepare(
    `INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, p.title, p.summary, p.client_name, p.client_email, p.freelancer_name, p.freelancer_email, p.currency, p.auto_release, now());
  const ins = db.prepare(
    `INSERT INTO milestones (id, project_id, idx, title, description, amount, due_days, criteria, status)
     VALUES (?,?,?,?,?,?,?,?, 'draft')`,
  );
  milestones.forEach((m, i) =>
    ins.run(randomUUID().slice(0, 8), id, i, m.title, m.description, m.amount, m.due_days, JSON.stringify(m.criteria)),
  );
  logEvent({ project_id: id, type: "contract_created", actor: "client", message: `Contract "${p.title}" created with ${milestones.length} milestones` });
  return id;
}

export function listProjects(): (Project & { total: number; released: number; escrowed: number })[] {
  return db
    .prepare(
      `SELECT p.*,
         COALESCE(SUM(m.amount),0) AS total,
         COALESCE(SUM(m.released),0) AS released,
         COALESCE(SUM(CASE WHEN m.capture_id IS NOT NULL THEN m.amount - m.released - m.refunded ELSE 0 END),0) AS escrowed
       FROM projects p LEFT JOIN milestones m ON m.project_id = p.id
       GROUP BY p.id ORDER BY p.created_at DESC`,
    )
    .all() as never;
}

export function getProject(id: string): Project | undefined {
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Project | undefined;
}

export function getMilestones(projectId: string): Milestone[] {
  return (db.prepare(`SELECT * FROM milestones WHERE project_id = ? ORDER BY idx`).all(projectId) as Row[]).map(toMilestone);
}

export function getMilestone(id: string): Milestone | undefined {
  const r = db.prepare(`SELECT * FROM milestones WHERE id = ?`).get(id) as Row | undefined;
  return r ? toMilestone(r) : undefined;
}

export function updateMilestone(id: string, patch: Partial<Omit<Milestone, "id" | "criteria">>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE milestones SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
    ...(Object.values(patch) as (string | number | null)[]),
    id,
  );
}

export function addSubmission(milestoneId: string, note: string, links: string[], image: string | null): string {
  const id = randomUUID().slice(0, 8);
  db.prepare(`INSERT INTO submissions VALUES (?,?,?,?,?,NULL,?)`).run(id, milestoneId, note, JSON.stringify(links), image, now());
  return id;
}

export function setVerdict(submissionId: string, verdict: Verdict) {
  db.prepare(`UPDATE submissions SET verdict = ? WHERE id = ?`).run(JSON.stringify(verdict), submissionId);
}

export function getSubmissions(milestoneId: string): Submission[] {
  return (db.prepare(`SELECT * FROM submissions WHERE milestone_id = ? ORDER BY created_at`).all(milestoneId) as Row[]).map(toSubmission);
}

export function getDispute(milestoneId: string): Dispute | undefined {
  const r = db.prepare(`SELECT * FROM disputes WHERE milestone_id = ? ORDER BY created_at DESC LIMIT 1`).get(milestoneId) as Row | undefined;
  return r ? toDispute(r) : undefined;
}

export function openDispute(milestoneId: string, statement: string): Dispute {
  const d: Dispute = {
    id: randomUUID().slice(0, 8),
    milestone_id: milestoneId,
    statements: [{ party: "client", text: statement, created_at: now() }],
    ruling: null,
    created_at: now(),
  };
  db.prepare(`INSERT INTO disputes VALUES (?,?,?,NULL,?)`).run(d.id, milestoneId, JSON.stringify(d.statements), d.created_at);
  return d;
}

export function addStatement(disputeId: string, statements: Statement[]) {
  db.prepare(`UPDATE disputes SET statements = ? WHERE id = ?`).run(JSON.stringify(statements), disputeId);
}

export function setRuling(disputeId: string, ruling: Ruling) {
  db.prepare(`UPDATE disputes SET ruling = ? WHERE id = ?`).run(JSON.stringify(ruling), disputeId);
}

export function logEvent(e: Omit<LedgerEvent, "id" | "created_at" | "milestone_id" | "amount" | "paypal_ref"> & Partial<LedgerEvent>) {
  db.prepare(`INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)`).run(
    randomUUID(),
    e.project_id,
    e.milestone_id ?? null,
    e.type,
    e.actor,
    e.message,
    e.amount ?? null,
    e.paypal_ref ?? null,
    now(),
  );
}

export function getEvents(projectId?: string): (LedgerEvent & { project_title: string; milestone_title: string | null })[] {
  const sql = `SELECT e.*, p.title AS project_title, m.title AS milestone_title
               FROM events e JOIN projects p ON p.id = e.project_id
               LEFT JOIN milestones m ON m.id = e.milestone_id
               ${projectId ? "WHERE e.project_id = ?" : ""}
               ORDER BY e.created_at DESC`;
  return (projectId ? db.prepare(sql).all(projectId) : db.prepare(sql).all()) as never;
}
