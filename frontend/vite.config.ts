// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Node’s built-in webcrypto (available in Node 18+)
import { webcrypto } from 'crypto'
import fs from "fs";
import path from "path";

// Polyfill `globalThis.crypto.hash` for Vite’s dependency hashing
;((): void => {
  const g = globalThis as any
  if (typeof g.crypto === 'undefined') {
    g.crypto = webcrypto
  }
  // If Node’s webcrypto lacks top-level crypto.hash (Node 20+ adds it),
  // create an alias to subtle.digest:
  if (typeof g.crypto.hash !== 'function') {
    g.crypto.hash = async (algorithm: string, data: ArrayBuffer) => {
      return g.crypto.subtle.digest(algorithm, data)
    }
  }
})()

export default defineConfig({
  plugins: [react()],
   server: {
    host: '0.0.0.0',   // <-- bind to all IPv4 interfaces
    port: 5173,        // <-- or whatever port you like
    strictPort: true,
     https: {
      key:  fs.readFileSync(path.resolve(__dirname, "../../certs/privkey.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, "../../certs/fullchain.pem")),
    },
    proxy: {
      // JSON advice API
      "/api": {
        target: "https://3.23.218.13.nip.io:8443",
        secure: false,    // allow self-signed cert
        changeOrigin: true,
      },
      // WebSocket audio stream
      "/ws": {
        target: "wss://3.23.218.13.nip.io:8443",
        ws: true,
        secure: false,
        changeOrigin: true,
      },
    },

    // force HMR to use WSS back to this host:port
    hmr: {
      protocol: "wss",
      host: "3.23.218.13.nip.io",
      port: 5173,
    },
  },
})

