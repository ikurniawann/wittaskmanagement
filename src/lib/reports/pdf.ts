import PDFDocument from "pdfkit";
import type { EventReport } from "./service";

// PDF renderer for the event progress report — monochrome, brand-flavored
// (Helvetica, hairline rules, uppercase section heads). Pure pdfkit, no
// external assets.

const MARGIN = 48;
const PAGE_WIDTH = 595.28; // A4 portrait
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const dtLong = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "full",
  timeZone: "Asia/Jakarta",
});
const dtStamp = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});
const dtShort = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Jakarta",
});

/** Money left this report with the budget section (Owner 2026-08-27); the
 *  only figures here now are file sizes. */
function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const HEALTH_LABEL: Record<string, string> = {
  on_track: "ON TRACK",
  at_risk: "AT RISK",
  critical: "CRITICAL",
};

export function buildEventReportPdf(report: EventReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: `${report.event.name} — Progress report`,
        Author: report.brandName,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const rule = () => {
      doc.moveDown(0.4);
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(PAGE_WIDTH - MARGIN, doc.y)
        .lineWidth(0.5)
        .strokeColor("#999999")
        .stroke();
      doc.moveDown(0.6);
    };

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > doc.page.height - MARGIN) doc.addPage();
    };

    const section = (title: string) => {
      ensureSpace(80);
      doc.moveDown(0.8);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#000000")
        .text(title.toUpperCase(), { characterSpacing: 1.5 });
      rule();
    };

    const keyValue = (pairs: Array<[string, string]>) => {
      for (const [key, value] of pairs) {
        ensureSpace(16);
        const y = doc.y;
        doc
          .font("Helvetica")
          .fontSize(8.5)
          .fillColor("#666666")
          .text(key.toUpperCase(), MARGIN, y, { width: 150, characterSpacing: 0.5 });
        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor("#000000")
          .text(value, MARGIN + 160, y, { width: CONTENT_WIDTH - 160 });
        doc.moveDown(0.35);
      }
    };

    interface Column {
      header: string;
      width: number;
      align?: "left" | "right";
    }
    const table = (columns: Column[], rows: string[][]) => {
      ensureSpace(40);
      let x = MARGIN;
      const headerY = doc.y;
      for (const col of columns) {
        doc
          .font("Helvetica-Bold")
          .fontSize(7.5)
          .fillColor("#666666")
          .text(col.header.toUpperCase(), x, headerY, {
            width: col.width,
            align: col.align ?? "left",
            characterSpacing: 0.5,
          });
        x += col.width + 8;
      }
      doc.y = headerY + 14;
      for (const row of rows) {
        ensureSpace(16);
        const y = doc.y;
        let cx = MARGIN;
        let maxH = 0;
        row.forEach((cell, index) => {
          const col = columns[index];
          doc
            .font("Helvetica")
            .fontSize(8.5)
            .fillColor("#000000")
            .text(cell, cx, y, { width: col.width, align: col.align ?? "left" });
          maxH = Math.max(maxH, doc.heightOfString(cell, { width: col.width }));
          cx += col.width + 8;
        });
        doc.y = y + Math.max(maxH, 11) + 3;
      }
      doc.x = MARGIN;
    };

    // ---- header ------------------------------------------------------------
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#000000")
      .text(report.brandName.toUpperCase(), { characterSpacing: 3 });
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#666666")
      .text("EVENT PROGRESS REPORT", { characterSpacing: 2 });
    doc.moveDown(0.8);
    doc
      .font("Helvetica-Bold")
      .fontSize(22)
      .fillColor("#000000")
      .text(report.event.name.toUpperCase());
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor("#333333")
      .text(
        [report.event.artists, report.event.venue].filter(Boolean).join("  ·  "),
      );
    rule();

    keyValue([
      ["Show date", `${dtLong.format(report.event.showDate)} WIB`],
      [
        "Countdown",
        report.event.daysToShow >= 0
          ? `${report.event.daysToShow} days to show`
          : `show was ${Math.abs(report.event.daysToShow)} days ago`,
      ],
      [
        "Phase",
        `${report.event.phaseName} (${report.event.phaseIndex}/${report.event.phaseTotal})`,
      ],
      ["Health", HEALTH_LABEL[report.event.health] ?? report.event.health],
      [
        "Task completion",
        report.tasks.completionPct === null
          ? `no tasks committed yet${report.tasks.backlog > 0 ? ` (${report.tasks.backlog} in backlog)` : ""}`
          : `${report.tasks.completionPct}%  (${report.tasks.done}/${report.tasks.committed} committed tasks done${
              report.tasks.backlog > 0
                ? `, ${report.tasks.backlog} still in backlog`
                : ""
            })`,
      ],
      [
        "Sub-task progress",
        report.subtasks.pct === null
          ? "no sub-tasks yet"
          : `${report.subtasks.pct}%  (${report.subtasks.done}/${report.subtasks.total} done)`,
      ],
      [
        "Documents filed",
        report.dataroom.files === 0
          ? "nothing in the document room yet"
          : `${report.dataroom.files} file${report.dataroom.files === 1 ? "" : "s"} across ${report.dataroom.byFolder.length} folder${report.dataroom.byFolder.length === 1 ? "" : "s"} (${bytes(report.dataroom.totalBytes)})`,
      ],
    ]);

    // ---- tasks -------------------------------------------------------------
    section("Task progress by division");
    table(
      [
        { header: "Division", width: 190 },
        { header: "Tasks", width: 70, align: "right" },
        { header: "Done", width: 70, align: "right" },
        { header: "Overdue", width: 70, align: "right" },
      ],
      report.tasks.byDivision.map((d) => [
        d.division,
        String(d.total),
        String(d.done),
        d.overdue > 0 ? `${d.overdue} !` : "0",
      ]),
    );
    doc.moveDown(0.4);
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor("#333333")
      .text(
        `Status mix: ${report.tasks.byStatus
          .map((s) => `${s.label} ${s.count}`)
          .join("  ·  ")}`,
        MARGIN,
        doc.y,
        { width: CONTENT_WIDTH },
      );
    if (report.tasks.checklist.total > 0) {
      doc.text(
        `Checklist items: ${report.tasks.checklist.done}/${report.tasks.checklist.total} done`,
      );
    }

    if (report.tasks.overdue.length > 0) {
      section(`Overdue tasks (${report.tasks.overdue.length})`);
      table(
        [
          { header: "Task", width: 200 },
          { header: "Division", width: 110 },
          { header: "Due", width: 70 },
          { header: "Assignees", width: 110 },
        ],
        report.tasks.overdue.map((t) => [
          t.title,
          t.division,
          dtShort.format(t.dueDate),
          t.assignees,
        ]),
      );
    }

    // ---- sub-tasks ---------------------------------------------------------
    section(`Sub-tasks (${report.subtasks.done}/${report.subtasks.total} done)`);
    if (report.subtasks.byTask.length === 0) {
      doc.fontSize(9).fillColor("#666").text("No sub-tasks on this project yet.");
      doc.fillColor("#000");
    } else {
      table(
        [
          { header: "Task", width: 200 },
          { header: "Division", width: 110 },
          { header: "Done", width: 55, align: "right" },
          { header: "Still open", width: 205 },
        ],
        report.subtasks.byTask.map((t) => [
          t.task,
          t.division,
          `${t.done}/${t.total}`,
          // the open items ARE the report; a finished list says only "done"
          t.open.length === 0 ? "—" : t.open.join(", "),
        ]),
      );
    }

    // ---- dataroom ----------------------------------------------------------
    section(`Document room (${report.dataroom.files} file${report.dataroom.files === 1 ? "" : "s"})`);
    if (report.dataroom.byFolder.length === 0) {
      doc
        .fontSize(9)
        .fillColor("#666")
        .text("Nothing has been filed in the document room yet.");
      doc.fillColor("#000");
    } else {
      table(
        [
          { header: "Folder", width: 190 },
          { header: "Files", width: 50, align: "right" },
          { header: "Size", width: 70, align: "right" },
          { header: "Contents", width: 260 },
        ],
        report.dataroom.byFolder.map((f) => [
          f.path,
          String(f.files),
          bytes(f.bytes),
          f.names.join(", "),
        ]),
      );
    }

    // ---- approvals ---------------------------------------------------------
    section("Approvals");
    keyValue([
      ["Pending", String(report.approvals.pending)],
      ["Approved", String(report.approvals.approved)],
      ["Rejected", String(report.approvals.rejected)],
      ["Changes requested", String(report.approvals.changesRequested)],
    ]);
    if (report.approvals.pendingItems.length > 0) {
      doc.moveDown(0.3);
      table(
        [
          { header: "Awaiting decision", width: 380 },
          { header: "Type", width: 110 },
        ],
        report.approvals.pendingItems.map((a) => [
          a.title,
          a.type.replaceAll("_", " "),
        ]),
      );
    }

    // ---- collaboration -----------------------------------------------------
    section("Cross-division & external");
    keyValue([
      [
        "Handoffs",
        `${report.handoffs.pending} pending · ${report.handoffs.accepted} accepted · ${report.handoffs.declined} declined`,
      ],
      ["Active guest invites", String(report.guests.activeInvites)],
      [
        "External submissions",
        report.guests.submissionsByStatus.length > 0
          ? report.guests.submissionsByStatus
              .map((s) => `${s.label} ${s.count}`)
              .join("  ·  ")
          : "none",
      ],
      [
        "Run sheet",
        report.runOfShow.items > 0
          ? `${report.runOfShow.items} items (${report.runOfShow.first} – ${report.runOfShow.last})`
          : "not drafted yet",
      ],
    ]);

    // ---- footer ------------------------------------------------------------
    doc.moveDown(1.2);
    rule();
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#666666")
      .text(
        `Generated ${dtStamp.format(report.generatedAt)} WIB by ${report.generatedBy} · ${report.brandName}`,
        { characterSpacing: 0.5 },
      );

    doc.end();
  });
}
