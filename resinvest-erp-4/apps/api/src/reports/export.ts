import { existsSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

/**
 * Eksport raportów: jeden model tabeli → CSV (Excel PL: średnik, przecinek dziesiętny, BOM), XLSX (liczby jako liczby,
 * formaty, filtr, zamrożony nagłówek), PDF (A4 poziomo, polskie znaki — font DejaVu Sans, nagłówek na każdej stronie)
 * i DOCX (tabela w Word). Pliki powstają w pamięci serwera — bez plików tymczasowych na dysku.
 */
export type CellValue = string | number | null;
export interface ReportColumn { key: string; label: string; kind: "text" | "qty" | "money" | "int"; width?: number }
export interface ReportTable { title: string; subtitle: string; columns: ReportColumn[]; rows: Array<Record<string, CellValue>>; total?: Record<string, CellValue> | null; generatedBy: string }
export type ExportFormat = "csv" | "xlsx" | "pdf" | "docx";
export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const FONT_DIR = join(__dirname, "../../assets/fonts");
const num = (v: CellValue) => (v === null || v === "" ? null : Number(v));
/** Liczba po polsku: separator tysięcy spacja nierozdzielająca, przecinek dziesiętny. */
export function plNumber(v: CellValue, kind: ReportColumn["kind"]): string {
  if (v === null || v === "") return "";
  if (kind === "text") return String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return new Intl.NumberFormat("pl-PL", kind === "money" ? { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" } : { maximumFractionDigits: kind === "int" ? 0 : 3, useGrouping: "always" }).format(n);
}
const cellText = (c: ReportColumn, v: CellValue) => plNumber(v, c.kind);
const allRows = (t: ReportTable) => (t.total ? [...t.rows, t.total] : t.rows);

export async function renderReport(t: ReportTable, format: ExportFormat): Promise<Buffer> {
  if (format === "csv") return csv(t);
  if (format === "xlsx") return xlsx(t);
  if (format === "pdf") return pdf(t);
  return docx(t);
}

function csv(t: ReportTable): Buffer {
  const q = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  // CSV dla Excela w polskich ustawieniach: liczby bez separatora tysięcy, przecinek dziesiętny
  const val = (c: ReportColumn, v: CellValue) => (v === null || v === "" ? "" : c.kind === "text" ? String(v) : String(v).replace(".", ","));
  const lines = [[t.title], [t.subtitle], [], t.columns.map(c => c.label), ...allRows(t).map(r => t.columns.map(c => val(c, r[c.key] ?? null)))];
  return Buffer.from("﻿" + lines.map(l => l.map(x => q(String(x))).join(";")).join("\r\n") + "\r\n", "utf8");
}

async function xlsx(t: ReportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ResInvest ERP"; wb.created = new Date();
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), { views: [{ state: "frozen", ySplit: 4 }] });
  ws.addRow([t.title]).font = { bold: true, size: 14 };
  ws.addRow([t.subtitle]).font = { italic: true, color: { argb: "FF5B6B63" } };
  ws.addRow([]);
  const head = ws.addRow(t.columns.map(c => c.label));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F6B47" } }; c.alignment = { vertical: "middle", wrapText: true }; });
  for (const [i, r] of allRows(t).entries()) {
    const row = ws.addRow(t.columns.map(c => (c.kind === "text" ? (r[c.key] ?? "") : num(r[c.key] ?? null))));
    if (t.total && i === t.rows.length) row.font = { bold: true };
  }
  t.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? (c.kind === "text" ? 28 : 14);
    if (c.kind === "money") col.numFmt = "#,##0.00";
    else if (c.kind === "qty") col.numFmt = "#,##0.###";
    else if (c.kind === "int") col.numFmt = "0";
    if (c.kind !== "text") col.alignment = { horizontal: "right" };
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: t.columns.length } };
  ws.addRow([]);
  ws.addRow([t.generatedBy]).font = { italic: true, size: 9, color: { argb: "FF5B6B63" } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function pdf(t: ReportTable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, info: { Title: t.title, Creator: "ResInvest ERP" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject);
    const regular = join(FONT_DIR, "DejaVuSans.ttf"), bold = join(FONT_DIR, "DejaVuSans-Bold.ttf");
    const hasFont = existsSync(regular) && existsSync(bold);
    if (hasFont) { doc.registerFont("R", regular); doc.registerFont("B", bold); }
    const R = hasFont ? "R" : "Helvetica", B = hasFont ? "B" : "Helvetica-Bold";
    const left = doc.page.margins.left, usable = doc.page.width - left - doc.page.margins.right;
    const weights = t.columns.map(c => c.width ?? (c.kind === "text" ? 28 : 14));
    const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map(w => (w / sum) * usable);
    const size = t.columns.length > 10 ? 7 : 8, pad = 3;
    doc.font(B).fontSize(14).text(t.title, { width: usable });
    doc.font(R).fontSize(9).fillColor("#5b6b63").text(t.subtitle, { width: usable }).fillColor("#000").moveDown(0.6);
    const rowHeight = (cells: string[], font: string) => {
      doc.font(font).fontSize(size);
      return Math.max(...cells.map((s, i) => doc.heightOfString(s || " ", { width: widths[i]! - 2 * pad }))) + 2 * pad;
    };
    const drawRow = (cells: string[], font: string, fill: string | null, color = "#000") => {
      const h = rowHeight(cells, font);
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); header(); }
      const y = doc.y;
      if (fill) doc.rect(left, y, usable, h).fill(fill);
      let x = left;
      cells.forEach((s, i) => {
        const c = t.columns[i]!;
        doc.font(font).fontSize(size).fillColor(color).text(s, x + pad, y + pad, { width: widths[i]! - 2 * pad, align: c.kind === "text" ? "left" : "right" });
        x += widths[i]!;
      });
      doc.moveTo(left, y + h).lineTo(left + usable, y + h).lineWidth(0.4).strokeColor("#d9e1dc").stroke();
      doc.x = left; doc.y = y + h;
    };
    const header = () => drawRow(t.columns.map(c => c.label), B, "#1f6b47", "#ffffff");
    header();
    t.rows.forEach((r, i) => drawRow(t.columns.map(c => cellText(c, r[c.key] ?? null)), R, i % 2 ? "#f4f6f5" : null));
    if (t.total) drawRow(t.columns.map(c => cellText(c, t.total![c.key] ?? null)), B, "#e3f3ea");
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // stopka pod dolnym marginesem — bez zerowania marginesu pdfkit dodałby pustą stronę
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - bottom + 8;
      doc.font(R).fontSize(7).fillColor("#5b6b63").text(`${t.generatedBy} · strona ${i + 1} z ${range.count}`, left, y, { width: usable, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

async function docx(t: ReportTable): Promise<Buffer> {
  const border = { style: BorderStyle.SINGLE, size: 2, color: "D9E1DC" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (s: string, c: ReportColumn, opts: { bold?: boolean; head?: boolean; fill?: string } = {}) => new TableCell({
    borders, shading: opts.fill ? { type: ShadingType.CLEAR, color: "auto", fill: opts.fill } : undefined,
    children: [new Paragraph({ alignment: c.kind === "text" || opts.head ? AlignmentType.LEFT : AlignmentType.RIGHT,
      children: [new TextRun({ text: s, bold: opts.bold, size: 16, color: opts.head ? "FFFFFF" : undefined, font: "Calibri" })] })],
  });
  const rows = [
    new TableRow({ tableHeader: true, children: t.columns.map(c => cell(c.label, c, { bold: true, head: true, fill: "1F6B47" })) }),
    ...t.rows.map(r => new TableRow({ children: t.columns.map(c => cell(cellText(c, r[c.key] ?? null), c)) })),
    ...(t.total ? [new TableRow({ children: t.columns.map(c => cell(cellText(c, t.total![c.key] ?? null), c, { bold: true, fill: "E3F3EA" })) })] : []),
  ];
  const doc = new Document({
    creator: "ResInvest ERP", title: t.title,
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 600, right: 600 } } },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t.title, font: "Calibri" })] }),
        new Paragraph({ children: [new TextRun({ text: t.subtitle, italics: true, color: "5B6B63", font: "Calibri" })] }),
        new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }),
        new Paragraph({ children: [new TextRun({ text: t.generatedBy, size: 14, color: "5B6B63", font: "Calibri" })] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}
