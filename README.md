# ⚡ PeerDrop

> **Seamless, blazing-fast, peer-to-peer file sharing directly between devices in your browser.**  
> No file size limits. No intermediate servers. No cloud storage.

---

## ✨ Features

- **🚀 Direct P2P Transfers**: Files are transferred directly between peers via **WebRTC DataChannels** with chunked streaming and adaptive backpressure.
- **🍏 Apple-Inspired Liquid Glass UI**: Clean frosted glass aesthetics, fluid spring physics, light/dark mode, and responsive layout for desktop and mobile.
- **📱 Instant Pairing**: Connect devices effortlessly using a **6-digit room code**, one-tap **deep link**, or by scanning an SVG **QR Code** with your phone's camera.
- **🔄 Session Resilience**: Connections survive unexpected page reloads and network blips through a smart grace-period and auto-reconnect handshake.
- **📊 Real-Time Metrics**: Live progress bars, transfer speed indicators (MB/s), and calculated time remaining (ETA).
- **🔒 Privacy First**: Your files never touch a server or hard drive—transfers happen entirely memory-to-memory across encrypted peer connections.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla JavaScript (ES Modules), Custom Liquid Glass CSS, SVG Icons, HTML5 File & Drag/Drop APIs.
- **Backend**: Node.js, Express (static asset delivery, QR generation, health monitoring).
- **Signaling**: Native WebSockets (`ws`) for lightweight peer discovery and session negotiation.
- **Network / NAT Traversal**: WebRTC (`RTCPeerConnection`, `RTCDataChannel`) with multi-STUN fallback support.

---

## 🚀 Quick Start (Local Setup)

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- Modern web browser (Chrome, Safari, Firefox, Edge)

### 1. Clone the repository
```bash
git clone https://github.com/Monukushwaha9026/PeerDrop.git
cd PeerDrop
```

### 2. Install dependencies
```bash
npm install
```

### 3. Start the server
```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in two different browser tabs (or across two devices on the same local network) and start sharing!

---

## 🌐 Deploy to Render.com (Free)

Deploying PeerDrop live takes less than 2 minutes:

1. Fork or push this repository to your GitHub account.
2. Sign in to [Render.com](https://render.com).
3. Click **New +** ➔ **Web Service** and connect your `PeerDrop` repository.
4. Set the following options:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: `Free`
   - **Health Check Path** (under *Advanced*): `/health`
5. Click **Create Web Service**.

> Render automatically provisions free SSL (`https://` and `wss://`), which is required for camera QR scanning and WebRTC in production!

---

## 📂 Project Structure

```text
peerdrop/
├── public/               # Frontend Client
│   ├── assets/           # Logos, icons, and graphic assets
│   ├── css/              # Apple-inspired Liquid Glass motion styles
│   ├── js/
│   │   ├── app.js        # UI coordinator & lifecycle orchestrator
│   │   ├── fileSender.js # Chunking & backpressure stream sender
│   │   ├── fileReceiver.js# Blob buffer assembler & auto-downloader
│   │   ├── signaling.js  # WebSocket reconnection & message client
│   │   ├── ui.js         # DOM updates & animation drivers
│   │   └── webrtc.js     # RTCPeerConnection & DataChannel wrapper
│   └── index.html        # Main app entrypoint
├── server/               # Node.js Signaling & Web Server
│   ├── rooms.js          # Room state manager with reload grace period
│   ├── server.js         # Express app, QR route & health checks
│   └── signaling.js      # WebSocket signaling dispatcher
├── render.yaml           # One-click Render deployment blueprint
└── package.json          # Dependencies and scripts
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
