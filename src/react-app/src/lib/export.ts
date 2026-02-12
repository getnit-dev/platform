import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";

export function exportToCSV<T extends Record<string, unknown>>(
  data: T[],
  filename: string
) {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(","),
    ...data.map((row) =>
      headers.map((header) => JSON.stringify(row[header] ?? "")).join(",")
    ),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportChartToPNG(
  elementId: string,
  filename: string
) {
  const element = document.getElementById(elementId);
  if (!element) return;

  const canvas = await html2canvas(element);
  const url = canvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.png`;
  link.click();
}

export function exportToPDF<T extends Record<string, unknown>>(
  data: T[],
  columns: string[],
  filename: string,
  title?: string
) {
  const doc = new jsPDF();

  if (title) {
    doc.setFontSize(16);
    doc.text(title, 14, 20);
  }

  autoTable(doc, {
    head: [columns],
    body: data.map((row) => columns.map((col) => String(row[col] ?? ""))),
    startY: title ? 30 : 20,
  });

  doc.save(`${filename}.pdf`);
}
