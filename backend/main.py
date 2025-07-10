# main.py
import asyncio
import json
import logging
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from fastapi.responses import FileResponse

from amazon_transcribe.client import TranscribeStreamingClient
from amazon_transcribe.handlers import TranscriptResultStreamHandler
from amazon_transcribe.model import TranscriptEvent

from send_to_chroma import (
    inference,
    inference_advice,
    generate_csv_file,
)
from do_it import do_it
from textblob import TextBlob
import re

# ─── AWS CONFIG ─────────────────────────────────────────────────────────────
REGION            = "us-east-2"
SAMPLE_RATE       = 16000
MEDIA_ENCODING    = "pcm"
KEEPALIVE_TIMEOUT = 1.0   # seconds to wait before sending silence

# ─── APP SETUP ─────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("app")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # lock this down in prod!
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# ─── STREAMHANDLER ──────────────────────────────────────────────────────────
class StreamHandler(TranscriptResultStreamHandler):
    def __init__(self, transcript_result_stream, websocket: WebSocket):
        super().__init__(transcript_result_stream)
        self.websocket = websocket

    async def handle_transcript_event(self, event: TranscriptEvent):
        for result in event.transcript.results:
            await self.websocket.send_json({
                "type":       "transcript",
                "text":       result.alternatives[0].transcript,
                "is_partial": result.is_partial,
            })

# ─── WEBSOCKET ENDPOINT ────────────────────────────────────────────────────
@app.websocket("/ws/audio")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    log.info("🟢 WS connection accepted")

    client = TranscribeStreamingClient(region=REGION)
    stream = await client.start_stream_transcription(
        language_code="en-US",
        media_sample_rate_hz=SAMPLE_RATE,
        media_encoding=MEDIA_ENCODING,
    )
    handler = StreamHandler(stream.output_stream, ws)

    silence = b"\x00" * (SAMPLE_RATE * 2)

    async def send_audio():
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(ws.receive_bytes(), timeout=KEEPALIVE_TIMEOUT)
                    await stream.input_stream.send_audio_event(audio_chunk=chunk)
                except asyncio.TimeoutError:
                    await stream.input_stream.send_audio_event(audio_chunk=silence)

                if ws.client_state.name == "CLOSING":
                    break

        except WebSocketDisconnect:
            log.info("⚠️ WS disconnected by client")
        finally:
            await stream.input_stream.end_stream()
            log.info("🔒 AWS input stream closed")

    await asyncio.gather(send_audio(), handler.handle_events())
    log.info("🔴 WS handler tasks completed")

# ─── Pydantic models for POST bodies ────────────────────────────────────────
class TranscriptRequest(BaseModel):
    transcript: str

# ─── ADVICE ENDPOINT ─────────────────────────────────────────────────────
@app.post("/api/advice")
def advice(req: TranscriptRequest):
    # runs in FastAPI’s thread pool, so it won’t block the event loop
    answer = inference(req.transcript, "qwen3:0.6b")
    return {"advice": re.sub(r"<think>.*?</think>", "", answer, flags=re.DOTALL)}

# ─── AGENT FEEDBACK ENDPOINT ──────────────────────────────────────────────
@app.post("/api/feedback-agent")
async def feedback_for_agent(req: TranscriptRequest):
    result = inference_advice(req.transcript, "qwen3:0.6b")
    return {"feedback": result}

# ─── SATISFACTION SCORE ENDPOINT ─────────────────────────────────────────
@app.post("/api/satisfaction-score")
async def satisfaction_score(req: TranscriptRequest):
    polarity = TextBlob(req.transcript).sentiment.polarity
    score = round(((polarity + 1) / 2) * 9 + 1)
    return {"score": score}

# ─── SUMMARY (CSV) ENDPOINT ───────────────────────────────────────────────
# @app.post("/api/summary")
# async def summary_csv(req: TranscriptRequest):
#     name, summary = generate_csv_file(req.transcript, "qwen3:0.6b")
#     return {"name": name.strip(), "summary": summary.strip()}
@app.post("/api/summary")
async def summary_csv(req: TranscriptRequest):
    filename, filepath = generate_csv_file(req.transcript, "qwen3:0.6b")

    return FileResponse(
        path=filepath,
        filename=filename,
        media_type="text/csv"
    )
    
# ─── PDF UPLOAD ENDPOINT ──────────────────────────────────────────────────
@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    os.makedirs("./pdf", exist_ok=True)
    pdf_path = os.path.join("./pdf", file.filename)
    with open(pdf_path, "wb") as f:
        f.write(await file.read())
    do_it(pdf_path)
    return {"status": "PDF processed and indexed"}
