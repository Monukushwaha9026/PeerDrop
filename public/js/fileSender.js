// public/js/fileSender.js - Adaptive Dynamic Chunking, Backpressure, Streaming Checksums & Pause/Resume
import { SpeedTracker, crc32Update, formatChecksum, computeSha256, formatChunkTier } from './utils.js';

export class FileSender {
  constructor(initialChunkSize = 64 * 1024) {
    this.minChunkSize = 64 * 1024;      // 64 KB baseline
    this.midChunkSize = 128 * 1024;     // 128 KB turbo tier
    this.maxChunkSize = 256 * 1024;     // 256 KB ultra tier
    this.chunkSize = initialChunkSize;
    this.currentTransfer = null;
    this.speedTracker = new SpeedTracker();
    this.dataChannel = null;
    this.listeners = new Map();
    this.isPaused = false;
    this.pauseResolver = null;
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
          console.error(`[FileSender] Error in listener for ${event}:`, err);
        }
      }
    }
  }

  async sendFile(file, dataChannel) {
    if (!file) throw new Error('No file provided');
    if (!dataChannel || dataChannel.readyState !== 'open') {
      throw new Error('RTCDataChannel is not open');
    }

    this.dataChannel = dataChannel;
    this.speedTracker.reset();
    this.isPaused = false;
    this.pauseResolver = null;
    this.chunkSize = this.minChunkSize; // Start at 64 KB safe baseline

    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentTransfer = {
      id: fileId,
      file,
      cancelled: false,
      offset: 0,
      startTime: Date.now()
    };

    console.log(`[FileSender] Starting adaptive transfer: ${file.name} (${file.size} bytes)`);

    // 1. Send File Metadata (Control Message)
    const metadata = {
      type: 'file-start',
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
      supportsChecksum: true
    };
    dataChannel.send(JSON.stringify(metadata));
    this.emit('start', metadata);

    // 2. Stream File Chunks with Adaptive Chunk Sizing & Dynamic Backpressure
    let offset = this.currentTransfer.offset;
    const totalBytes = file.size;
    let runningCrc = 0;
    let fastDrainStreak = 0;

    const getWatermarks = (size) => {
      return {
        high: Math.max(512 * 1024, size * 4),
        low: Math.max(128 * 1024, size * 2)
      };
    };

    let { high: bufferHigh, low: bufferLow } = getWatermarks(this.chunkSize);
    dataChannel.bufferedAmountLowThreshold = bufferLow;

    const waitForBufferDrain = () => {
      const waitStart = performance.now();
      return new Promise((resolve) => {
        if (dataChannel.bufferedAmount <= bufferLow) {
          resolve(performance.now() - waitStart);
        } else {
          const onLow = () => {
            dataChannel.removeEventListener('bufferedamountlow', onLow);
            resolve(performance.now() - waitStart);
          };
          dataChannel.addEventListener('bufferedamountlow', onLow);
        }
      });
    };

    while (offset < totalBytes) {
      if (this.currentTransfer.cancelled) {
        console.log(`[FileSender] Transfer cancelled for ${file.name}`);
        this.emit('cancelled', { id: fileId });
        return;
      }

      // Check if paused
      if (this.isPaused) {
        await new Promise((resolve) => {
          this.pauseResolver = resolve;
        });
        if (this.currentTransfer.cancelled) return;
      }

      // Dynamic Backpressure Control
      if (dataChannel.bufferedAmount > bufferHigh) {
        const drainDurationMs = await waitForBufferDrain();

        // Adaptive Chunk Sizing Adjustment
        if (drainDurationMs < 35) {
          fastDrainStreak++;
          if (fastDrainStreak >= 2) {
            if (this.chunkSize === this.minChunkSize) {
              this.chunkSize = this.midChunkSize; // 64 KB -> 128 KB
            } else if (this.chunkSize === this.midChunkSize) {
              this.chunkSize = this.maxChunkSize; // 128 KB -> 256 KB
            }
            const updated = getWatermarks(this.chunkSize);
            bufferHigh = updated.high;
            bufferLow = updated.low;
            dataChannel.bufferedAmountLowThreshold = bufferLow;
            fastDrainStreak = 0;
          }
        } else if (drainDurationMs > 90) {
          // Congestion detected: throttle down chunk size
          fastDrainStreak = 0;
          if (this.chunkSize === this.maxChunkSize) {
            this.chunkSize = this.midChunkSize; // 256 KB -> 128 KB
          } else if (this.chunkSize === this.midChunkSize) {
            this.chunkSize = this.minChunkSize; // 128 KB -> 64 KB
          }
          const updated = getWatermarks(this.chunkSize);
          bufferHigh = updated.high;
          bufferLow = updated.low;
          dataChannel.bufferedAmountLowThreshold = bufferLow;
        }
      }

      const chunkSlice = file.slice(offset, offset + this.chunkSize);
      const arrayBuffer = await chunkSlice.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);

      // Incremental streaming CRC-32 update
      runningCrc = crc32Update(runningCrc, uint8);

      try {
        dataChannel.send(arrayBuffer);
      } catch (err) {
        console.error('[FileSender] Error sending chunk:', err);
        this.emit('error', err);
        throw err;
      }

      offset += arrayBuffer.byteLength;
      this.currentTransfer.offset = offset;

      const percent = totalBytes > 0 ? Math.min(100, Math.round((offset / totalBytes) * 100)) : 100;
      const stats = this.speedTracker.update(offset, totalBytes);
      const chunkTier = formatChunkTier(this.chunkSize);

      this.emit('progress', {
        id: fileId,
        bytesSent: offset,
        totalBytes,
        percent,
        speedFormatted: stats.speedFormatted,
        etaFormatted: stats.etaFormatted,
        chunkSize: this.chunkSize,
        chunkTier,
        isPaused: this.isPaused
      });

      // Brief microtask yield to keep browser event loop smooth
      if (offset % (this.chunkSize * 6) === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // 3. Compute Cryptographic Checksums (CRC-32 always, SHA-256 for files <= 100MB)
    const crc32Hex = formatChecksum(runningCrc);
    let sha256Hex = null;
    if (file.size <= 100 * 1024 * 1024) {
      try {
        const fullBuffer = await file.arrayBuffer();
        sha256Hex = await computeSha256(fullBuffer);
      } catch (e) {
        console.warn('[FileSender] Optional SHA-256 calculation skipped:', e);
      }
    }

    // 4. Send Completion Message with Checksums
    const endMsg = {
      type: 'file-end',
      id: fileId,
      crc32: crc32Hex,
      sha256: sha256Hex
    };
    dataChannel.send(JSON.stringify(endMsg));
    console.log(`[FileSender] Completed transfer for ${file.name} (CRC32: ${crc32Hex})`);

    this.emit('complete', {
      id: fileId,
      name: file.name,
      file,
      totalBytes,
      crc32: crc32Hex,
      sha256: sha256Hex
    });

    this.currentTransfer = null;
  }

  pause() {
    if (this.currentTransfer && !this.isPaused) {
      this.isPaused = true;
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        try {
          this.dataChannel.send(JSON.stringify({
            type: 'file-pause',
            id: this.currentTransfer.id
          }));
        } catch (_) {}
      }
      this.emit('pause', { id: this.currentTransfer.id });
    }
  }

  resume() {
    if (this.currentTransfer && this.isPaused) {
      this.isPaused = false;
      if (this.pauseResolver) {
        this.pauseResolver();
        this.pauseResolver = null;
      }
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        try {
          this.dataChannel.send(JSON.stringify({
            type: 'file-resume',
            id: this.currentTransfer.id
          }));
        } catch (_) {}
      }
      this.emit('resume', { id: this.currentTransfer.id });
    }
  }

  handleRemotePause() {
    if (this.currentTransfer && !this.isPaused) {
      this.isPaused = true;
      this.emit('pause', { id: this.currentTransfer.id, remote: true });
    }
  }

  handleRemoteResume() {
    if (this.currentTransfer && this.isPaused) {
      this.isPaused = false;
      if (this.pauseResolver) {
        this.pauseResolver();
        this.pauseResolver = null;
      }
      this.emit('resume', { id: this.currentTransfer.id, remote: true });
    }
  }

  seekTo(offset) {
    if (this.currentTransfer) {
      this.currentTransfer.offset = Math.min(offset, this.currentTransfer.file.size);
      console.log(`[FileSender] Resuming from offset ${this.currentTransfer.offset}`);
    }
  }

  cancel() {
    if (this.currentTransfer && !this.currentTransfer.cancelled) {
      this.currentTransfer.cancelled = true;
      if (this.pauseResolver) {
        this.pauseResolver();
        this.pauseResolver = null;
      }
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        try {
          this.dataChannel.send(JSON.stringify({
            type: 'file-cancel',
            id: this.currentTransfer.id
          }));
        } catch (_) {}
      }
      this.emit('cancelled', { id: this.currentTransfer.id });
      this.currentTransfer = null;
      this.isPaused = false;
    }
  }

  handleRemoteCancel() {
    if (this.currentTransfer) {
      this.currentTransfer.cancelled = true;
      if (this.pauseResolver) {
        this.pauseResolver();
        this.pauseResolver = null;
      }
      const id = this.currentTransfer.id;
      this.currentTransfer = null;
      this.isPaused = false;
      this.emit('cancelled', { id, remote: true });
    }
  }
}
