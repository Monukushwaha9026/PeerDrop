// public/js/signaling.js - Client WebSocket Signaling Client with Session Reconnection
export class SignalingClient {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimer = null;
    this.heartbeatInterval = null;
    this.isManualDisconnect = false;

    // Persistent peerId across browser refreshes
    this.peerId = this.getOrCreatePeerId();
  }

  getOrCreatePeerId() {
    let pid = null;
    try {
      pid = sessionStorage.getItem('peerdrop_peer_id');
      if (!pid) {
        pid = `p_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
        sessionStorage.setItem('peerdrop_peer_id', pid);
      }
    } catch (_) {
      pid = `p_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
    }
    return pid;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        try {
          callback(data);
        } catch (err) {
          console.error(`[SignalingClient] Error in listener for ${event}:`, err);
        }
      }
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        const onOpen = () => {
          this.ws.removeEventListener('open', onOpen);
          resolve();
        };
        this.ws.addEventListener('open', onOpen);
        return;
      }

      this.isManualDisconnect = false;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      console.log(`[Signaling] Connecting to ${wsUrl}...`);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[Signaling] WebSocket connection established');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.emit('connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          console.error('[Signaling] Failed to parse message:', event.data, err);
        }
      };

      this.ws.onerror = (err) => {
        console.error('[Signaling] WebSocket error:', err);
        this.emit('error', { error: 'WS_ERROR', message: 'WebSocket connection failed.' });
      };

      this.ws.onclose = () => {
        console.log('[Signaling] WebSocket closed');
        this.isConnected = false;
        this.stopHeartbeat();
        this.emit('disconnected');

        // Automatic exponential backoff reconnection if drop was unexpected
        if (!this.isManualDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 5000);
          console.log(`[Signaling] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          this.reconnectTimer = setTimeout(() => {
            this.connect().catch(() => {});
          }, delay);
        }
      };
    });
  }

  handleMessage(message) {
    const { type, code, role, peerId, sdp, candidate, error, message: msgText, hasPartner } = message;

    switch (type) {
      case 'pong':
        // Heartbeat response
        break;
      case 'room-created':
        this.emit('room-created', { code, peerId });
        break;
      case 'room-joined':
        this.emit('room-joined', { code, role, peerId });
        break;
      case 'session-reconnected':
        this.emit('session-reconnected', { code, role, peerId, hasPartner });
        break;
      case 'peer-reconnecting':
        this.emit('peer-reconnecting');
        break;
      case 'peer-reconnected':
        this.emit('peer-reconnected', { role });
        break;
      case 'peer-joined':
        this.emit('peer-joined');
        break;
      case 'offer':
        this.emit('offer', { sdp });
        break;
      case 'answer':
        this.emit('answer', { sdp });
        break;
      case 'ice-candidate':
        this.emit('ice-candidate', { candidate });
        break;
      case 'peer-left':
        this.emit('peer-left');
        break;
      case 'error':
        this.emit('error', { error, message: msgText });
        break;
      default:
        console.warn('[Signaling] Unhandled message:', message);
    }
  }

  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Signaling] Cannot send; socket is not open');
      return false;
    }
    this.ws.send(JSON.stringify({ type, payload }));
    return true;
  }

  createRoom() {
    return this.send('create-room', { peerId: this.peerId });
  }

  joinRoom(code) {
    return this.send('join-room', { 
      code: (code || '').trim().toUpperCase(),
      peerId: this.peerId
    });
  }

  reconnectSession(code, role = null) {
    return this.send('reconnect-session', {
      code: (code || '').trim().toUpperCase(),
      peerId: this.peerId,
      role
    });
  }

  sendOffer(sdp) {
    return this.send('offer', { sdp });
  }

  sendAnswer(sdp) {
    return this.send('answer', { sdp });
  }

  sendCandidate(candidate) {
    return this.send('ice-candidate', { candidate });
  }

  leaveRoom() {
    return this.send('leave-room');
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      this.send('ping');
    }, 20000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  disconnect() {
    this.isManualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
