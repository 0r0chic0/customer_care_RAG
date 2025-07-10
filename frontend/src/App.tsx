import React, { useState, useRef, useEffect } from "react";

const WS_URL           = "/ws/audio";
const ADVICE_URL       = "/api/advice";
const SATISFACTION_URL = "/api/satisfaction-score";
const SUMMARY_URL      = "/api/summary";
const PDF_UPLOAD_URL   = "/api/upload-pdf";

const buttonStyle: React.CSSProperties = {
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  padding: "0.5rem 1rem",
  cursor: "pointer",
  fontWeight: "bold",
};

export default function App() {
  // ─── State ──────────────────────────────────────────────────────────────
  const [recording, setRecording]   = useState(false);
  const [transcript, setTranscript] = useState("");
  const [advice, setAdvice]         = useState("");
  const [score, setScore]           = useState<number | null>(null);
  const [summary, setSummary]       = useState("");
  const [csvName, setCsvName]       = useState("");
  const [pdfStatus, setPdfStatus]   = useState("");

  // ─── Refs ────────────────────────────────────────────────────────────────
  const wsRef        = useRef<WebSocket | null>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef    = useRef<MediaStreamAudioSourceNode | null>(null);

  // Keep latest transcript for interval callback
  const transcriptRef  = useRef(transcript);
  const adviceTimerRef = useRef<number | null>(null);

  // Update transcriptRef on transcript change
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  // ─── Advice polling every 10 seconds ─────────────────────────────────────
  useEffect(() => {
    if (recording && adviceTimerRef.current === null) {
      adviceTimerRef.current = window.setInterval(async () => {
        try {
          const res = await fetch(ADVICE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: transcriptRef.current }),
          });
          if (!res.ok) throw new Error("Advice fetch failed");
          const { advice: newAdvice } = await res.json();
          setAdvice(newAdvice);
        } catch (err) {
          console.error("Advice error:", err);
        }
      }, 20000); // every 10 seconds
    }
    return () => {
      if (adviceTimerRef.current !== null) {
        window.clearInterval(adviceTimerRef.current);
        adviceTimerRef.current = null;
      }
    };
  }, [recording]);

  // ─── WebSocket setup: only final transcripts ─────────────────────────────
  useEffect(() => {
    if (!recording) return;
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => console.debug("WS open");
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data.toString());
        if (msg.type === "transcript" && !msg.is_partial) {
          setTranscript(t => t + "\n" + msg.text);
        }
      } catch {}
    };
    ws.onerror = err => console.error("WS error:", err);
    ws.onclose = () => console.debug("WS closed");

    wsRef.current = ws;
    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [recording]);

  // ─── Start streaming mic → WS ──────────────────────────────────────────
  const start = async () => {
    setTranscript("");
    setAdvice("");
    setScore(null);
    setSummary("");
    setCsvName("");
    setPdfStatus("");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
    const ac = new AudioCtx({ sampleRate: 16000 });
    audioCtxRef.current = ac;

    const src  = ac.createMediaStreamSource(stream);
    const proc = ac.createScriptProcessor(4096, 1, 1);
    sourceRef.current    = src;
    processorRef.current = proc;

    proc.onaudioprocess = ev => {
      const buf = ev.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(buf.length);
      for (let i = 0; i < buf.length; i++) {
        const s = Math.max(-1, Math.min(1, buf[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(pcm.buffer);
      }
    };

    src.connect(proc);
    proc.connect(ac.destination);

    setRecording(true);
  };

  // ─── Stop streaming ───────────────────────────────────────────────────
  const stop = () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioCtxRef.current?.close();

    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ event: "EOS" }));
      wsRef.current.close();
      wsRef.current = null;
    }

    setRecording(false);
  };

  // ─── Satisfaction Score ──────────────────────────────────────────────────
  const handleScore = async () => {
    try {
      const res = await fetch(SATISFACTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      const { score } = await res.json();
      setScore(score);
    } catch (err) {
      console.error("Satisfaction error:", err);
    }
  };

  // ─── Summary CSV ─────────────────────────────────────────────────────────
  const handleSummary = async () => {
    try {
      const res = await fetch(SUMMARY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) throw new Error("Failed to fetch summary");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "summary.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  // ─── PDF Upload ──────────────────────────────────────────────────────────
  const handlePDFUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(PDF_UPLOAD_URL, { method: "POST", body: formData });
      const { status } = await res.json();
      setPdfStatus(status);
    } catch (err) {
      console.error("PDF upload error:", err);
      setPdfStatus("Failed");
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex",
      height: "100vh",
      background: "#1e1e2e",
      color: "#e0e0e0",
      overflow: "hidden",
    }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h1>SOUNDAdvice</h1>
          {recording
            ? <button onClick={stop} style={{ background: "#e53e3e", ...buttonStyle }}>Stop</button>
            : <button onClick={start} style={{ background: "#38a169", ...buttonStyle }}>Start</button>
          }
        </header>

        <pre style={{
          flex: 1,
          marginTop: 20,
          background: "#2a2a3e",
          padding: 10,
          borderRadius: 6,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          fontFamily: "monospace",
        }}>
          {transcript}
        </pre>

        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button onClick={handleScore} style={buttonStyle}>🎯 Satisfaction Score</button>
          <button onClick={handleSummary} style={buttonStyle}>🧾 CSV Summary</button>
          <label style={{ ...buttonStyle, cursor: "pointer" }}>
            📄 Upload PDF
            <input type="file" onChange={handlePDFUpload} style={{ display: "none" }} />
          </label>
        </div>

        <div style={{ marginTop: 12 }}>
          {score !== null && <div>📊 Score: <strong>{score}</strong></div>}
          {csvName && <div>🧾 CSV: <code>{csvName}</code></div>}
          {summary && <div>📌 Summary: <em>{summary}</em></div>}
          {pdfStatus && <div>📥 PDF Upload: <strong>{pdfStatus}</strong></div>}
        </div>
      </div>

      <aside style={{
        width: 300,
        borderLeft: "1px solid #333",
        padding: 20,
        display: "flex",
        flexDirection: "column",
        background: "#26263a",
      }}>
        <h2>Advice</h2>
        <div style={{
          flex: 1,
          background: "#1f1f2e",
          padding: 10,
          borderRadius: 6,
          overflowY: "auto",
          whiteSpace: "pre-wrap",
          fontFamily: "monospace",
          lineHeight: 1.4,
        }}>
          {advice}
        </div>
      </aside>
    </div>
  );
}
