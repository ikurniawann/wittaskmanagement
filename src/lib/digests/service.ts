import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { listMyQueue } from "@/lib/approvals/service";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { type Actor } from "@/lib/permissions";
import { getActor } from "@/lib/permissions/actor";
import { listMyTasks } from "@/lib/tasks/service";
import { toWibParts } from "@/lib/tasks/dates";

// Digest emails (T-100). Strictly opt-in per profile; content is built from
// the SAME permission-scoped services the pages use, so a digest can never
// leak data its recipient could not open in the app.

const dt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  timeZone: "Asia/Jakarta",
});

function wibKey(date: Date): string {
  const p = toWibParts(date);
  return `${p.y}-${p.m}-${p.d}`;
}

function idr(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

// ---- daily personal digest ------------------------------------------------

export async function buildDailyDigest(
  actor: Actor,
  now = new Date(),
): Promise<{ subject: string; text: string } | null> {
  const [mine, queue] = await Promise.all([
    listMyTasks(actor),
    listMyQueue(actor).catch(() => []),
  ]);

  const todayKey = wibKey(now);
  const overdue = mine.filter(
    (r) => r.task.dueDate && r.task.dueDate < now && wibKey(r.task.dueDate) !== todayKey,
  );
  const dueToday = mine.filter(
    (r) => r.task.dueDate && wibKey(r.task.dueDate) === todayKey,
  );
  const upcoming = mine.filter(
    (r) =>
      r.task.dueDate &&
      r.task.dueDate > now &&
      wibKey(r.task.dueDate) !== todayKey &&
      r.task.dueDate.getTime() - now.getTime() < 3 * 86_400_000,
  );

  if (
    overdue.length === 0 &&
    dueToday.length === 0 &&
    upcoming.length === 0 &&
    queue.length === 0
  ) {
    return null; // nothing to say — don't send an empty email
  }

  const { getBranding, fullName } = await import("@/lib/org/branding");
  const brand = fullName(await getBranding());
  const lines: string[] = [`Good morning — your day at a glance.`, ""];
  const block = (
    title: string,
    rows: typeof mine,
  ) => {
    if (rows.length === 0) return;
    lines.push(`${title} (${rows.length})`);
    for (const r of rows.slice(0, 10)) {
      const due = r.task.dueDate ? ` — due ${dt.format(r.task.dueDate)}` : "";
      lines.push(`  • ${r.task.title} [${r.eventName}]${due}`);
      lines.push(`    ${env.APP_URL}/tasks/${r.task.id}`);
    }
    if (rows.length > 10) lines.push(`  … and ${rows.length - 10} more`);
    lines.push("");
  };
  block("OVERDUE", overdue);
  block("DUE TODAY", dueToday);
  block("DUE IN THE NEXT 3 DAYS", upcoming);

  if (queue.length > 0) {
    lines.push(`AWAITING YOUR APPROVAL (${queue.length})`);
    for (const a of queue.slice(0, 10)) {
      const amount = a.amount !== null ? ` — ${idr(a.amount)}` : "";
      lines.push(`  • ${a.title}${amount}`);
      lines.push(`    ${env.APP_URL}/approvals/${a.id}`);
    }
    lines.push("");
  }

  lines.push("Manage digests: " + env.APP_URL + "/settings");
  lines.push(`— ${brand}`);

  const headline = [
    overdue.length > 0 ? `${overdue.length} overdue` : null,
    dueToday.length > 0 ? `${dueToday.length} due today` : null,
    queue.length > 0 ? `${queue.length} to approve` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    subject: `[${brand}] Daily digest — ${headline || "upcoming work"}`,
    text: lines.join("\n"),
  };
}

// ---- weekly executive digest ----------------------------------------------

export async function buildWeeklyExecutiveDigest(
  actor: Actor,
): Promise<{ subject: string; text: string } | null> {
  // executive content — same gates as the dashboard page
  const { getPortfolio, getOverdueHotspots } = await import(
    "@/lib/dashboard/service"
  );
  const { portfolioSales } = await import("@/lib/tickets/service");

  const [portfolio, hotspots, sales, queue] = await Promise.all([
    getPortfolio(actor),
    getOverdueHotspots(actor),
    portfolioSales(actor),
    listMyQueue(actor),
  ]);
  if (portfolio.length === 0) return null;

  const { getBranding, fullName } = await import("@/lib/org/branding");
  const brand = fullName(await getBranding());
  const lines: string[] = ["The week across the portfolio.", ""];
  lines.push("EVENTS");
  for (const event of portfolio) {
    const burn =
      event.burnPct !== null
        ? `burn ${event.burnPct}% of ${idr(event.planned)}`
        : "no budget yet";
    lines.push(
      `  • ${event.name} — ${event.health.replace("_", " ")} · ${event.phaseName} · ${burn}`,
    );
    lines.push(`    ${env.APP_URL}/events/${event.id}`);
  }
  lines.push("");

  if (sales.length > 0) {
    lines.push("TICKET SALES");
    for (const s of sales) {
      const pct = s.soldPct !== null ? ` (${s.soldPct}% of capacity)` : "";
      lines.push(
        `  • ${s.eventName} — ${s.totalSold.toLocaleString("en")} sold${pct} · ${idr(s.totalRevenue)}`,
      );
    }
    lines.push("");
  }

  if (hotspots.length > 0) {
    lines.push("OVERDUE HOTSPOTS");
    for (const h of hotspots.slice(0, 8)) {
      lines.push(`  • ${h.eventName} / ${h.divisionName} — ${h.count} overdue`);
    }
    lines.push("");
  }

  lines.push(
    queue.length > 0
      ? `${queue.length} approval${queue.length === 1 ? "" : "s"} waiting for a decision: ${env.APP_URL}/approvals`
      : "No approvals waiting. ",
  );
  lines.push("");
  lines.push("Manage digests: " + env.APP_URL + "/settings");
  lines.push(`— ${brand}`);

  return {
    subject: `[${brand}] Weekly executive digest — ${portfolio.length} active project${portfolio.length === 1 ? "" : "s"}`,
    text: lines.join("\n"),
  };
}

// ---- senders (cron entry points) ------------------------------------------

async function sendToOptedIn(
  flag: typeof profiles.dailyDigest | typeof profiles.weeklyDigest,
  build: (actor: Actor) => Promise<{ subject: string; text: string } | null>,
): Promise<number> {
  const recipients = await db
    .select({ id: profiles.id, email: profiles.email })
    .from(profiles)
    .where(
      and(
        eq(flag, true),
        eq(profiles.isActive, true),
        // externals never receive internal digests
        ne(profiles.role, "external"),
        isNotNull(profiles.passwordHash),
      ),
    );

  let sent = 0;
  for (const recipient of recipients) {
    try {
      const actor = await getActor(recipient.id);
      if (!actor) continue;
      const digest = await build(actor);
      if (!digest) continue; // nothing to report
      await sendEmail({ to: recipient.email, ...digest });
      sent += 1;
    } catch (error) {
      console.error(`[digest] failed for ${recipient.email}:`, error);
    }
  }
  return sent;
}

export async function sendDailyDigests(): Promise<number> {
  return sendToOptedIn(profiles.dailyDigest, (actor) => buildDailyDigest(actor));
}

export async function sendWeeklyDigests(): Promise<number> {
  return sendToOptedIn(profiles.weeklyDigest, async (actor) => {
    // the weekly digest is executive-only, even if a member flips the flag
    if (actor.role !== "owner" && actor.role !== "admin") return null;
    return buildWeeklyExecutiveDigest(actor);
  });
}
