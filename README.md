# SOUNDAdvice

A real-time GenAI-powered adn RAG enabled web app that helps customer-service agents by streaming live audio, transcribing it with AWS Transcribe, and generating on-the-fly coaching advice using a Qwen-based model. 
---

## 🚀 Features & Functionality

- **Live audio streaming & transcription**  
  • Captures microphone input at 16 kHz  
  • Sends audio to AWS Transcribe over WebSockets  
  • Displays only final transcript lines in real time  

- **Generative AI advice**  
  • Every time a new transcript line appears, POSTs it to `/api/advice`  
  • Renders returned tips instantly in the sidebar  

- **Satisfaction score**  
  • Click **🎯 Satisfaction Score** to compute a sentiment-based score  

- **CSV summary**  
  • Click **🧾 CSV Summary** to generate and download a CSV overview  

- **PDF upload**  
  • Use **📄 Upload PDF** to send any PDF to the backend for our RAG system to work as per your needs

---

## 🚀 Live Demo

Our app is deployed on AWS behind a nip.io domain:  
**https://3.23.218.13.nip.io:5173/**

_Requires a mic-enabled browser (Chrome or Firefox)._

---

## 🧪 Testing the Deployed App

1. Open your browser and navigate to:  
   **https://3.23.218.13.nip.io:5173/**
2. Upload any PDF via **📄 Upload PDF** .  
3. Click **Start**, and start a customer-agent dialogue, the model can succesfully tell who's who and generate tips based on the customer's need.  
4. Verify:  
   - Transcript appears in the left panel.  
   - Advice updates after 10s (would be quicker if better hardware is used).  
5. Click **🎯 Satisfaction Score** → observe the numeric score.  
6. Click **🧾 CSV Summary** → note the returned CSV filename and summary text.  


