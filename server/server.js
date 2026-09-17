// server/server.js - Express & WebSocket Entrypoint
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import QRCode from 'qrcode';
import { setupSignaling } from './signaling.js';
import { roomManager } from './rooms.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Parsing headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Serve static frontend assets with caching
app.use(express.static(path.join(projectRoot, 'public'), {
  maxAge: '1h'
}));

// Explicitly ensure assets directory is cached
app.use('/assets', express.static(path.join(projectRoot, 'public', 'assets'), {
  maxAge: '1d'
}));

// ICE Server Configuration Endpoint
app.get('/api/config', (req, res) => {
  const iceServers = [];

  // Multi-STUN Configuration for network resilience & NAT traversal
  const stunUrls = process.env.STUN_SERVER 
    ? [process.env.STUN_SERVER]
    : [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun.cloudflare.com:3478'
      ];
  iceServers.push({ urls: stunUrls });

  // Optional TURN Configuration (Architectural Support)
  if (process.env.TURN_SERVER) {
    const turnConfig = {
      urls: process.env.TURN_SERVER,
    };
    if (process.env.TURN_USERNAME) {
      turnConfig.username = process.env.TURN_USERNAME;
    }
    if (process.env.TURN_PASSWORD) {
      turnConfig.credential = process.env.TURN_PASSWORD;
    }
    iceServers.push(turnConfig);
  }

  res.json({
    iceServers,
    env: process.env.NODE_ENV || 'development'
  });
});

// Vector SVG QR Code Endpoint for Device Pairing
app.get('/api/qr/:code', async (req, res) => {
  try {
    const code = (req.params.code || '').trim().toUpperCase();
    const origin = `${req.protocol}://${req.get('host')}`;
    const joinUrl = `${origin}/join/${code}`;

    const svg = await QRCode.toString(joinUrl, {
      type: 'svg',
      margin: 1,
      width: 200,
      color: {
        dark: '#1d1d1f',
        light: '#ffffff'
      }
    });

    res.type('image/svg+xml').send(svg);
  } catch (err) {
    console.error('[Server] QR generation error:', err);
    res.status(500).send('<svg><text>QR Error</text></svg>');
  }
});

// Health check endpoint for Render / monitoring
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'peerdrop-signaling',
    uptime: process.uptime()
  });
});

// Deep link route e.g. /join/X7K9-P2 (ignore static asset requests)
app.get('/join/:code', (req, res, next) => {
  if (req.params.code && req.params.code.includes('.')) {
    return next();
  }
  res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(projectRoot, 'public', 'index.html'));
});

// Create HTTP Server and bind WebSocket Signaling
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

setupSignaling(wss);

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(` PeerDrop Signaling Server`);
  console.log(` Running on: http://localhost:${PORT}`);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`=========================================`);
});

// Graceful termination handling
function shutdown(signal) {
  console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
  roomManager.destroy();
  wss.close(() => {
    server.close(() => {
      console.log('[Server] Closed all connections. Exiting.');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
