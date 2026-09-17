// public/js/webrtc.js - WebRTC RTCPeerConnection and RTCDataChannel Manager

export class WebRTCManager {
  constructor(signalingClient) {
    this.signaling = signalingClient;
    this.peerConnection = null;
    this.dataChannel = null;
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.iceCandidateQueue = [];
    this.listeners = new Map();
    this.isInitiator = false;
    this.setupSignalingListeners();
  }

  setIsInitiator(isInitiator) {
    this.isInitiator = Boolean(isInitiator);
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
          console.error(`[WebRTCManager] Error in listener for ${event}:`, err);
        }
      }
    }
  }

  async loadConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const data = await res.json();
        if (data.iceServers && data.iceServers.length > 0) {
          this.iceServers = data.iceServers;
          console.log('[WebRTC] Loaded ICE configuration:', this.iceServers);
        }
      }
    } catch (err) {
      console.warn('[WebRTC] Could not load /api/config, falling back to default STUN:', err);
    }
  }

  setupSignalingListeners() {
    // When a peer joins our room, we (initiator) initiate the WebRTC offer
    this.signaling.on('peer-joined', async () => {
      console.log('[WebRTC] Peer joined room. Initiating WebRTC connection...');
      await this.initiateConnection();
    });

    // When a peer reconnects to an active room
    this.signaling.on('peer-reconnected', async () => {
      console.log('[WebRTC] Peer reconnected. Initiating WebRTC connection if host...');
      if (this.isInitiator) {
        await this.initiateConnection();
      }
    });

    // When a peer temporarily disconnects (e.g. refreshing)
    this.signaling.on('peer-reconnecting', () => {
      console.log('[WebRTC] Peer is reconnecting. Closing current RTCPeerConnection...');
      this.close();
      this.emit('peer-reconnecting');
    });

    // When we receive an SDP offer from peer
    this.signaling.on('offer', async ({ sdp }) => {
      console.log('[WebRTC] Received SDP offer from peer');
      await this.handleOffer(sdp);
    });

    // When we receive an SDP answer from peer
    this.signaling.on('answer', async ({ sdp }) => {
      console.log('[WebRTC] Received SDP answer from peer');
      await this.handleAnswer(sdp);
    });

    // When we receive an ICE candidate
    this.signaling.on('ice-candidate', async ({ candidate }) => {
      await this.handleIceCandidate(candidate);
    });

    // When peer disconnects permanently from room
    this.signaling.on('peer-left', () => {
      console.log('[WebRTC] Peer left room');
      this.emit('peer-left');
      this.close();
    });
  }

  createPeerConnection() {
    this.close(); // Clean up any existing connection

    console.log('[WebRTC] Creating RTCPeerConnection with ICE servers:', this.iceServers);
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers
    });

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendCandidate(event.candidate);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection ? this.peerConnection.connectionState : 'closed';
      console.log(`[WebRTC] Connection state changed: ${state}`);
      this.emit('connectionstatechange', state);
      if (state === 'failed') {
        this.emit('error', new Error('WebRTC connection failed. Please check network/STUN settings.'));
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection ? this.peerConnection.iceConnectionState : 'closed';
      console.log(`[WebRTC] ICE connection state: ${state}`);
      this.emit('iceconnectionstatechange', state);
    };

    // Receiver listener for RTCDataChannel created by the initiator
    this.peerConnection.ondatachannel = (event) => {
      console.log('[WebRTC] Received remote RTCDataChannel:', event.channel.label);
      this.setupDataChannel(event.channel);
    };

    return this.peerConnection;
  }

  // Initiator starts offer
  async initiateConnection() {
    this.createPeerConnection();

    // Create DataChannel
    console.log('[WebRTC] Creating local RTCDataChannel: file-transfer');
    const channel = this.peerConnection.createDataChannel('file-transfer', {
      ordered: true
    });
    this.setupDataChannel(channel);

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.signaling.sendOffer(this.peerConnection.localDescription);
    } catch (err) {
      console.error('[WebRTC] Error creating offer:', err);
      this.emit('error', err);
    }
  }

  // Receiver handles offer and creates answer
  async handleOffer(sdp) {
    this.createPeerConnection();

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.drainCandidateQueue();

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      this.signaling.sendAnswer(this.peerConnection.localDescription);
    } catch (err) {
      console.error('[WebRTC] Error handling offer:', err);
      this.emit('error', err);
    }
  }

  // Initiator handles answer
  async handleAnswer(sdp) {
    if (!this.peerConnection) return;

    try {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.drainCandidateQueue();
    } catch (err) {
      console.error('[WebRTC] Error handling answer:', err);
      this.emit('error', err);
    }
  }

  // Handle incoming ICE candidate with queuing for timing safety
  async handleIceCandidate(candidate) {
    if (!candidate) return;

    if (this.peerConnection && this.peerConnection.remoteDescription && this.peerConnection.remoteDescription.type) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTC] Error adding ICE candidate:', err);
      }
    } else {
      this.iceCandidateQueue.push(candidate);
    }
  }

  async drainCandidateQueue() {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTC] Error draining queued candidate:', err);
      }
    }
  }

  setupDataChannel(channel) {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';

    this.dataChannel.onopen = () => {
      console.log('[WebRTC] RTCDataChannel is OPEN');
      this.emit('datachannel-open', this.dataChannel);
    };

    this.dataChannel.onclose = () => {
      console.log('[WebRTC] RTCDataChannel is CLOSED');
      this.emit('datachannel-close');
    };

    this.dataChannel.onerror = (err) => {
      console.error('[WebRTC] RTCDataChannel error:', err);
      this.emit('datachannel-error', err);
    };

    this.dataChannel.onmessage = (event) => {
      this.emit('message', event.data);
    };
  }

  send(data) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('[WebRTC] Cannot send: DataChannel is not open');
      return false;
    }
    this.dataChannel.send(data);
    return true;
  }

  close() {
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch (_) {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (_) {}
      this.peerConnection = null;
    }
    this.iceCandidateQueue = [];
  }
}
