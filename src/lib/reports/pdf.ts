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

function idr(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
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
        "Budget burn",
        report.budget.burnPct !== null
          ? `${report.budget.burnPct}% of ${idr(report.budget.planned)}`
          : "no budget lines yet",
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

    // ---- budget ------------------------------------------------------------
    section("Budget");
    keyValue([
      ["Planned", idr(report.budget.planned)],
      ["Committed", idr(report.budget.committed)],
      ["Actual (paid)", idr(report.budget.actual)],
      ["Remaining", idr(report.budget.remaining)],
    ]);
    if (report.budget.lines.length > 0) {
      doc.moveDown(0.3);
      table(
        [
          { header: "Division · line", width: 220 },
          { header: "Planned", width: 90, align: "right" },
          { header: "Committed", width: 90, align: "right" },
          { header: "Paid", width: 90, align: "right" },
        ],
        report.budget.lines.map((line) => [
          `${line.division} · ${line.name}`,
          idr(line.planned),
          idr(line.committed),
          idr(line.actual),
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
          { header: "Awaiting decision", width: 280 },
          { header: "Type", width: 100 },
          { header: "Amount", width: 110, align: "right" },
        ],
        report.approvals.pendingItems.map((a) => [
          a.title,
          a.type.replaceAll("_", " "),
          a.amount !== null ? idr(a.amount) : "—",
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
