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
    this.btnCancelSender = document.getElementById('btn-cancel-sender');

    // Receiver Progress & Metrics
    this.receiverProgressCard = document.getElementById('receiver-progress-card');
    this.receiverPercentText = document.getElementById('receiver-percent-text');
    this.receiverFileName = document.getElementById('receiver-file-name');
    this.receiverTransferStats = document.getElementById('receiver-transfer-stats');
    this.receiverProgressBar = document.getElementById('receiver-progress-bar');
    this.receiverSpeed = document.getElementById('receiver-speed');
    this.receiverEta = document.getElementById('receiver-eta');
    this.btnCancelReceiver = document.getElementById('btn-cancel-receiver');

    // Completed Card
    this.fileCompletedCard = document.getElementById('file-completed-card');
    this.completedFileName = document.getElementById('completed-file-name');
    this.completedFileSize = document.getElementById('completed-file-size');
    this.btnDownloadFile = document.getElementById('btn-download-file');
    this.btnReceiveAnother = document.getElementById('btn-receive-another');

    this.checkBrowserSupport();
    this.setupCodeInputAutoFormat();
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

  appendChatMessage(message, sender = 'received') {
    if (!this.testChatLog) return;
    const item = document.createElement('div');
    item.className = `chat-item ${sender}`;

    const text = document.createElement('span');
    text.textContent = message;
    item.appendChild(text);

    this.testChatLog.appendChild(item);
    this.testChatLog.scrollTop = this.testChatLog.scrollHeight;
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
      this.senderProgressCard.style.display = 'block';
      this.senderProgressCard.classList.remove('card-emerge');
      void this.senderProgressCard.offsetWidth;
      this.senderProgressCard.classList.add('card-emerge');
    }
  }

  updateSenderProgress(bytesSent, totalBytes, percent, speedFormatted, etaFormatted) {
    if (!this.senderProgressCard) return;
    this.senderPercentText.textContent = `${percent}%`;
    this.senderProgressBar.style.width = `${percent}%`;
    this.senderTransferStats.textContent = `${formatBytes(bytesSent)} / ${formatBytes(totalBytes)}`;
    if (this.senderSpeed && speedFormatted) this.senderSpeed.textContent = speedFormatted;
    if (this.senderEta && etaFormatted) this.senderEta.textContent = etaFormatted;
  }

  showReceiverProgress(fileNameOrObj, totalBytes) {
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
      this.receiverProgressCard.style.display = 'block';
      this.receiverProgressCard.classList.remove('card-emerge');
      void this.receiverProgressCard.offsetWidth;
      this.receiverProgressCard.classList.add('card-emerge');
    }
  }

  updateReceiverProgress(bytesReceived, totalBytes, percent, speedFormatted, etaFormatted) {
    if (!this.receiverProgressCard) return;
    this.receiverPercentText.textContent = `${percent}%`;
    this.receiverProgressBar.style.width = `${percent}%`;
    this.receiverTransferStats.textContent = `${formatBytes(bytesReceived)} / ${formatBytes(totalBytes)}`;
    if (this.receiverSpeed && speedFormatted) this.receiverSpeed.textContent = speedFormatted;
    if (this.receiverEta && etaFormatted) this.receiverEta.textContent = etaFormatted;
  }

  showFileCompleted(fileInfo) {
    if (this.receiverProgressCard) this.receiverProgressCard.style.display = 'none';
    if (this.fileCompletedCard) {
      this.completedFileName.textContent = truncateFilename(fileInfo.name, 30);
      this.completedFileName.title = fileInfo.name;
      this.completedFileSize.textContent = formatBytes(fileInfo.size);
      
      this.btnDownloadFile.href = fileInfo.downloadUrl;
      this.btnDownloadFile.download = fileInfo.name;

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
