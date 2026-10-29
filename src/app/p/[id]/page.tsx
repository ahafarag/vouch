import { notFound } from "next/navigation";
import * as db from "@/lib/db";
import { modelLabel } from "@/lib/ai";
import { Workspace } from "@/components/Workspace";
import { syncPending } from "@/lib/transfers";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ as?: string }>;
}) {
  const { id } = await params;
  const { as } = await searchParams;
  const project = db.getProject(id);
  if (!project) notFound();
  await syncPending(id);
  const transfers = db.getTransfers({ projectId: id });
  const milestones = db.getMilestones(id).map((m) => ({
    ...m,
    submissions: db.getSubmissions(m.id),
    dispute: db.getDispute(m.id) ?? null,
    transfers: transfers.filter((t) => t.milestone_id === m.id),
  }));
  return (
    <Workspace
      project={project}
      milestones={milestones}
      events={db.getEvents(id)}
      role={as === "freelancer" ? "freelancer" : "client"}
      paypalClientId={process.env.PAYPAL_CLIENT_ID ?? ""}
      model={modelLabel()}
    />
  );
}
