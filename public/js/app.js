// public/js/app.js - Application Orchestrator for PeerDrop with Session Recovery
import { SignalingClient } from './signaling.js';
import { WebRTCManager } from './webrtc.js';
import { UIManager } from './ui.js';
import { FileSender } from './fileSender.js';
import { FileReceiver } from './fileReceiver.js';
import { formatBytes } from './utils.js';

class App {
  constructor() {
    this.signaling = new SignalingClient();
    this.webrtc = new WebRTCManager(this.signaling);
    this.ui = new UIManager();
    this.fileSender = new FileSender();
    this.fileReceiver = new FileReceiver();

    this.currentRoomCode = null;
    this.isInitiator = false;
    this.stagedFile = null;
    this.connectingTimer = null;

    this.init();
  }

  async init() {
    this.ui.initTheme();
    await this.webrtc.loadConfig();

    this.bindDOMEvents();
    this.bindFileEvents();
    this.bindSignalingEvents();
    this.bindWebRTCEvents();
    this.bindNetworkEvents();
    this.bindLifecycleEvents();

    await this.checkSessionOrDeepLink();
  }

  saveSession(state = 'waiting') {
    if (!this.currentRoomCode) return;
    try {
      const session = {
        roomCode: this.currentRoomCode,
        role: this.isInitiator ? 'host' : 'guest',
        peerId: this.signaling.peerId,
        state,
        savedAt: Date.now()
      };
      sessionStorage.setItem('peerdrop_session', JSON.stringify(session));
    } catch (_) {}
  }

  loadSession() {
    try {
      const raw = sessionStorage.getItem('peerdrop_session');
      if (!raw) return null;
      const session = JSON.parse(raw);
      // Valid for 30 minutes
      if (Date.now() - session.savedAt > 30 * 60 * 1000) {
        sessionStorage.removeItem('peerdrop_session');
        return null;
      }
      return session;
    } catch (_) {
      return null;
    }
  }

  clearSession() {
    try {
      sessionStorage.removeItem('peerdrop_session');
    } catch (_) {}
  }

  async checkSessionOrDeepLink() {
    const savedSession = this.loadSession();
    const path = window.location.pathname;
    const match = path.match(/\/join\/([A-Za-z0-9\-]+)/);
    const urlCode = match && match[1] ? match[1].toUpperCase() : null;

    // A. Session Resumption across Page Refresh
    if (savedSession && savedSession.roomCode && (!urlCode || urlCode === savedSession.roomCode)) {
      console.log('[App] Resuming session across page refresh:', savedSession);
      const code = savedSession.roomCode;
      this.currentRoomCode = code;
      this.isInitiator = savedSession.role === 'host';
      this.webrtc.setIsInitiator(this.isInitiator);
      this.ui.setRoomCode(code);

      if (window.location.pathname !== `/join/${code}`) {
        window.history.replaceState({ code }, '', `/join/${code}`);
      }

      if (savedSession.state === 'connected' || savedSession.state === 'connecting') {
        this.startConnectingView('Reconnecting peer-to-peer session...');
      } else {
        this.ui.showView('waiting');
        this.ui.setGlobalStatus('waiting', 'Restoring room...');
      }

      this.ui.showToast('Reconnecting previous session...');

      try {
        await this.signaling.connect();
        this.signaling.reconnectSession(code, savedSession.role);
      } catch (err) {
        console.warn('[App] Reconnection signaling error:', err);
        this.handleDisconnect();
      }
      return;
    }

    // B. Normal Deep Link (first-time join via URL/QR)
    if (urlCode) {
      console.log('[App] Auto-filling room code from deep link / QR scan:', urlCode);
      this.ui.showView('join');
      if (this.ui.joinInput) {
        this.ui.joinInput.value = urlCode;
      }
      this.ui.showJoinBanner(true);
    }
  }

  bindLifecycleEvents() {
    // Native browser Back and Forward button navigation (popstate)
    window.addEventListener('popstate', () => {
      const path = window.location.pathname;
      const match = path.match(/\/join\/([A-Za-z0-9\-]+)/);
      if (!match || path === '/') {
        if (this.currentRoomCode) {
          this.handleDisconnect();
        } else {
          this.ui.showView('idle');
        }
      } else if (match[1]) {
        const code = match[1].toUpperCase();
        if (this.currentRoomCode !== code) {
          this.ui.showView('join');
          if (this.ui.joinInput) this.ui.joinInput.value = code;
          this.ui.showJoinBanner(true);
        }
      }
    });

    // Beforeunload: Save state for page refresh
    window.addEventListener('beforeunload', () => {
      if (this.currentRoomCode) {
        const isConn = this.webrtc.dataChannel?.readyState === 'open';
        this.saveSession(isConn ? 'connected' : 'waiting');
      }
    });
  }

  bindNetworkEvents() {
    window.addEventListener('online', () => {
      this.ui.showToast('Network restored');
      this.ui.setGlobalStatus('idle', 'Network Restored');
    });

    window.addEventListener('offline', () => {
      this.ui.showToast('Network disconnected');
      this.ui.setGlobalStatus('error', 'Offline');
      this.handleDisconnect('Device went offline');
    });
  }

  bindDOMEvents() {
    // Idle Screen Actions
    document.getElementById('btn-create-room')?.addEventListener('click', () => this.handleCreateRoom());
    document.getElementById('btn-show-join')?.addEventListener('click', () => {
      this.ui.showJoinBanner(false);
      this.ui.showView('join');
    });

    // Join Screen Actions
    document.getElementById('btn-back-join')?.addEventListener('click', () => {
      this.clearSession();
      if (this.ui.joinInput) this.ui.joinInput.value = '';
      this.ui.showJoinBanner(false);
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.history.pushState({}, '', '/');
      }
      this.ui.showView('idle');
    });
    document.getElementById('form-join')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleJoinRoom();
    });

    // Waiting Screen Actions
    document.getElementById('btn-cancel-waiting')?.addEventListener('click', () => this.handleDisconnect());

    // Copy Code & Copy Link Buttons
    this.ui.setupCopyButton(() => this.currentRoomCode);

    // Connecting Screen Cancel / Retry
    document.getElementById('btn-cancel-connecting')?.addEventListener('click', () => {
      this.handleDisconnect('Connection cancelled by user');
    });

    // Disconnect Button
    document.getElementById('btn-disconnect')?.addEventListener('click', () => this.handleDisconnect());

    // Upgraded P2P Chat & Mobile Tab Bindings
    const sendInput = document.getElementById('test-msg-input');
    const sendBtn = document.getElementById('btn-send-test');
    let typingDebounceTimer = null;
    let isCurrentlyTyping = false;

    const stopTyping = () => {
      if (isCurrentlyTyping) {
        isCurrentlyTyping = false;
        this.webrtc.send(JSON.stringify({ type: 'chat-typing', isTyping: false }));
      }
    };

    const sendTextMessage = (text) => {
      if (!text || !text.trim()) return;
      const cleanText = text.trim();
      const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Stop typing status before sending
      if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
      stopTyping();

      // Render outgoing message immediately with pending status
      this.ui.renderChatMessage({
        id,
        text: cleanText,
        sender: 'sent',
        timestamp,
        status: 'sent'
      });

      // Transmit over WebRTC DataChannel
      const sent = this.webrtc.send(JSON.stringify({
        type: 'chat',
        id,
        text: cleanText,
        timestamp,
        payload: { text: cleanText, timestamp } // backward compatibility
      }));

      if (sent) {
        if (sendInput) {
          sendInput.value = '';
          sendInput.style.height = 'auto';
        }
      } else {
        this.ui.showToast('Failed to send: DataChannel is not open.');
      }
    };

    sendBtn?.addEventListener('click', () => {
      sendTextMessage(sendInput?.value);
    });

    sendInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendTextMessage(sendInput.value);
      }
    });

    // Live Typing Detection with 1.5s Debounce
    sendInput?.addEventListener('input', () => {
      if (sendInput.value.trim().length > 0) {
        if (!isCurrentlyTyping) {
          isCurrentlyTyping = true;
          this.webrtc.send(JSON.stringify({ type: 'chat-typing', isTyping: true }));
        }
        if (typingDebounceTimer) clearTimeout(typingDebounceTimer);
        typingDebounceTimer = setTimeout(() => {
          stopTyping();
        }, 1500);
      } else {
        stopTyping();
      }
    });

    // Quick Snippet Chips
    document.querySelectorAll('.quick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const text = chip.getAttribute('data-text');
        if (text) sendTextMessage(text);
      });
    });

    // Clear Chat Button sync
    document.getElementById('btn-clear-chat')?.addEventListener('click', () => {
      this.webrtc.send(JSON.stringify({ type: 'chat-clear' }));
    });
  }

  bindFileEvents() {
    const dropZone = this.ui.fileDropZone;
    const fileInput = this.ui.fileInput;
    const browseBtn = this.ui.btnBrowseFile;
    const removeBtn = this.ui.btnRemoveSelectedFile;
    const sendBtn = this.ui.btnSendFile;
    const doneBtn = this.ui.btnReceiveAnother;
    const cancelSenderBtn = this.ui.btnCancelSender;
    const cancelReceiverBtn = this.ui.btnCancelReceiver;

    // File Browse / Select Trigger
    browseBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput?.click();
    });

    dropZone?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.stagedFile = file;
        this.ui.showSelectedFile(file);
      }
    });

    // Drag and drop handlers
    ['dragenter', 'dragover'].forEach(event => {
      dropZone?.addEventListener(event, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
    });

    ['dragleave', 'drop'].forEach(event => {
      dropZone?.addEventListener(event, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
    });

    dropZone?.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.stagedFile = files[0];
        this.ui.showSelectedFile(this.stagedFile);
      }
    });

    // Remove selected file
    removeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.stagedFile = null;
      if (fileInput) fileInput.value = '';
      this.ui.showFileDropZone();
    });

    // Send File Button Trigger
    sendBtn?.addEventListener('click', async () => {
      if (!this.stagedFile) {
        this.ui.showToast('Please select a file to send.');
        return;
      }

      if (!this.webrtc.dataChannel || this.webrtc.dataChannel.readyState !== 'open') {
        this.ui.showToast('Data channel not open. Wait for connection.');
        return;
      }

      try {
        await this.fileSender.sendFile(this.stagedFile, this.webrtc.dataChannel);
      } catch (err) {
        console.error('[App] Error during file transmission:', err);
        this.ui.showToast(`Transfer error: ${err.message}`);
        this.ui.showFileDropZone();
      }
    });

    // Cancel Sender button
    cancelSenderBtn?.addEventListener('click', () => {
      this.fileSender.cancel();
      this.webrtc.send(JSON.stringify({ type: 'file-cancel' }));
      this.ui.showToast('File transfer cancelled');
      this.ui.showFileDropZone();
    });

    // Pause/Resume Sender button with instant UI response
    this.ui.btnPauseSender?.addEventListener('click', () => {
      if (this.fileSender.isPaused) {
        if (this.ui.btnPauseSender) {
          this.ui.btnPauseSender.textContent = 'Pause';
          this.ui.btnPauseSender.classList.remove('paused');
        }
        if (this.ui.senderBadge) {
          this.ui.senderBadge.textContent = 'Sending';
        }
        this.fileSender.resume();
      } else {
        if (this.ui.btnPauseSender) {
          this.ui.btnPauseSender.textContent = 'Resume';
          this.ui.btnPauseSender.classList.add('paused');
        }
        if (this.ui.senderBadge) {
          this.ui.senderBadge.textContent = 'Paused';
        }
        this.fileSender.pause();
      }
    });

    // Cancel Receiver button
    cancelReceiverBtn?.addEventListener('click', () => {
      this.fileReceiver.cancel();
      this.webrtc.send(JSON.stringify({ type: 'file-cancel' }));
      this.ui.showToast('File transfer cancelled');
      this.ui.showFileDropZone();
    });

    // Pause/Resume Receiver button with instant UI response
    this.ui.btnPauseReceiver?.addEventListener('click', () => {
      if (this.fileReceiver.isPaused) {
        if (this.ui.btnPauseReceiver) {
          this.ui.btnPauseReceiver.textContent = 'Pause';
          this.ui.btnPauseReceiver.classList.remove('paused');
        }
        if (this.ui.receiverBadge) {
          this.ui.receiverBadge.textContent = 'Receiving';
        }
        this.fileReceiver.resume(this.webrtc.dataChannel);
      } else {
        if (this.ui.btnPauseReceiver) {
          this.ui.btnPauseReceiver.textContent = 'Resume';
          this.ui.btnPauseReceiver.classList.add('paused');
        }
        if (this.ui.receiverBadge) {
          this.ui.receiverBadge.textContent = 'Paused';
        }
        this.fileReceiver.pause(this.webrtc.dataChannel);
      }
    });

    // Direct Stream toggle notification
    this.ui.toggleDirectStream?.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.ui.showToast('⚡ Direct Disk Stream enabled (0 RAM)');
      } else {
        this.ui.showToast('Browser memory download mode active');
      }
    });

    // Transfer completed "Send / Receive Another"
    doneBtn?.addEventListener('click', () => {
      this.stagedFile = null;
      if (fileInput) fileInput.value = '';
      this.ui.showFileDropZone();
    });

    // FileSender Event Listeners
    this.fileSender.on('start', (metadata) => {
      this.ui.showSenderProgress(metadata);
    });

    this.fileSender.on('progress', ({ bytesSent, totalBytes, percent, speedFormatted, etaFormatted, chunkTier, isPaused }) => {
      this.ui.updateSenderProgress(bytesSent, totalBytes, percent, speedFormatted, etaFormatted, chunkTier, isPaused);
    });

    this.fileSender.on('pause', () => {
      this.ui.updateSenderProgress(
        this.fileSender.currentTransfer?.offset || 0,
        this.fileSender.currentTransfer?.file?.size || 0,
        Math.round(((this.fileSender.currentTransfer?.offset || 0) / (this.fileSender.currentTransfer?.file?.size || 1)) * 100),
        '-- MB/s',
        'Paused',
        null,
        true
      );
    });

    this.fileSender.on('resume', () => {
      this.ui.updateSenderProgress(
        this.fileSender.currentTransfer?.offset || 0,
        this.fileSender.currentTransfer?.file?.size || 0,
        Math.round(((this.fileSender.currentTransfer?.offset || 0) / (this.fileSender.currentTransfer?.file?.size || 1)) * 100),
        '-- MB/s',
        'Resuming...',
        null,
        false
      );
    });

    this.fileSender.on('complete', ({ file, crc32 }) => {
      this.ui.showToast(`Sent "${file.name}" (CRC32: ${crc32})`);
      this.stagedFile = null;
      if (fileInput) fileInput.value = '';
      this.ui.showFileDropZone();
    });

    this.fileSender.on('cancelled', () => {
      this.ui.showToast('Transfer cancelled');
      this.stagedFile = null;
      if (fileInput) fileInput.value = '';
      this.ui.showFileDropZone();
    });

    // FileReceiver Event Listeners
    this.fileReceiver.on('start', (fileInfo) => {
      this.ui.showReceiverProgress(fileInfo, fileInfo.size, fileInfo.isDirectStream);
    });

    this.fileReceiver.on('progress', ({ bytesReceived, totalBytes, percent, speedFormatted, etaFormatted, isDirectStream, isPaused }) => {
      this.ui.updateReceiverProgress(bytesReceived, totalBytes, percent, speedFormatted, etaFormatted, isDirectStream, isPaused);
    });

    this.fileReceiver.on('pause', () => {
      this.ui.updateReceiverProgress(
        this.fileReceiver.currentFile?.receivedBytes || 0,
        this.fileReceiver.currentFile?.size || 0,
        Math.round(((this.fileReceiver.currentFile?.receivedBytes || 0) / (this.fileReceiver.currentFile?.size || 1)) * 100),
        '-- MB/s',
        'Paused',
        this.fileReceiver.currentFile?.isDirectStream,
        true
      );
    });

    this.fileReceiver.on('resume', () => {
      this.ui.updateReceiverProgress(
        this.fileReceiver.currentFile?.receivedBytes || 0,
        this.fileReceiver.currentFile?.size || 0,
        Math.round(((this.fileReceiver.currentFile?.receivedBytes || 0) / (this.fileReceiver.currentFile?.size || 1)) * 100),
        '-- MB/s',
        'Resuming...',
        this.fileReceiver.currentFile?.isDirectStream,
        false
      );
    });

    this.fileReceiver.on('complete', (fileInfo) => {
      const msg = fileInfo.isDirectStream 
        ? `Saved "${fileInfo.name}" directly to disk!` 
        : `Received "${fileInfo.name}". Ready to download.`;
      this.ui.showToast(msg);
      this.ui.showFileCompleted(fileInfo);
    });

    this.fileReceiver.on('cancelled', ({ initiator }) => {
      this.ui.showToast(initiator ? 'Transfer cancelled' : 'Transfer cancelled by sender');
      this.ui.showFileDropZone();
    });
  }

  bindSignalingEvents() {
    this.signaling.on('connected', () => {
      this.ui.setGlobalStatus('idle', 'Signaling Connected');
    });

    this.signaling.on('disconnected', () => {
      this.ui.setGlobalStatus('error', 'Signaling Disconnected');
    });

    this.signaling.on('room-created', ({ code }) => {
      console.log('[App] Room created:', code);
      this.currentRoomCode = code;
      this.isInitiator = true;
      this.webrtc.setIsInitiator(true);
      this.saveSession('waiting');
      this.ui.setRoomCode(code);
      if (typeof window !== 'undefined' && window.location.pathname !== `/join/${code}`) {
        window.history.pushState({ code }, '', `/join/${code}`);
      }
      this.ui.showView('waiting');
      this.ui.setGlobalStatus('waiting', 'Waiting for device...');
    });

    this.signaling.on('room-joined', ({ code }) => {
      console.log('[App] Joined room:', code);
      this.currentRoomCode = code;
      this.isInitiator = false;
      this.webrtc.setIsInitiator(false);
      this.saveSession('connecting');
      this.ui.setRoomCode(code);
      if (typeof window !== 'undefined' && window.location.pathname !== `/join/${code}`) {
        window.history.pushState({ code }, '', `/join/${code}`);
      }
      this.startConnectingView('Waiting for host SDP offer...');
    });

    this.signaling.on('session-reconnected', ({ code, role, hasPartner }) => {
      console.log('[App] Session reconnected on server:', code, role, 'hasPartner:', hasPartner);
      this.currentRoomCode = code;
      this.isInitiator = role === 'host';
      this.webrtc.setIsInitiator(this.isInitiator);
      this.ui.setRoomCode(code);

      if (hasPartner) {
        this.saveSession('connecting');
        this.startConnectingView('Partner found. Establishing direct connection...');
        if (this.isInitiator) {
          console.log('[App] Host initiating WebRTC connection offer...');
          this.webrtc.initiateConnection();
        }
      } else {
        this.saveSession('waiting');
        this.ui.showView('waiting');
        this.ui.setGlobalStatus('waiting', 'Waiting for device...');
        this.ui.showToast('Session restored. Waiting for device to connect...');
      }
    });

    this.signaling.on('peer-reconnecting', () => {
      console.log('[App] Partner temporarily disconnected (page refresh / network hiccup)');
      this.ui.showToast('Partner connection interrupted. Waiting for reconnect...');
      this.ui.setGlobalStatus('connecting', 'Partner reconnecting...');
      this.startConnectingView('Partner refreshed. Waiting for reconnection...');
    });

    this.signaling.on('peer-reconnected', ({ role }) => {
      console.log('[App] Partner reconnected to room:', role);
      this.ui.showToast('Partner reconnected! Negotiating direct link...');
      this.startConnectingView('Partner back online. Re-establishing link...');
      if (this.isInitiator) {
        console.log('[App] Host initiating fresh WebRTC offer for reconnected peer...');
        this.webrtc.initiateConnection();
      }
    });

    this.signaling.on('peer-joined', () => {
      console.log('[App] Peer joined our room. Starting negotiation...');
      this.startConnectingView('Creating WebRTC offer & exchanging ICE...');
    });

    this.signaling.on('peer-left', () => {
      if (this.isInitiator && this.currentRoomCode) {
        // Device A (Host): Preserve room session, close WebRTC, return to waiting view
        this.clearConnectingTimeout();
        this.fileSender.cancel();
        this.fileReceiver.reset();
        this.webrtc.close();
        this.ui.resetFileTransferUI();
        this.saveSession('waiting');
        this.ui.showView('waiting');
        this.ui.setGlobalStatus('waiting', 'Waiting for device...');
        this.ui.showToast('Peer disconnected. Waiting for a device to join...');
      } else {
        // Guest: Disconnect back to idle
        this.clearSession();
        this.ui.showToast('Peer disconnected from room.');
        this.handleDisconnect('Peer disconnected');
      }
    });

    this.signaling.on('error', ({ error, message }) => {
      console.error('[App] Signaling error:', error, message);
      this.clearConnectingTimeout();
      this.ui.showToast(message || error);
      this.ui.setGlobalStatus('error', message || 'Error');

      if (error === 'SESSION_EXPIRED' || error === 'SESSION_INVALID' || error === 'ROOM_NOT_FOUND') {
        this.clearSession();
        if (typeof window !== 'undefined' && window.location.pathname !== '/') {
          window.history.replaceState({}, '', '/');
        }
        this.ui.showView('idle');
      } else if (error === 'ROOM_FULL') {
        this.ui.showView('join');
      }
    });
  }

  startConnectingView(subtitle) {
    this.ui.showView('connecting');
    this.ui.setNegotiationStatus(subtitle);
    this.ui.setGlobalStatus('connecting', 'Connecting...');

    // Safeguard timeout (15s): show explanation if NAT/firewall blocks direct link
    this.clearConnectingTimeout();
    this.connectingTimer = setTimeout(() => {
      console.warn('[App] Connection negotiation taking longer than expected');
      this.ui.showConnectingTimeoutHelp(true);
    }, 12000);
  }

  clearConnectingTimeout() {
    if (this.connectingTimer) {
      clearTimeout(this.connectingTimer);
      this.connectingTimer = null;
    }
  }

  bindWebRTCEvents() {
    this.webrtc.on('connectionstatechange', (state) => {
      console.log('[App] RTCPeerConnection state:', state);
      if (state === 'connected') {
        this.clearConnectingTimeout();
        this.ui.setNegotiationStatus('P2P Connection Established');
      } else if (state === 'disconnected') {
        this.ui.setGlobalStatus('connecting', 'Reconnecting link...');
      } else if (state === 'failed') {
        this.clearConnectingTimeout();
        this.ui.setGlobalStatus('error', 'WebRTC Connection Failed');
        this.ui.showToast('Direct connection failed. Symmetric NAT/Firewall may require a TURN relay.');
        this.ui.showConnectingTimeoutHelp(true);
      } else if (state === 'closed') {
        this.clearConnectingTimeout();
        if (!this.isInitiator || !this.currentRoomCode) {
          this.ui.setGlobalStatus('idle', 'Ready');
        }
      }
    });

    this.webrtc.on('datachannel-open', () => {
      this.clearConnectingTimeout();
      console.log('[App] RTCDataChannel is open and ready for data transfer!');
      this.saveSession('connected');
      this.ui.showView('connected');
      this.ui.setGlobalStatus('connected', 'Connected');
      this.ui.showToast('Direct peer-to-peer connection established!');
      this.ui.showFileDropZone();
    });

    this.webrtc.on('datachannel-close', () => {
      console.log('[App] RTCDataChannel closed');
      if (!this.isInitiator || !this.currentRoomCode) {
        this.ui.setGlobalStatus('idle', 'DataChannel closed');
      }
    });

    this.webrtc.on('message', (data) => {
      // 1. Binary ArrayBuffer -> File Chunk
      if (data instanceof ArrayBuffer) {
        this.fileReceiver.handleChunk(data);
        return;
      }

      // 2. String -> JSON Control message (Metadata or Test Chat)
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          switch (msg.type) {
            case 'file-start':
              this.fileReceiver.handleMetadata(msg);
              break;
            case 'file-end':
              this.fileReceiver.handleEnd(msg);
              break;
            case 'file-cancel':
              this.fileReceiver.handleCancel(msg);
              this.fileSender.handleRemoteCancel();
              break;
            case 'file-pause':
              this.fileReceiver.handlePause();
              this.fileSender.handleRemotePause();
              break;
            case 'file-resume':
              this.fileReceiver.handleResume();
              this.fileSender.handleRemoteResume();
              break;
            case 'file-resume-request':
              if (this.fileSender.currentTransfer && this.fileSender.currentTransfer.id === msg.id) {
                this.fileSender.seekTo(msg.receivedBytes);
                this.webrtc.send(JSON.stringify({ type: 'file-resume-ack', id: msg.id }));
              }
              break;
            case 'chat':
              this.ui.renderChatMessage({
                id: msg.id,
                text: msg.text || msg.payload?.text,
                sender: 'received',
                timestamp: msg.timestamp
              });
              if (msg.id) {
                this.webrtc.send(JSON.stringify({ type: 'chat-ack', id: msg.id }));
              }
              this.ui.setTypingIndicator(false);
              break;
            case 'chat-ack':
              if (msg.id) {
                this.ui.updateMessageStatus(msg.id, 'delivered');
              }
              break;
            case 'chat-typing':
              this.ui.setTypingIndicator(Boolean(msg.isTyping));
              break;
            case 'chat-clear':
              this.ui.clearChatMessages();
              break;
            case 'test-text':
              this.ui.renderChatMessage({
                id: `m_${Date.now()}`,
                text: msg.payload?.text || msg.text,
                sender: 'received',
                timestamp: msg.payload?.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              });
              break;
            default:
              console.log('[App] Unhandled P2P message:', msg);
          }
        } catch (_) {
          this.ui.appendChatMessage(`Peer: ${data}`, 'received');
        }
      }
    });

    this.webrtc.on('error', (err) => {
      console.error('[App] WebRTC error:', err);
      this.ui.showToast(`WebRTC Error: ${err.message || err}`);
      this.ui.setGlobalStatus('error', 'WebRTC Error');
    });
  }

  async handleCreateRoom() {
    this.ui.setGlobalStatus('connecting', 'Creating room...');
    await this.signaling.connect();
    this.signaling.createRoom();
  }

  async handleJoinRoom() {
    const code = this.ui.joinInput?.value?.trim()?.toUpperCase();
    if (!code) {
      this.ui.showToast('Please enter a room code');
      return;
    }
    this.ui.setGlobalStatus('connecting', 'Joining room...');
    await this.signaling.connect();
    this.signaling.joinRoom(code);
  }

  handleDisconnect(toastMessage = null) {
    this.clearSession();
    this.clearConnectingTimeout();
    this.fileSender.cancel();
    this.fileReceiver.reset();
    this.webrtc.close();
    this.signaling.leaveRoom();
    this.currentRoomCode = null;
    this.isInitiator = false;
    this.webrtc.setIsInitiator(false);
    this.stagedFile = null;
    if (this.ui.joinInput) {
      this.ui.joinInput.value = '';
    }
    this.ui.showJoinBanner(false);
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
    this.ui.resetFileTransferUI();
    this.ui.showView('idle');
    this.ui.setGlobalStatus('idle', 'Ready');
    // Delay resetting room code display so it doesn't flash during card contraction
    setTimeout(() => {
      this.ui.setRoomCode('------');
    }, 250);
    if (toastMessage) {
      this.ui.showToast(toastMessage);
    }
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  new App();
});
