# backend/main.py
import asyncio
import json
import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect,UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from textblob import TextBlob

from amazon_transcribe.client import TranscribeStreamingClient
from amazon_transcribe.handlers import TranscriptResultStreamHandler
from amazon_transcribe.model import TranscriptEvent

from send_to_chroma import (
    inference,
    inference_advice,
    generate_csv_file,
)
from do_it import do_it

# ─── SETUP ─────────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ws")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://3.23.218.13.nip.io:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


# ─── HANDLER ───────────────────────────────────────────────────────────────────
class StreamHandler(TranscriptResultStreamHandler):
    def __init__(self, transcript_result_stream, websocket: WebSocket):
        super().__init__(transcript_result_stream)
        self.websocket = websocket

    async def handle_transcript_event(self, event: TranscriptEvent):
        for result in event.transcript.results:
            if not result.is_partial:
                text = result.alternatives[0].transcript
                log.info(f"🔊 Transcribe → {text!r}")
                await self.websocket.send_json({"type":"transcript", "text":text})


# ─── WS ENDPOINT ───────────────────────────────────────────────────────────────
@app.websocket("/ws/audio")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    log.info("🟢 WS connection accepted")

    # start AWS Transcribe
    client = TranscribeStreamingClient(region="us-east-2")
    stream = await client.start_stream_transcription(
        language_code="en-US",
        media_sample_rate_hz=16000,
        media_encoding="pcm",
    )
    handler = StreamHandler(stream.output_stream, ws)

    async def send_audio():
        try:
            while True:
                msg = await ws.receive()
                # binary audio chunks
                if "bytes" in msg:
                    data = msg["bytes"]
                    log.info(f"🎧 Received {len(data)} bytes from client")
                    await stream.input_stream.send_audio_event(audio_chunk=data)
                # text frames (EOS)
                elif "text" in msg:
                    payload = msg["text"]
                    log.info(f"📨 Received control message: {payload}")
                    try:
                        obj = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    if obj.get("event") == "EOS":
                        log.info("✂️ EOS received – closing AWS stream")
                        break
        except WebSocketDisconnect:
            log.info("⚠️ WS disconnected by client")
        finally:
            await stream.input_stream.end_stream()
            log.info("🔒 AWS input stream closed")

    # run audio → AWS and AWS → WS in parallel
    await asyncio.gather(send_audio(), handler.handle_events())
    log.info("🔴 WS handler tasks completed")

# ─── PAYLOAD MODEL ──────────────────────────────────────────────────────────
class TranscriptRequest(BaseModel):
    transcript: str


# ─── ADVICE ENDPOINT ─────────────────────────────────────────────────────────
@app.post("/api/advice")
async def advice(req: TranscriptRequest):
    answer = inference(req.transcript, "qwen3:0.6b")
    return {"advice": answer}


# ─── FEEDBACK ENDPOINT ──────────────────────────────────────────────────────
@app.post("/api/feedback-agent")
async def feedback_for_agent(req: TranscriptRequest):
    result = inference_advice(req.transcript, "qwen3:0.6b")
    return {"feedback": result}


# ─── SATISFACTION SCORE ─────────────────────────────────────────────────────
@app.post("/api/satisfaction-score")
async def satisfaction_score(req: TranscriptRequest):
    polarity = TextBlob(req.transcript).sentiment.polarity
    score = round(((polarity + 1) / 2) * 9 + 1)
    return {"score": score}


# ─── SUMMARY (CSV) ──────────────────────────────────────────────────────────
@app.post("/api/summary")
async def summary_csv(req: TranscriptRequest):
    name, summary = generate_csv_file(req.transcript, "qwen3:0.6b")
    return {"name": name.strip(), "summary": summary.strip()}


# ─── PDF UPLOAD ─────────────────────────────────────────────────────────────
@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    os.makedirs("./pdf", exist_ok=True)
    pdf_path = os.path.join("./pdf", file.filename)
    with open(pdf_path, "wb") as f:
        f.write(await file.read())
    do_it(pdf_path)
    return {"status": "PDF processed and indexed"}
