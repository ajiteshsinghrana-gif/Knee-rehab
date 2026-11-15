/** Reads the text layer of a PDF in the browser (pdf.js, loaded only when a PDF is chosen). Scanned PDFs have no text and are reported as such. */
export async function pdfToText(buf: ArrayBuffer): Promise<string> {
  const base = new URL('./vendor/', document.baseURI).href;
  const lib: any = await import(/* @vite-ignore */ base + 'pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const lines: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 3); // items within ~3pt share a line
      const row = rows.get(y) ?? [];
      row.push({ x: it.transform[4], s: it.str });
      rows.set(y, row);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, r]) => lines.push(r.sort((a, b) => a.x - b.x).map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim()));
  }
  return lines.join('\n');
}

/** Text of an uploaded file: .pdf through pdf.js, everything else read as text. */
export async function readFileText(file: File): Promise<string> {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return pdfToText(await file.arrayBuffer());
  return file.text();
}
