// public/js/fileReceiver.js - File Chunk Reassembly, Speed Tracking, and Cancellation
import { SpeedTracker } from './utils.js';

export class FileReceiver {
  constructor() {
    this.currentFile = null;
    this.speedTracker = new SpeedTracker();
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
          console.error(`[FileReceiver] Error in listener for ${event}:`, err);
        }
      }
    }
  }

  handleMetadata(metadata) {
    console.log('[FileReceiver] Starting file reception:', metadata);
    this.reset();
    this.speedTracker.reset();

    this.currentFile = {
      id: metadata.id,
      name: metadata.name,
      size: metadata.size,
      mimeType: metadata.mimeType || 'application/octet-stream',
      receivedBytes: 0,
      chunks: [],
      startTime: Date.now()
    };

    this.emit('start', this.currentFile);
  }

  handleChunk(arrayBuffer) {
    if (!this.currentFile) {
      console.warn('[FileReceiver] Received chunk without active metadata');
      return;
    }

    this.currentFile.chunks.push(arrayBuffer);
    this.currentFile.receivedBytes += arrayBuffer.byteLength;

    const totalBytes = this.currentFile.size;
    const percent = totalBytes > 0 
      ? Math.min(100, Math.round((this.currentFile.receivedBytes / totalBytes) * 100))
      : 100;

    const stats = this.speedTracker.update(this.currentFile.receivedBytes, totalBytes);

    this.emit('progress', {
      id: this.currentFile.id,
      bytesReceived: this.currentFile.receivedBytes,
      totalBytes,
      percent,
      speedFormatted: stats.speedFormatted,
      etaFormatted: stats.etaFormatted
    });
  }

  handleEnd(endMsg) {
    if (!this.currentFile) return;

    console.log(`[FileReceiver] Reassembling file: ${this.currentFile.name} (${this.currentFile.receivedBytes} bytes)`);

    try {
      const blob = new Blob(this.currentFile.chunks, { type: this.currentFile.mimeType });
      const downloadUrl = URL.createObjectURL(blob);

      const fileInfo = {
        id: this.currentFile.id,
        name: this.currentFile.name,
        size: this.currentFile.size,
        receivedBytes: this.currentFile.receivedBytes,
        mimeType: this.currentFile.mimeType,
        blob,
        downloadUrl
      };

      // Clear chunk buffer to free memory
      this.currentFile.chunks = [];

      this.emit('complete', fileInfo);
    } catch (err) {
      console.error('[FileReceiver] Error reconstructing Blob:', err);
      this.emit('error', err);
    }
  }

  cancel(dataChannel) {
    if (!this.currentFile) return;
    const id = this.currentFile.id;
    console.log(`[FileReceiver] Cancelling incoming transfer for ${this.currentFile.name}`);

    if (dataChannel && dataChannel.readyState === 'open') {
      try {
        dataChannel.send(JSON.stringify({ type: 'file-cancel', id }));
      } catch (_) {}
    }

    this.reset();
    this.emit('cancelled', { id, initiator: true });
  }

  handleCancel(cancelMsg) {
    if (!this.currentFile) return;
    console.log(`[FileReceiver] Transfer was cancelled remotely for ${this.currentFile.name}`);
    const id = this.currentFile.id;
    this.reset();
    this.emit('cancelled', { id, initiator: false });
  }

  reset() {
    if (this.currentFile) {
      this.currentFile.chunks = [];
      if (this.currentFile.downloadUrl) {
        URL.revokeObjectURL(this.currentFile.downloadUrl);
      }
    }
    this.currentFile = null;
  }
}
