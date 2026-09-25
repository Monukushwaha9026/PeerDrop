// public/js/ui.js - Apple-Inspired Liquid Glass UI Manager
import { formatBytes, truncateFilename } from './utils.js';

export class UIManager {
  constructor() {
    // Views
    this.mainCard = document.getElementById('main-card');
    this.views = {
      idle: document.getElementById('view-idle'),
      waiting: document.getElementById('view-waiting'),
      join: document.getElementById('view-join'),
      connecting: document.getElementById('view-connecting'),
      connected: document.getElementById('view-connected')
    };

    // Header Status Elements
    this.globalStatusDot = document.getElementById('global-status-dot');
    this.globalStatusText = document.getElementById('global-status-text');
    this.btnThemeToggle = document.getElementById('btn-theme-toggle');

    // Display Elements
    this.displayRoomCode = document.getElementById('display-room-code');
    this.connectedRoomCode = document.getElementById('connected-room-code');
    this.copyBtn = document.getElementById('btn-copy-code');
    this.copyText = document.getElementById('copy-text');
    this.copyLinkBtn = document.getElementById('btn-copy-link');
    this.copyLinkText = document.getElementById('copy-link-text');
    this.qrImage = document.getElementById('qr-code-image');
    this.toastContainer = document.getElementById('toast-container');
    this.testChatLog = document.getElementById('test-chat-log');
    this.negotiationStatus = document.getElementById('negotiation-status');
    this.timeoutHelpBox = document.getElementById('connecting-timeout-box');
    this.joinQrBanner = document.getElementById('join-qr-banner');
    this.unsupportedBanner = document.getElementById('unsupported-banner');

    // Form inputs
    this.joinInput = document.getElementById('input-room-code');

    // File Transfer Elements
    this.fileDropZone = document.getElementById('file-drop-zone');
    this.fileInput = document.getElementById('file-input');
    this.btnBrowseFile = document.getElementById('btn-browse-file');
    this.fileSelectedCard = document.getElementById('file-selected-card');
    this.selectedFileName = document.getElementById('selected-file-name');
    this.selectedFileSize = document.getElementById('selected-file-size');
    this.btnRemoveSelectedFile = document.getElementById('btn-remove-selected-file');
    this.btnSendFile = document.getElementById('btn-send-file');

    // Sender Progress & Metrics
    this.senderProgressCard = document.getElementById('sender-progress-card');
    this.senderPercentText = document.getElementById('sender-percent-text');
    this.senderFileName = document.getElementById('sender-file-name');
    this.senderTransferStats = document.getElementById('sender-transfer-stats');
    this.senderProgressBar = document.getElementById('sender-progress-bar');
    this.senderSpeed = document.getElementById('sender-speed');
    this.senderEta = document.getElementById('sender-eta');
    this.senderBadge = document.getElementById('sender-badge');
    this.senderTierBadge = document.getElementById('sender-tier-badge');
    this.btnCancelSender = document.getElementById('btn-cancel-sender');
    this.btnPauseSender = document.getElementById('btn-pause-sender');

    // Receiver Progress & Metrics
    this.receiverProgressCard = document.getElementById('receiver-progress-card');
    this.receiverPercentText = document.getElementById('receiver-percent-text');
    this.receiverFileName = document.getElementById('receiver-file-name');
    this.receiverTransferStats = document.getElementById('receiver-transfer-stats');
    this.receiverProgressBar = document.getElementById('receiver-progress-bar');
    this.receiverSpeed = document.getElementById('receiver-speed');
    this.receiverEta = document.getElementById('receiver-eta');
    this.receiverBadge = document.getElementById('receiver-badge');
    this.receiverStreamBadge = document.getElementById('receiver-stream-badge');
    this.btnCancelReceiver = document.getElementById('btn-cancel-receiver');
    this.btnPauseReceiver = document.getElementById('btn-pause-receiver');

    // Completed Card & Integrity
    this.fileCompletedCard = document.getElementById('file-completed-card');
    this.completedFileName = document.getElementById('completed-file-name');
    this.completedFileSize = document.getElementById('completed-file-size');
    this.btnDownloadFile = document.getElementById('btn-download-file');
    this.btnReceiveAnother = document.getElementById('btn-receive-another');
    this.integrityBadge = document.getElementById('integrity-badge');
    this.integrityText = document.getElementById('integrity-text');
    this.integrityHash = document.getElementById('integrity-hash');

    // Direct Disk Streaming Controls
    this.directStreamBanner = document.getElementById('direct-stream-banner');
    this.toggleDirectStream = document.getElementById('toggle-direct-stream');
    this.supportsDirectStream = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
    if (this.toggleDirectStream) {
      this.toggleDirectStream.checked = this.supportsDirectStream;
    }
    if (!this.supportsDirectStream && this.directStreamBanner) {
      this.directStreamBanner.style.opacity = '0.6';
      const sub = this.directStreamBanner.querySelector('.stream-subtext');
      if (sub) sub.textContent = 'Browser memory fallback mode';
    }

    // App Container & Mobile Segmented Tabs
    this.appContainer = document.querySelector('.app-container');
    this.tabBtnFiles = document.getElementById('tab-btn-files');
    this.tabBtnChat = document.getElementById('tab-btn-chat');
    this.paneFiles = document.getElementById('pane-files');
    this.paneChat = document.getElementById('pane-chat');
    this.chatUnreadBadge = document.getElementById('chat-unread-badge');
    this.activeMobileTab = 'files';
    this.unreadCount = 0;

    // Chat Interactive Elements
    this.testMsgInput = document.getElementById('test-msg-input');
    this.btnSendTest = document.getElementById('btn-send-test');
    this.btnClearChat = document.getElementById('btn-clear-chat');
    this.typingIndicator = document.getElementById('typing-indicator');
    this.btnScrollBottom = document.getElementById('btn-scroll-bottom');
    this.quickChips = document.querySelectorAll('.quick-chip');

    this.checkBrowserSupport();
    this.setupCodeInputAutoFormat();
    this.setupChatUI();
  }

  checkBrowserSupport() {
    const supported = typeof window !== 'undefined' && 
      'RTCPeerConnection' in window && 
      'WebSocket' in window &&
      'Blob' in window;

    if (!supported && this.unsupportedBanner) {
      this.unsupportedBanner.style.display = 'block';
      this.setGlobalStatus('error', 'Browser Unsupported');
    }
    return supported;
  }

  showView(viewName) {
    const mainCard = this.mainCard;
    const targetView = this.views[viewName];
    if (!targetView) return;

    let currentView = null;
    for (const key in this.views) {
      if (this.views[key]?.classList.contains('active')) {
        currentView = this.views[key];
        break;
      }
    }

    const prefersReducedMotion = typeof window !== 'undefined' && 
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Fast path: initial load, same view, or reduced motion
    if (!currentView || currentView === targetView || prefersReducedMotion || !mainCard) {
      this._applyViewClasses(viewName);
      if (viewName !== 'connecting') {
        this.showConnectingTimeoutHelp(false);
      }
      return;
    }

    // Smooth iOS card height adaptation
    const prevHeight = mainCard.offsetHeight;
    mainCard.style.height = `${prevHeight}px`;

    this._applyViewClasses(viewName);

    // Accurately measure target view height including card padding and borders
    const cardStyle = window.getComputedStyle(mainCard);
    const extra = (parseFloat(cardStyle.paddingTop) || 0) +
                  (parseFloat(cardStyle.paddingBottom) || 0) +
                  (parseFloat(cardStyle.borderTopWidth) || 0) +
                  (parseFloat(cardStyle.borderBottomWidth) || 0);
    const targetHeight = Math.ceil((targetView.offsetHeight || targetView.scrollHeight) + extra);

    requestAnimationFrame(() => {
      mainCard.style.height = `${targetHeight}px`;

      const onTransitionEnd = (e) => {
        if (e.target === mainCard && e.propertyName === 'height') {
          mainCard.style.height = '';
          mainCard.removeEventListener('transitionend', onTransitionEnd);
        }
      };
      mainCard.addEventListener('transitionend', onTransitionEnd);

      setTimeout(() => {
        if (mainCard.style.height) {
          mainCard.style.height = '';
        }
      }, 420);
    });

    if (viewName !== 'connecting') {
      this.showConnectingTimeoutHelp(false);
    }
  }

  _applyViewClasses(viewName) {
    Object.keys(this.views).forEach((key) => {
      const el = this.views[key];
      if (el) {
        if (key === viewName) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    });
    this.setConnectedMode(viewName === 'connected');
  }

  setConnectedMode(isConnected) {
    if (this.appContainer) {
      if (isConnected) {
        this.appContainer.classList.add('is-connected');
      } else {
        this.appContainer.classList.remove('is-connected');
        this.setMobileTab('files');
        this.updateUnreadCount(0);
      }
    }
  }

  setGlobalStatus(state, text) {
    this.globalStatusDot.className = 'status-indicator-dot';
    if (state === 'connected') {
      this.globalStatusDot.classList.add('connected');
      this.globalStatusDot.classList.add('status-bloom');
      setTimeout(() => this.globalStatusDot?.classList.remove('status-bloom'), 800);

      const canvas = document.querySelector('.liquid-canvas');
      if (canvas) {
        canvas.classList.add('connected-response');
        setTimeout(() => canvas.classList.remove('connected-response'), 1400);
      }
    } else if (state === 'waiting' || state === 'connecting') {
      this.globalStatusDot.classList.add('waiting');
    } else if (state === 'error') {
      this.globalStatusDot.classList.add('error');
    }
    this.globalStatusText.textContent = text;
  }

  setNegotiationStatus(text) {
    if (this.negotiationStatus) {
      this.negotiationStatus.textContent = text;
    }
  }

  setRoomCode(code) {
    if (this.displayRoomCode) this.displayRoomCode.textContent = code;
    if (this.connectedRoomCode) this.connectedRoomCode.textContent = code;

    // Load vector SVG QR code from server
    if (this.qrImage && code && code !== '------') {
      this.qrImage.src = `/api/qr/${encodeURIComponent(code)}`;
    }
  }

  showJoinBanner(show = true) {
    if (this.joinQrBanner) {
      this.joinQrBanner.style.display = show ? 'block' : 'none';
    }
  }

  showConnectingTimeoutHelp(show = true) {
    if (this.timeoutHelpBox) {
      this.timeoutHelpBox.style.display = show ? 'block' : 'none';
    }
  }

  setupCodeInputAutoFormat() {
    if (!this.joinInput) return;

    this.joinInput.addEventListener('input', (e) => {
      let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (val.length > 4) {
        val = val.slice(0, 4) + '-' + val.slice(4, 6);
      }
      e.target.value = val;
    });
  }

  showToast(message, duration = 3000) {
    if (!this.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px) scale(0.96)';
      toast.style.transition = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  setupCopyButton(codeGetter) {
    if (!this.copyBtn) return;
    this.copyBtn.addEventListener('click', async () => {
      const code = codeGetter();
      if (!code || code === '------') return;

      try {
        await navigator.clipboard.writeText(code);
        this.copyText.textContent = 'Copied!';
        this.showToast(`Room code ${code} copied to clipboard`);
        setTimeout(() => {
          this.copyText.textContent = 'Copy Code';
        }, 2000);
      } catch (err) {
        this.showToast('Could not auto-copy code.');
      }
    });

    if (this.copyLinkBtn) {
      this.copyLinkBtn.addEventListener('click', async () => {
        const code = codeGetter();
        if (!code || code === '------') return;

        const joinUrl = `${window.location.origin}/join/${code}`;
        try {
          await navigator.clipboard.writeText(joinUrl);
          this.copyLinkText.textContent = 'Link Copied!';
          this.showToast('Direct pairing link copied');
          setTimeout(() => {
            this.copyLinkText.textContent = 'Copy Link';
          }, 2000);
        } catch (err) {
          this.showToast('Could not auto-copy link.');
        }
      });
    }
  }

  setupChatUI() {
    // Mobile tab buttons
    this.tabBtnFiles?.addEventListener('click', () => this.setMobileTab('files'));
    this.tabBtnChat?.addEventListener('click', () => this.setMobileTab('chat'));

    // Clear chat button
    this.btnClearChat?.addEventListener('click', () => this.clearChatMessages());

    // Scroll to bottom button
    this.btnScrollBottom?.addEventListener('click', () => {
      if (this.testChatLog) {
        this.testChatLog.scrollTop = this.testChatLog.scrollHeight;
        this.btnScrollBottom.style.display = 'none';
      }
    });

    // Detect user scroll inside testChatLog to show/hide scroll-to-bottom button
    this.testChatLog?.addEventListener('scroll', () => {
      const isNearBottom = this.testChatLog.scrollHeight - this.testChatLog.scrollTop - this.testChatLog.clientHeight < 60;
      if (isNearBottom && this.btnScrollBottom) {
        this.btnScrollBottom.style.display = 'none';
      }
    });

    // Auto-resize textarea
    this.testMsgInput?.addEventListener('input', () => {
      this.testMsgInput.style.height = 'auto';
      this.testMsgInput.style.height = `${Math.min(this.testMsgInput.scrollHeight, 80)}px`;
    });
  }

  setMobileTab(tab) {
    if (tab === 'files') {
      this.tabBtnFiles?.classList.add('active');
      this.tabBtnChat?.classList.remove('active');
      this.paneFiles?.classList.add('active');
      this.paneChat?.classList.remove('active');
      this.activeMobileTab = 'files';
    } else if (tab === 'chat') {
      this.tabBtnFiles?.classList.remove('active');
      this.tabBtnChat?.classList.add('active');
      this.paneFiles?.classList.remove('active');
      this.paneChat?.classList.add('active');
      this.activeMobileTab = 'chat';
      this.updateUnreadCount(0);
      if (this.testChatLog) {
        this.testChatLog.scrollTop = this.testChatLog.scrollHeight;
      }
    }
  }

  updateUnreadCount(count) {
    this.unreadCount = Math.max(0, count);
    if (!this.chatUnreadBadge) return;
    if (this.unreadCount > 0) {
      this.chatUnreadBadge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
      this.chatUnreadBadge.style.display = 'inline-block';
    } else {
      this.chatUnreadBadge.style.display = 'none';
    }
  }

  incrementUnreadCount() {
    if (this.activeMobileTab !== 'chat') {
      this.updateUnreadCount(this.unreadCount + 1);
    }
  }

  linkifyText(text) {
    const div = document.createElement('div');
    div.textContent = text;
    const escaped = div.innerHTML;
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    return escaped.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-link">$1</a>');
  }

  renderChatMessage({ id, text, sender = 'received', timestamp, status = 'sent' }) {
    if (!this.testChatLog) return;
    
    // Auto-scroll check before appending
    const isNearBottom = this.testChatLog.scrollHeight - this.testChatLog.scrollTop - this.testChatLog.clientHeight < 70;

    const group = document.createElement('div');
    group.className = `chat-bubble-group ${sender}`;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${sender}`;
    if (id) bubble.setAttribute('data-msg-id', id);

    const content = document.createElement('div');
    content.className = 'bubble-content';
    content.innerHTML = this.linkifyText(text);
    bubble.appendChild(content);

    const meta = document.createElement('div');
    meta.className = 'bubble-meta';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'bubble-time';
    timeSpan.textContent = timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    meta.appendChild(timeSpan);

    if (sender === 'sent') {
      const statusSpan = document.createElement('span');
      statusSpan.className = 'bubble-status';
      if (id) statusSpan.id = `status-${id}`;
      statusSpan.textContent = status === 'delivered' ? '✓✓' : '✓';
      if (status === 'delivered') statusSpan.style.color = '#34c759';
      meta.appendChild(statusSpan);
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-copy-bubble';
    copyBtn.title = 'Copy message';
    copyBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyMessageText(text, copyBtn);
    });
    meta.appendChild(copyBtn);

    bubble.appendChild(meta);
    group.appendChild(bubble);
    this.testChatLog.appendChild(group);

    if (sender === 'received') {
      this.incrementUnreadCount();
    }

    if (isNearBottom || sender === 'sent') {
      this.testChatLog.scrollTop = this.testChatLog.scrollHeight;
      if (this.btnScrollBottom) this.btnScrollBottom.style.display = 'none';
    } else if (this.btnScrollBottom) {
      this.btnScrollBottom.style.display = 'inline-flex';
    }
  }

  async copyMessageText(text, btnElement) {
    try {
      await navigator.clipboard.writeText(text);
      if (btnElement) {
        btnElement.classList.add('copied');
        btnElement.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
          btnElement.classList.remove('copied');
          btnElement.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        }, 1500);
      }
      this.showToast('Copied to clipboard');
    } catch (_) {
      this.showToast('Could not copy message');
    }
  }

  updateMessageStatus(id, status) {
    const el = document.getElementById(`status-${id}`);
    if (el) {
      el.textContent = status === 'delivered' ? '✓✓' : '✓';
      if (status === 'delivered') {
        el.style.color = '#34c759';
      }
    }
  }

  setTypingIndicator(isTyping) {
    if (!this.typingIndicator) return;
    this.typingIndicator.style.display = isTyping ? 'flex' : 'none';
    if (isTyping && this.testChatLog) {
      const isNearBottom = this.testChatLog.scrollHeight - this.testChatLog.scrollTop - this.testChatLog.clientHeight < 70;
      if (isNearBottom) {
        this.testChatLog.scrollTop = this.testChatLog.scrollHeight;
      }
    }
  }

  clearChatMessages() {
    if (!this.testChatLog) return;
    const systemItems = this.testChatLog.querySelectorAll('.chat-system-item');
    this.testChatLog.innerHTML = '';
    systemItems.forEach(item => this.testChatLog.appendChild(item));
    this.showToast('Chat history cleared');
  }

  appendChatMessage(message, sender = 'received') {
    const cleanText = message.replace(/^(You|Peer):\s*/, '');
    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.renderChatMessage({
      id,
      text: cleanText,
      sender,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent'
    });
  }

  // ==========================================
  // File Transfer UI Handlers
  // ==========================================

  showFileDropZone() {
    if (this.fileDropZone) this.fileDropZone.style.display = 'block';
    if (this.fileSelectedCard) this.fileSelectedCard.style.display = 'none';
    if (this.senderProgressCard) this.senderProgressCard.style.display = 'none';
    if (this.receiverProgressCard) this.receiverProgressCard.style.display = 'none';
    if (this.fileCompletedCard) this.fileCompletedCard.style.display = 'none';
    if (this.fileInput) this.fileInput.value = '';
  }

  showSelectedFile(file) {
    if (this.fileDropZone) this.fileDropZone.style.display = 'none';
    if (this.fileSelectedCard) {
      this.selectedFileName.textContent = truncateFilename(file.name, 28);
      this.selectedFileName.title = file.name;
      this.selectedFileSize.textContent = formatBytes(file.size);
      this.fileSelectedCard.style.display = 'block';
      this.fileSelectedCard.classList.remove('card-emerge');
      void this.fileSelectedCard.offsetWidth;
      this.fileSelectedCard.classList.add('card-emerge');
    }
  }

  showSenderProgress(fileNameOrObj, totalBytes) {
    const name = typeof fileNameOrObj === 'object' && fileNameOrObj !== null 
      ? (fileNameOrObj.name || 'File') 
      : (fileNameOrObj || 'File');
    const bytes = typeof fileNameOrObj === 'object' && fileNameOrObj !== null 
      ? (fileNameOrObj.size || totalBytes || 0) 
      : (totalBytes || 0);

    if (this.fileSelectedCard) this.fileSelectedCard.style.display = 'none';
    if (this.senderProgressCard) {
      this.senderFileName.textContent = truncateFilename(name, 28);
      this.senderPercentText.textContent = '0%';
      this.senderProgressBar.style.width = '0%';
      this.senderTransferStats.textContent = `0 B / ${formatBytes(bytes)}`;
      if (this.senderSpeed) this.senderSpeed.textContent = '--';
      if (this.senderEta) this.senderEta.textContent = '--';
      if (this.senderBadge) this.senderBadge.textContent = 'Sending';
      if (this.senderTierBadge) this.senderTierBadge.textContent = '64 KB Base';
      if (this.btnPauseSender) {
        this.btnPauseSender.textContent = 'Pause';
        this.btnPauseSender.classList.remove('paused');
      }
      this.senderProgressCard.style.display = 'block';
      this.senderProgressCard.classList.remove('card-emerge');
      void this.senderProgressCard.offsetWidth;
      this.senderProgressCard.classList.add('card-emerge');
    }
  }

  updateSenderProgress(bytesSent, totalBytes, percent, speedFormatted, etaFormatted, chunkTier = null, isPaused = false) {
    if (!this.senderProgressCard) return;
    this.senderPercentText.textContent = `${percent}%`;
    this.senderProgressBar.style.width = `${percent}%`;
    this.senderTransferStats.textContent = `${formatBytes(bytesSent)} / ${formatBytes(totalBytes)}`;
    if (this.senderSpeed && speedFormatted) this.senderSpeed.textContent = speedFormatted;
    if (this.senderEta && etaFormatted) this.senderEta.textContent = etaFormatted;
    if (chunkTier && this.senderTierBadge) this.senderTierBadge.textContent = chunkTier;

    if (this.btnPauseSender && this.senderBadge) {
      if (isPaused) {
        this.senderBadge.textContent = 'Paused';
        this.btnPauseSender.textContent = 'Resume';
        this.btnPauseSender.classList.add('paused');
      } else {
        this.senderBadge.textContent = 'Sending';
        this.btnPauseSender.textContent = 'Pause';
        this.btnPauseSender.classList.remove('paused');
      }
    }
  }

  showReceiverProgress(fileNameOrObj, totalBytes, isDirectStream = false) {
    const name = typeof fileNameOrObj === 'object' && fileNameOrObj !== null 
      ? (fileNameOrObj.name || 'File') 
      : (fileNameOrObj || 'File');
    const bytes = typeof fileNameOrObj === 'object' && fileNameOrObj !== null 
      ? (fileNameOrObj.size || totalBytes || 0) 
      : (totalBytes || 0);

    if (this.fileDropZone) this.fileDropZone.style.display = 'none';
    if (this.receiverProgressCard) {
      this.receiverFileName.textContent = truncateFilename(name, 28);
      this.receiverPercentText.textContent = '0%';
      this.receiverProgressBar.style.width = '0%';
      this.receiverTransferStats.textContent = `0 B / ${formatBytes(bytes)}`;
      if (this.receiverSpeed) this.receiverSpeed.textContent = '--';
      if (this.receiverEta) this.receiverEta.textContent = '--';
      if (this.receiverBadge) this.receiverBadge.textContent = 'Receiving';
      if (this.receiverStreamBadge) {
        this.receiverStreamBadge.style.display = isDirectStream ? 'inline-block' : 'none';
      }
      if (this.btnPauseReceiver) {
        this.btnPauseReceiver.textContent = 'Pause';
        this.btnPauseReceiver.classList.remove('paused');
      }
      this.receiverProgressCard.style.display = 'block';
      this.receiverProgressCard.classList.remove('card-emerge');
      void this.receiverProgressCard.offsetWidth;
      this.receiverProgressCard.classList.add('card-emerge');
    }
  }

  updateReceiverProgress(bytesReceived, totalBytes, percent, speedFormatted, etaFormatted, isDirectStream = false, isPaused = false) {
    if (!this.receiverProgressCard) return;
    this.receiverPercentText.textContent = `${percent}%`;
    this.receiverProgressBar.style.width = `${percent}%`;
    this.receiverTransferStats.textContent = `${formatBytes(bytesReceived)} / ${formatBytes(totalBytes)}`;
    if (this.receiverSpeed && speedFormatted) this.receiverSpeed.textContent = speedFormatted;
    if (this.receiverEta && etaFormatted) this.receiverEta.textContent = etaFormatted;
    if (this.receiverStreamBadge && isDirectStream) {
      this.receiverStreamBadge.style.display = 'inline-block';
    }

    if (this.btnPauseReceiver && this.receiverBadge) {
      if (isPaused) {
        this.receiverBadge.textContent = 'Paused';
        this.btnPauseReceiver.textContent = 'Resume';
        this.btnPauseReceiver.classList.add('paused');
      } else {
        this.receiverBadge.textContent = 'Receiving';
        this.btnPauseReceiver.textContent = 'Pause';
        this.btnPauseReceiver.classList.remove('paused');
      }
    }
  }

  showFileCompleted(fileInfo) {
    if (this.receiverProgressCard) this.receiverProgressCard.style.display = 'none';
    if (this.fileCompletedCard) {
      this.completedFileName.textContent = truncateFilename(fileInfo.name, 30);
      this.completedFileName.title = fileInfo.name;
      this.completedFileSize.textContent = formatBytes(fileInfo.size);

      // Cryptographic Integrity Badge
      if (this.integrityBadge) {
        this.integrityBadge.style.display = 'inline-flex';
        const hashStr = fileInfo.crc32 ? `CRC32: ${fileInfo.crc32}` : '';
        if (this.integrityHash) this.integrityHash.textContent = hashStr;
        if (this.integrityText) {
          if (fileInfo.checksumVerified !== false) {
            this.integrityText.textContent = 'Verified Bit-for-Bit';
            this.integrityBadge.style.color = 'var(--status-green)';
            this.integrityBadge.style.borderColor = 'rgba(52, 199, 89, 0.28)';
          } else {
            this.integrityText.textContent = 'Integrity Mismatch!';
            this.integrityBadge.style.color = '#ff3b30';
            this.integrityBadge.style.borderColor = 'rgba(255, 59, 48, 0.35)';
          }
        }
      }

      if (fileInfo.isDirectStream) {
        // Direct-to-Disk mode: file already saved to disk
        const titleEl = this.fileCompletedCard.querySelector('.completed-title');
        if (titleEl) titleEl.textContent = 'Saved Directly to Disk ✓';
        this.btnDownloadFile.style.display = 'none';
      } else {
        const titleEl = this.fileCompletedCard.querySelector('.completed-title');
        if (titleEl) titleEl.textContent = 'File Ready to Download';
        this.btnDownloadFile.style.display = 'inline-flex';
        this.btnDownloadFile.href = fileInfo.downloadUrl;
        this.btnDownloadFile.download = fileInfo.name;
      }

      this.fileCompletedCard.style.display = 'block';
      this.fileCompletedCard.classList.remove('card-emerge');
      void this.fileCompletedCard.offsetWidth;
      this.fileCompletedCard.classList.add('card-emerge');

      const iconWrapper = this.fileCompletedCard.querySelector('.completed-icon-wrapper');
      if (iconWrapper) {
        iconWrapper.classList.remove('completed-pop');
        void iconWrapper.offsetWidth;
        iconWrapper.classList.add('completed-pop');
      }
    }
  }

  resetFileTransferUI() {
    this.showFileDropZone();
  }

  // Theme Management (Light / Dark Liquid Glass)
  initTheme() {
    const saved = localStorage.getItem('peerdrop-theme');
    const initialTheme = saved === 'dark' ? 'dark' : 'light';
    this.setTheme(initialTheme);

    this.btnThemeToggle?.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const next = current === 'dark' ? 'light' : 'dark';
      this.setTheme(next);
    });
  }

  setTheme(theme) {
    document.documentElement.classList.add('theme-switching');
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('peerdrop-theme', theme);
    if (this.btnThemeToggle) {
      const label = 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode';
      this.btnThemeToggle.setAttribute('aria-label', label);
      this.btnThemeToggle.setAttribute('title', label);
    }
    setTimeout(() => {
      document.documentElement.classList.remove('theme-switching');
    }, 650);
  }
}
