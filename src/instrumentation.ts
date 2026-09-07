// Next.js instrumentation hook — runs once per server boot (nodejs runtime).
// Hosts the in-process background jobs (PLAN §7: node-cron inside the app).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const cron = (await import("node-cron")).default;
  const { recomputeAllEventHealth } = await import("@/lib/events/service");
  const { sweepDueNotifications } = await import("@/lib/tasks/service");

  // WhatsApp gateway (EPIC-015): re-link silently if a previous pairing left
  // credentials on the volume, so a redeploy doesn't require a new QR scan.
  try {
    const { resumeIfLinked } = await import("@/lib/whatsapp/session");
    if (await resumeIfLinked()) console.log("[whatsapp] resuming linked device");
  } catch (error) {
    console.error("[whatsapp] resume failed:", error);
  }

  // hourly: due/overdue notifications (deduped) then health sweep;
  // mutations also trigger targeted recomputes
  const { sweepBottlenecks } = await import("@/lib/tasks/dependency-engine");
  cron.schedule("0 * * * *", async () => {
    try {
      await sweepDueNotifications();
      const n = await recomputeAllEventHealth();
      // overdue drifts in with time, so bottleneck levels change without
      // any mutation — re-evaluate hourly (EPIC-012)
      const b = await sweepBottlenecks();
      console.log(
        `[cron] due sweep + health recompute for ${n} events + ${b} bottleneck checks`,
      );
      // Ticketing channels — each fails soft and INDEPENDENTLY: one dead
      // provider must not stop the other's sales from landing.
      try {
        const { syncTesseraSales } = await import("@/lib/tessera/client");
        const t = await syncTesseraSales();
        if (t.synced || t.failed) {
          console.log(`[cron] tessera: ${t.synced} synced, ${t.failed} failed${t.tokenExpired ? " (token expired)" : ""}`);
        }
      } catch (error) {
        console.error("[cron] tessera sync failed:", error);
      }
      try {
        const { syncMegatixSales } = await import("@/lib/megatix/client");
        const m = await syncMegatixSales();
        if (m.synced || m.failed) {
          console.log(`[cron] megatix: ${m.synced} synced, ${m.failed} failed${m.authFailed ? " (auth rejected)" : ""}`);
        }
      } catch (error) {
        console.error("[cron] megatix sync failed:", error);
      }
    } catch (error) {
      console.error("[cron] sweep failed:", error);
    }
  });

  // digests (T-100) — opt-in, WIB mornings; timezone pinned so the container
  // TZ (UTC) never shifts the send hour
  const { sendDailyDigests, sendWeeklyDigests } = await import(
    "@/lib/digests/service"
  );
  cron.schedule(
    "0 7 * * *",
    async () => {
      try {
        const n = await sendDailyDigests();
        console.log(`[cron] daily digest sent to ${n} users`);
      } catch (error) {
        console.error("[cron] daily digest failed:", error);
      }
    },
    { timezone: "Asia/Jakarta" },
  );
  // Backstage Play (EPIC-026): quests at 06:00 WIB, recap Monday 08:00 WIB,
  // and the nightly XP recompute that proves the ledger still equals the log.
  cron.schedule(
    "0 6 * * *",
    async () => {
      try {
        const { isPlayEnabled } = await import("@/lib/play/settings");
        if (!(await isPlayEnabled())) return;
        const { generateAllQuests } = await import("@/lib/play/xp/quests");
        console.log(`[cron] play quests generated: ${await generateAllQuests()}`);
      } catch (error) {
        console.error("[cron] play quests failed:", error);
      }
    },
    { timezone: "Asia/Jakarta" },
  );
  cron.schedule(
    "0 8 * * 1",
    async () => {
      try {
        const { isPlayEnabled } = await import("@/lib/play/settings");
        if (!(await isPlayEnabled())) return;
        const { sendWeeklyRecaps } = await import("@/lib/play/xp/recap");
        console.log(`[cron] play recap sent to ${await sendWeeklyRecaps()} users`);
      } catch (error) {
        console.error("[cron] play recap failed:", error);
      }
    },
    { timezone: "Asia/Jakarta" },
  );
  cron.schedule(
    "0 2 * * *",
    async () => {
      try {
        const { isPlayEnabled } = await import("@/lib/play/settings");
        if (!(await isPlayEnabled())) return;
        const { nightlyDriftCheck } = await import("@/lib/play/xp/service");
        const r = await nightlyDriftCheck();
        console.log(`[cron] play XP recompute: ${r.users} users, ${r.drifted} drifted`);
      } catch (error) {
        console.error("[cron] play recompute failed:", error);
      }
    },
    { timezone: "Asia/Jakarta" },
  );
  cron.schedule(
    "0 7 * * 1",
    async () => {
      try {
        const n = await sendWeeklyDigests();
        console.log(`[cron] weekly executive digest sent to ${n} users`);
      } catch (error) {
        console.error("[cron] weekly digest failed:", error);
      }
    },
    { timezone: "Asia/Jakarta" },
  );
}
