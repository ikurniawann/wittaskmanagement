import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sessionActor } from "@/lib/auth/session-actor";
import { can } from "@/lib/permissions";
import { getPlayWorld } from "@/lib/play/service";
import { isPlayEnabled } from "@/lib/play/settings";
import { PlayCanvas } from "./play-canvas";

export const metadata: Metadata = { title: "Play" };
export const dynamic = "force-dynamic";

// EPIC-024 T-240 — Backstage Play. The org flag decides whether the route
// exists at all (off → 404, exactly like a feature that was never shipped);
// the capability decides who may enter; the snapshot decides what they see.
export default async function PlayPage({ searchParams }: PageProps<"/play">) {
  const actor = await sessionActor();
  if (!actor) redirect("/login");
  if (!(await isPlayEnabled())) notFound();
  if (!can(actor, "play.view")) redirect("/my-tasks");
  const sp = await searchParams;
  const focusTask = typeof sp.task === "string" ? sp.task : null;
  const focusMe = sp.focus === "me";
  const world = await getPlayWorld(actor);
  return <PlayCanvas world={world} focusTask={focusTask} focusMe={focusMe} />;
}
