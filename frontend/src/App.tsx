import React, { useState, useRef, useEffect } from "react";

const WS_URL     = "/ws/audio";
const ADVICE_URL = "/api/advice";

export default function App() {
  const [recording,  setRecording]  = useState(false);
  const [transcript, setTranscript] = useState("");
  const [advice,     setAdvice]     = useState("");

  const wsRef          = useRef<WebSocket|null>(null);
  const audioCtxRef    = useRef<AudioContext|null>(null);
  const processorRef   = useRef<ScriptProcessorNode|null>(null);
  const sourceRef      = useRef<MediaStreamAudioSourceNode|null>(null);
  const adviceTimerRef = useRef<number|undefined>(undefined);

  // Advice polling every 2s
  useEffect(() => {
    if (!recording) return;
    adviceTimerRef.current = window.setInterval(async () => {
      const text = transcript.trim();
      if (!text) return;
      try {
        const res = await fetch(ADVICE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text }),
        });
        const { advice: newAdvice } = await res.json();
        setAdvice(newAdvice);
      } catch (err) {
        console.error("Advice error:", err);
      }
    }, 2000);

    return () => {
      if (adviceTimerRef.current) {
        clearInterval(adviceTimerRef.current);
        adviceTimerRef.current = undefined;
      }
    };
  }, [recording, transcript]);

  const start = async () => {
    setTranscript("");
    setAdvice("");

    // — WebSocket setup —
    const ws = new WebSocket(WS_URL);
    ws.binaryType = "arraybuffer";
    ws.onopen    = () => console.debug("WS open");
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data.toString());
        if (msg.type === "transcript") {
          setTranscript(t => t + " " + msg.text);
        }
      } catch {}
    };
    ws.onerror = (err) => console.error("WS error:", err);
    ws.onclose = () => console.debug("WS closed");
    wsRef.current = ws;

    // — Audio capture @16kHz via ScriptProcessorNode —
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioCtxClass = (window.AudioContext ||
                           (window as any).webkitAudioContext);
    const ac = new AudioCtxClass({ sampleRate: 16000 });
    audioCtxRef.current = ac;

    const src  = ac.createMediaStreamSource(stream);
    const proc = ac.createScriptProcessor(4096, 1, 1);
    sourceRef.current   = src;
    processorRef.current = proc;

    proc.onaudioprocess = ev => {
      const buf = ev.inputBuffer.getChannelData(0);
      const pcm = new Int16Array(buf.length);
      for (let i = 0; i < buf.length; i++) {
        const s = Math.max(-1, Math.min(1, buf[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(pcm.buffer);
      }
    };

    src.connect(proc);
    proc.connect(ac.destination);

    setRecording(true);
  };

  const stop = () => {
    // tear down
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    audioCtxRef.current?.close();

    wsRef.current?.send(JSON.stringify({ event: "EOS" }));
    wsRef.current?.close();
    wsRef.current = null;

    setRecording(false);
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      margin: 0,
      fontFamily: "system-ui, sans-serif",
      background: "#1e1e2e",
      color: "#e0e0e0",
    }}>
      {/* HEADER */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "1rem 2rem",
        background: "#26263a",
        boxShadow: "0 2px 4px rgba(0,0,0,0.6)",
      }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>
          Customer Care Assistant
        </h1>
        {recording ? (
          <button
            onClick={stop}
            style={{
              background: "#e53e3e",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              padding: "0.5rem 1rem",
              cursor: "pointer",
            }}
          >
            ⏹ Stop
          </button>
        ) : (
          <button
            onClick={start}
            style={{
              background: "#38a169",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              padding: "0.5rem 1rem",
              cursor: "pointer",
            }}
          >
            ▶ Start
          </button>
        )}
      </header>

      {/* MAIN CONTENT */}
      <div style={{
        display: "flex",
        flex: 1,
        overflow: "hidden",
      }}>
        {/* TRANSCRIPTION PANEL */}
        <div style={{
          flex: 1,
          padding: "1rem",
          display: "flex",
          flexDirection: "column"
        }}>
          <h2 style={{ marginBottom: "0.5rem" }}>Transcription</h2>
          <div style={{
            flex: 1,
            background: "#2a2a3e",
            border: "1px solid #3c3c5a",
            borderRadius: "8px",
            padding: "1rem",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
            lineHeight: 1.5,
          }}>
            {transcript}
          </div>
        </div>

        {/* ADVICE SIDEBAR */}
        <aside style={{
          width: "300px",
          padding: "1rem",
          background: "#26263a",
          borderLeft: "1px solid #3c3c5a",
          display: "flex",
          flexDirection: "column"
        }}>
          <h2 style={{ marginBottom: "0.5rem" }}>Advice</h2>
          <div style={{
            flex: 1,
            background: "#1f1f2e",
            border: "1px solid #3c3c5a",
            borderRadius: "8px",
            padding: "1rem",
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
            lineHeight: 1.5,
          }}>
            {advice}
          </div>
        </aside>
      </div>
    </div>
  );
}
