"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

const PDFJS_VERSION = "3.11.174";
const PDFJS_SCRIPT = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.worker.min.js";

function normalise(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

function getEvidence(extraction) {
  const result = [...(Array.isArray(extraction?.fieldEvidence) ? extraction.fieldEvidence : [])];
  (Array.isArray(extraction?.lines) ? extraction.lines : []).forEach((line, index) => {
    (Array.isArray(line?.evidence) ? line.evidence : []).forEach((item) => {
      result.push({ ...item, field: item.field || ("Line " + (index + 1) + " · field") , lineIndex: index });
    });
  });
  const seen = new Set();
  return result.filter((item) => {
    if (!item || !item.field || !item.sourceText) return false;
    const key = [item.field, item.page || 1, item.sourceText].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function SourceBoundingBoxPreview({ url, extraction, page = 1, onPageChange }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const [pdfjs, setPdfjs] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [pageCount, setPageCount] = useState(0);
  const [items, setItems] = useState([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [selectedKey, setSelectedKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const evidence = useMemo(() => getEvidence(extraction), [extraction]);
  const pageEvidence = useMemo(() => evidence.filter((item) => !item.page || Number(item.page) === Number(page)), [evidence, page]);
  const selectedEvidence = pageEvidence.find((item) => [item.field, item.lineIndex ?? "", item.sourceText].join("|") === selectedKey) || null;

  useEffect(() => {
    let cancelled = false;
    if (window.pdfjsLib) { setPdfjs(window.pdfjsLib); return; }
    const existing = document.querySelector('script[data-customs-idp-pdfjs="true"]');
    const script = existing || document.createElement("script");
    const ready = () => { if (!cancelled && window.pdfjsLib) setPdfjs(window.pdfjsLib); };
    const failed = () => { if (!cancelled) { setError("The PDF viewer library could not be loaded. Check network access and try again."); setLoading(false); } };
    if (!existing) {
      script.src = PDFJS_SCRIPT;
      script.async = true;
      script.dataset.customsIdpPdfjs = "true";
      script.onload = ready;
      script.onerror = failed;
      document.head.appendChild(script);
    } else if (window.pdfjsLib) ready();
    else { script.addEventListener("load", ready); script.addEventListener("error", failed); }
    return () => { cancelled = true; script.removeEventListener?.("load", ready); script.removeEventListener?.("error", failed); };
  }, []);

  useEffect(() => {
    if (!pdfjs || !url) return;
    let cancelled = false;
    setLoading(true); setError(""); setPdf(null); setItems([]);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const task = pdfjs.getDocument({ url, withCredentials: false });
    task.promise.then((document) => {
      if (cancelled) { document.destroy(); return; }
      setPdf(document); setPageCount(document.numPages); onPageChange?.(Math.min(Math.max(1, page), document.numPages));
    }).catch((err) => {
      if (!cancelled) { setError(err?.message || "Unable to read this PDF. The file may block browser-side access."); setLoading(false); }
    });
    return () => { cancelled = true; task.destroy(); };
  }, [pdfjs, url]);

  useEffect(() => {
    if (!pdf || !canvasRef.current || !wrapperRef.current) return;
    let cancelled = false;
    setLoading(true); setError("");
    pdf.getPage(Math.min(Math.max(1, Number(page) || 1), pdf.numPages)).then(async (pdfPage) => {
      if (cancelled) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const available = Math.max(280, (wrapperRef.current?.clientWidth || base.width) - 24);
      const nextScale = Math.min(2, available / base.width);
      const viewport = pdfPage.getViewport({ scale: nextScale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.width = viewport.width + "px";
      canvas.style.height = viewport.height + "px";
      setPageSize({ width: viewport.width, height: viewport.height });
      setScale(nextScale);
      await pdfPage.render({ canvasContext: context, viewport }).promise;
      const text = await pdfPage.getTextContent();
      const mapped = text.items.filter((item) => item.str && item.transform).map((item, index) => {
        const tx = pdfjs.Util.transform(viewport.transform, item.transform);
        const height = Math.max(4, Math.hypot(tx[2], tx[3]));
        const width = Math.max(3, item.width * nextScale);
        return { id: index, text: item.str, x: tx[4], y: tx[5] - height, width, height, normal: normalise(item.str) };
      });
      if (!cancelled) { setItems(mapped); setLoading(false); }
    }).catch((err) => { if (!cancelled) { setError(err?.message || "Unable to render this PDF page."); setLoading(false); } });
    return () => { cancelled = true; };
  }, [pdf, page, pdfjs]);

  const matchedBoxes = useMemo(() => {
    if (!selectedEvidence?.sourceText) return [];
    const source = normalise(selectedEvidence.sourceText);
    if (!source) return [];
    const tokens = source.split(" ").filter((token) => token.length > 1);
    return items.filter((item) => {
      if (!item.normal) return false;
      return source.includes(item.normal) || (item.normal.length > 2 && item.normal.split(" ").every((token) => tokens.includes(token)));
    });
  }, [items, selectedEvidence]);

  const evidenceKey = (item) => [item.field, item.lineIndex ?? "", item.sourceText].join("|");

  return <div ref={wrapperRef} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "#f3f4f6", color: "#111827" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#fff", borderBottom: "1px solid #e5e7eb", flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: "#4b5563" }}>Source highlights</span>
      <span style={{ fontSize: 11, color: "#6b7280" }}>Select an evidence field to locate its source text</span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b7280" }}>{pageCount ? "Page " + page + " of " + pageCount : ""}</span>
    </div>
    {pageEvidence.length > 0 && <div style={{ display: "flex", gap: 6, padding: 8, overflowX: "auto", background: "#fff", borderBottom: "1px solid #e5e7eb" }}>
      {pageEvidence.map((item, index) => <button key={evidenceKey(item) + index} type="button" onClick={() => setSelectedKey(evidenceKey(item))} style={{ whiteSpace: "nowrap", border: "1px solid " + (selectedKey === evidenceKey(item) ? "#2563eb" : "#d1d5db"), borderRadius: 6, padding: "5px 8px", background: selectedKey === evidenceKey(item) ? "#dbeafe" : "#fff", color: "#111827", fontSize: 11, cursor: "pointer" }}>{item.field}</button>)}
    </div>}
    <div style={{ overflow: "auto", flex: 1, minHeight: 0, padding: 12, display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
      {error ? <div style={{ maxWidth: 560, padding: 16, background: "#fff", borderRadius: 8, fontSize: 13 }}> <b>Source highlighting unavailable</b><p style={{ marginBottom: 0 }}>{error}</p><p style={{ color: "#6b7280" }}>This viewer works with text-based PDFs. Scanned PDFs need OCR coordinates; this fallback does not invent them.</p></div> : <div style={{ position: "relative", width: pageSize.width || "100%", minHeight: 160, boxShadow: "0 2px 10px #0002", background: "#fff" }}>
        <canvas ref={canvasRef} style={{ display: "block", maxWidth: "100%" }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {matchedBoxes.map((box) => <div key={box.id} title={box.text} style={{ position: "absolute", left: box.x, top: box.y, width: box.width, height: box.height, background: "rgba(250, 204, 21, 0.35)", outline: "2px solid #eab308", boxSizing: "border-box" }} />)}
        </div>
        {loading && <div style={{ padding: 16, fontSize: 13 }}>Loading PDF page…</div>}
      </div>}
    </div>
    {selectedEvidence && <div style={{ padding: "8px 12px", background: "#fff", borderTop: "1px solid #e5e7eb", fontSize: 12 }}><b>{selectedEvidence.field}</b>: {selectedEvidence.sourceText} <span style={{ color: "#6b7280" }}>({matchedBoxes.length ? matchedBoxes.length + " source text region(s) highlighted" : "No exact text match found on this page"})</span></div>}
  </div>;
}
