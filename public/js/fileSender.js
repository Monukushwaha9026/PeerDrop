// public/js/fileSender.js - File Chunking, Backpressure and Speed Tracking
import { SpeedTracker } from './utils.js';

export class FileSender {
  constructor(chunkSize = 64 * 1024) { // 64 KB chunks
    this.chunkSize = chunkSize;
    this.currentTransfer = null;
    this.speedTracker = new SpeedTracker();
    this.dataChannel = null;
    this.listeners = new Map();
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

    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentTransfer = {
      id: fileId,
      file,
      cancelled: false,
      startTime: Date.now()
    };

    console.log(`[FileSender] Starting transfer: ${file.name} (${file.size} bytes)`);

    // 1. Send File Metadata (Control Message)
    const metadata = {
      type: 'file-start',
      id: fileId,
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream'
    };
    dataChannel.send(JSON.stringify(metadata));
    this.emit('start', metadata);

    // 2. Stream File Chunks with Dynamic Backpressure
    let offset = 0;
    const totalBytes = file.size;

    // Buffer Watermarks for Backpressure Control
    const BUFFER_HIGH = 512 * 1024; // 512 KB High Watermark
    const BUFFER_LOW = 128 * 1024;  // 128 KB Low Watermark
    dataChannel.bufferedAmountLowThreshold = BUFFER_LOW;

    const waitForBufferDrain = () => {
      return new Promise((resolve) => {
        if (dataChannel.bufferedAmount <= BUFFER_LOW) {
          resolve();
        } else {
          const onLow = () => {
            dataChannel.removeEventListener('bufferedamountlow', onLow);
            resolve();
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

      // Check outgoing buffer backpressure
      if (dataChannel.bufferedAmount > BUFFER_HIGH) {
        await waitForBufferDrain();
      }

      const chunkSlice = file.slice(offset, offset + this.chunkSize);
      const arrayBuffer = await chunkSlice.arrayBuffer();

      try {
        dataChannel.send(arrayBuffer);
      } catch (err) {
        console.error('[FileSender] Error sending chunk:', err);
        this.emit('error', err);
        throw err;
      }

      offset += arrayBuffer.byteLength;
      const percent = totalBytes > 0 ? Math.min(100, Math.round((offset / totalBytes) * 100)) : 100;
      const stats = this.speedTracker.update(offset, totalBytes);

      this.emit('progress', {
        id: fileId,
        bytesSent: offset,
        totalBytes,
        percent,
        speedFormatted: stats.speedFormatted,
        etaFormatted: stats.etaFormatted
      });

      // Brief microtask yield to keep browser event loop responsive
      if (offset % (this.chunkSize * 8) === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // 3. Send Completion Message
    dataChannel.send(JSON.stringify({ type: 'file-end', id: fileId }));
    console.log(`[FileSender] Completed transfer for ${file.name}`);
    this.emit('complete', { id: fileId, name: file.name, file, totalBytes });
    this.currentTransfer = null;
  }

  cancel() {
    if (this.currentTransfer && !this.currentTransfer.cancelled) {
      this.currentTransfer.cancelled = true;
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
    }
  }

  handleRemoteCancel() {
    if (this.currentTransfer) {
      this.currentTransfer.cancelled = true;
      const id = this.currentTransfer.id;
      this.currentTransfer = null;
      this.emit('cancelled', { id, remote: true });
    }
  }
}
