// server/signaling.js - WebRTC Signaling Protocol Handler
import { roomManager } from './rooms.js';

export function setupSignaling(wss) {
  // Callback when a disconnected peer fails to reconnect within the 15s grace period
  roomManager.onPeerLeftPermanently = (remainingPeer, code) => {
    console.log(`[Signaling] Grace period expired in ${code}. Notifying remaining peer.`);
    safeSend(remainingPeer, { type: 'peer-left' });
  };

  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`[Signaling] Peer connected from ${ip}`);

    // Heartbeat check
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (rawMessage) => {
      let message;
      try {
        message = JSON.parse(rawMessage.toString());
      } catch (err) {
        console.warn('[Signaling] Received invalid JSON:', rawMessage.toString().slice(0, 100));
        ws.send(JSON.stringify({ type: 'error', error: 'INVALID_MESSAGE', message: 'Malformed JSON payload.' }));
        return;
      }

      const { type, payload } = message;

      switch (type) {
        case 'ping':
          safeSend(ws, { type: 'pong' });
          break;

        case 'create-room': {
          setTimeout(() => {
            const { code, peerId } = roomManager.createRoom(ws, payload?.peerId);
            safeSend(ws, { type: 'room-created', code, peerId });
          }, 100);
          break;
        }

        case 'join-room': {
          const roomCode = payload?.code;
          if (!roomCode) {
            safeSend(ws, { type: 'error', error: 'MISSING_CODE', message: 'Room code is required.' });
            return;
          }
          const result = roomManager.joinRoom(roomCode, ws, payload?.peerId);
          if (!result.success) {
            safeSend(ws, { type: 'error', error: result.error, message: result.message });
            return;
          }

          // Acknowledge joining peer
          safeSend(ws, { type: 'room-joined', code: result.code, role: result.role, peerId: result.peerId });

          // Notify existing peer that a partner joined
          if (result.otherPeer) {
            safeSend(result.otherPeer, { type: 'peer-joined' });
          }
          break;
        }

        case 'reconnect-session': {
          const { code, peerId, role } = payload || {};
          if (!code) {
            safeSend(ws, { type: 'error', error: 'MISSING_CODE', message: 'Room code is required to reconnect.' });
            return;
          }

          const result = roomManager.reconnectPeer(code, peerId, ws, role);
          if (!result.success) {
            safeSend(ws, { type: 'error', error: result.error, message: result.message });
            return;
          }

          console.log(`[Signaling] Reconnected ${result.role} in ${result.code}`);
          safeSend(ws, {
            type: 'session-reconnected',
            code: result.code,
            role: result.role,
            peerId: result.peerId,
            hasPartner: Boolean(result.otherPeer)
          });

          // Inform other peer that partner reconnected
          if (result.otherPeer) {
            console.log(`[Signaling] Informing partner in ${result.code} that ${result.role} reconnected`);
            safeSend(result.otherPeer, { type: 'peer-reconnected', role: result.role });
          }
          break;
        }

        case 'offer': {
          const otherPeer = roomManager.getOtherPeer(ws);
          if (otherPeer) {
            console.log(`[WebRTC] Forwarding SDP Offer in room ${roomManager.getRoomCode(ws)}`);
            safeSend(otherPeer, { type: 'offer', sdp: payload.sdp });
          } else {
            safeSend(ws, { type: 'error', error: 'NO_PEER', message: 'No peer found in room to receive offer.' });
          }
          break;
        }

        case 'answer': {
          const otherPeer = roomManager.getOtherPeer(ws);
          if (otherPeer) {
            console.log(`[WebRTC] Forwarding SDP Answer in room ${roomManager.getRoomCode(ws)}`);
            safeSend(otherPeer, { type: 'answer', sdp: payload.sdp });
          } else {
            safeSend(ws, { type: 'error', error: 'NO_PEER', message: 'No peer found in room to receive answer.' });
          }
          break;
        }

        case 'ice-candidate': {
          const otherPeer = roomManager.getOtherPeer(ws);
          if (otherPeer && payload?.candidate) {
            safeSend(otherPeer, { type: 'ice-candidate', candidate: payload.candidate });
          }
          break;
        }

        case 'leave-room': {
          handlePeerLeave(ws, true);
          safeSend(ws, { type: 'left-room' });
          break;
        }

        default:
          console.warn(`[Signaling] Unrecognized message type: ${type}`);
          safeSend(ws, { type: 'error', error: 'UNKNOWN_TYPE', message: `Unknown message type: ${type}` });
          break;
      }
    });

    ws.on('close', (code, reason) => {
      console.log(`[Signaling] Peer disconnected (code: ${code})`);
      handlePeerLeave(ws, false);
    });

    ws.on('error', (err) => {
      console.error('[Signaling] WebSocket error:', err.message);
      handlePeerLeave(ws, false);
    });
  });

  // Keep-alive heartbeat interval (30s)
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        console.log('[Signaling] Terminating dead client');
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });
}

function handlePeerLeave(ws, isExplicitLeave = false) {
  const result = roomManager.removePeer(ws, isExplicitLeave);
  if (result && result.remainingPeer) {
    if (result.temporary) {
      console.log(`[Signaling] Peer in ${result.code} temporarily disconnected (grace period active)`);
      safeSend(result.remainingPeer, { type: 'peer-reconnecting' });
    } else {
      console.log(`[Signaling] Notifying peer in ${result.code} that partner left`);
      safeSend(result.remainingPeer, { type: 'peer-left' });
    }
  }
}

function safeSend(ws, data) {
  if (ws && ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      console.error('[Signaling] Error sending message:', err.message);
    }
  }
}
