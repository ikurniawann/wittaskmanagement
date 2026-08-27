import PDFDocument from "pdfkit";
import type { SettlementReport } from "./settlement";

// PDF renderer for the settlement report — same monochrome language as
// the progress report (Helvetica, hairline rules, uppercase section heads).

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

function idr(amount: number): string {
  const abs = `Rp ${Math.abs(amount).toLocaleString("id-ID")}`;
  return amount < 0 ? `−${abs}` : abs;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "PENDING",
  approved: "APPROVED",
  rejected: "REJECTED",
  changes_requested: "CHANGES REQ.",
};

export function buildSettlementPdf(report: SettlementReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: `${report.event.name} — Settlement report`,
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
    const table = (columns: Column[], rows: string[][], boldLast = false) => {
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
      rows.forEach((row, rowIndex) => {
        ensureSpace(16);
        const isTotals = boldLast && rowIndex === rows.length - 1;
        const y = doc.y;
        let cx = MARGIN;
        let maxH = 0;
        row.forEach((cell, index) => {
          const col = columns[index];
          doc
            .font(isTotals ? "Helvetica-Bold" : "Helvetica")
            .fontSize(8.5)
            .fillColor("#000000")
            .text(cell, cx, y, { width: col.width, align: col.align ?? "left" });
          maxH = Math.max(maxH, doc.heightOfString(cell, { width: col.width }));
          cx += col.width + 8;
        });
        doc.y = y + Math.max(maxH, 11) + 3;
      });
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
      .text("EVENT SETTLEMENT REPORT", { characterSpacing: 2 });
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
        "Ticket income",
        `${idr(report.income.ticketRevenue)}  (${report.income.ticketsSold.toLocaleString("en")} sold${report.income.soldPct !== null ? `, ${report.income.soldPct}% of capacity` : ""})`,
      ],
      ["Total spend", `${idr(report.net.spendTotal)}  (paid + committed)`],
      ["Net result", idr(report.net.net)],
    ]);

    // ---- budget vs actual --------------------------------------------------
    section("Budget vs actual by division");
    const budgetRows = report.budget.byDivision.map((d) => [
      d.divisionName,
      idr(d.planned),
      idr(d.committed),
      idr(d.actual),
      idr(d.variance),
    ]);
    budgetRows.push([
      "Total (incl. unlinked expenses)",
      idr(report.budget.totals.planned),
      idr(report.budget.totals.committed),
      idr(report.budget.totals.actual),
      idr(report.budget.totals.variance),
    ]);
    table(
      [
        { header: "Division", width: 135 },
        { header: "Planned", width: 85, align: "right" },
        { header: "Committed", width: 85, align: "right" },
        { header: "Paid", width: 85, align: "right" },
        { header: "Variance", width: 85, align: "right" },
      ],
      budgetRows,
      true,
    );

    // ---- approvals ---------------------------------------------------------
    section(`Approval history (${report.approvalHistory.length})`);
    if (report.approvalHistory.length === 0) {
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#333333")
        .text("No approvals were raised for this project.", MARGIN, doc.y);
    } else {
      table(
        [
          { header: "Request", width: 185 },
          { header: "Division", width: 95 },
          { header: "Amount", width: 95, align: "right" },
          { header: "Status", width: 95 },
        ],
        report.approvalHistory.map((a) => [
          a.title,
          a.division,
          a.amount !== null ? idr(a.amount) : "—",
          STATUS_LABEL[a.status] ?? a.status.toUpperCase(),
        ]),
      );
    }

    // ---- outstanding -------------------------------------------------------
    section("Outstanding at settlement");
    keyValue([
      ["Pending approvals", String(report.outstanding.pendingApprovals.length)],
      ["Committed, unpaid", String(report.outstanding.unpaidExpenses.length)],
      ["Open tasks", String(report.outstanding.openTasks)],
    ]);
    if (report.outstanding.unpaidExpenses.length > 0) {
      doc.moveDown(0.3);
      table(
        [
          { header: "Unpaid expense", width: 210 },
          { header: "Vendor", width: 130 },
          { header: "Amount", width: 110, align: "right" },
        ],
        report.outstanding.unpaidExpenses.map((e) => [
          e.title,
          e.vendor || "—",
          idr(e.amount),
        ]),
      );
    }
    if (report.outstanding.pendingApprovals.length > 0) {
      doc.moveDown(0.3);
      table(
        [
          { header: "Awaiting decision", width: 240 },
          { header: "Division", width: 110 },
          { header: "Amount", width: 100, align: "right" },
        ],
        report.outstanding.pendingApprovals.map((a) => [
          a.title,
          a.division,
          a.amount !== null ? idr(a.amount) : "—",
        ]),
      );
    }

    // ---- footer ------------------------------------------------------------
    doc.moveDown(1.2);
    rule();
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#666666")
      .text(
        `Generated ${dtStamp.format(report.generatedAt)} WIB by ${report.generatedBy} · ${report.brandName} · Settlement`,
        { characterSpacing: 0.5 },
      );

    doc.end();
  });
}
