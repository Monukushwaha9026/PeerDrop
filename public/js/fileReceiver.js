// public/js/fileReceiver.js - File Chunk Reassembly, Direct-to-Disk Streaming, Checksums & Pause/Resume
import { SpeedTracker, crc32Update, formatChecksum, computeSha256 } from './utils.js';

export class FileReceiver {
  constructor() {
    this.currentFile = null;
    this.speedTracker = new SpeedTracker();
    this.listeners = new Map();
    this.directStreamWritable = null;
    this.isPaused = false;
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

  setDirectStreamWritable(writableStream) {
    this.directStreamWritable = writableStream;
  }

  handleMetadata(metadata) {
    console.log('[FileReceiver] Starting file reception:', metadata);
    this.reset();
    this.speedTracker.reset();
    this.isPaused = false;

    this.currentFile = {
      id: metadata.id,
      name: metadata.name,
      size: metadata.size,
      mimeType: metadata.mimeType || 'application/octet-stream',
      receivedBytes: 0,
      chunks: [],
      runningCrc: 0,
      writableStream: this.directStreamWritable,
      isDirectStream: Boolean(this.directStreamWritable),
      startTime: Date.now()
    };

    this.emit('start', this.currentFile);
  }

  async handleChunk(arrayBuffer) {
    if (!this.currentFile) {
      console.warn('[FileReceiver] Received chunk without active metadata');
      return;
    }

    const uint8 = new Uint8Array(arrayBuffer);
    this.currentFile.runningCrc = crc32Update(this.currentFile.runningCrc, uint8);
    this.currentFile.receivedBytes += arrayBuffer.byteLength;

    if (this.currentFile.isDirectStream && this.currentFile.writableStream) {
      // Direct-to-Disk: Pipe directly to disk, free RAM immediately
      try {
        await this.currentFile.writableStream.write(arrayBuffer);
      } catch (err) {
        console.error('[FileReceiver] Error writing direct stream chunk:', err);
      }
    } else {
      // Memory Fallback: Accumulate chunks for Blob creation
      this.currentFile.chunks.push(arrayBuffer);
    }

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
      etaFormatted: stats.etaFormatted,
      isDirectStream: this.currentFile.isDirectStream,
      isPaused: this.isPaused
    });
  }

  async handleEnd(endMsg) {
    if (!this.currentFile) return;

    console.log(`[FileReceiver] Reassembling file: ${this.currentFile.name} (${this.currentFile.receivedBytes} bytes)`);

    const calculatedCrc = formatChecksum(this.currentFile.runningCrc);
    const expectedCrc = endMsg.crc32 ? formatChecksum(endMsg.crc32) : null;
    let checksumVerified = false;

    if (expectedCrc) {
      checksumVerified = (calculatedCrc === expectedCrc);
      console.log(`[FileReceiver] Checksum check: calculated=${calculatedCrc}, expected=${expectedCrc}, match=${checksumVerified}`);
    }

    try {
      let blob = null;
      let downloadUrl = null;
      let calculatedSha256 = null;

      if (this.currentFile.isDirectStream && this.currentFile.writableStream) {
        // Direct stream completed: close the disk writable stream
        try {
          await this.currentFile.writableStream.close();
          console.log('[FileReceiver] Direct-to-Disk stream closed successfully');
        } catch (err) {
          console.error('[FileReceiver] Error closing disk stream:', err);
        }
      } else {
        // Blob reconstruction
        blob = new Blob(this.currentFile.chunks, { type: this.currentFile.mimeType });
        downloadUrl = URL.createObjectURL(blob);

        // Calculate SHA-256 for verification if provided
        if (endMsg.sha256 && this.currentFile.size <= 100 * 1024 * 1024) {
          try {
            const buf = await blob.arrayBuffer();
            calculatedSha256 = await computeSha256(buf);
            if (calculatedSha256 && endMsg.sha256) {
              checksumVerified = checksumVerified && (calculatedSha256.toLowerCase() === endMsg.sha256.toLowerCase());
            }
          } catch (_) {}
        }
      }

      const fileInfo = {
        id: this.currentFile.id,
        name: this.currentFile.name,
        size: this.currentFile.size,
        receivedBytes: this.currentFile.receivedBytes,
        mimeType: this.currentFile.mimeType,
        blob,
        downloadUrl,
        isDirectStream: this.currentFile.isDirectStream,
        crc32: calculatedCrc,
        sha256: calculatedSha256 || endMsg.sha256,
        checksumVerified: expectedCrc ? checksumVerified : true
      };

      // Clear memory buffer
      this.currentFile.chunks = [];
      this.directStreamWritable = null;

      this.emit('complete', fileInfo);
    } catch (err) {
      console.error('[FileReceiver] Error finishing file reception:', err);
      this.emit('error', err);
    }
  }

  pause(dataChannel) {
    if (this.currentFile && !this.isPaused) {
      this.isPaused = true;
      if (dataChannel && dataChannel.readyState === 'open') {
        try {
          dataChannel.send(JSON.stringify({
            type: 'file-pause',
            id: this.currentFile.id
          }));
        } catch (_) {}
      }
      this.emit('pause', { id: this.currentFile.id });
    }
  }

  resume(dataChannel) {
    if (this.currentFile && this.isPaused) {
      this.isPaused = false;
      if (dataChannel && dataChannel.readyState === 'open') {
        try {
          dataChannel.send(JSON.stringify({
            type: 'file-resume',
            id: this.currentFile.id
          }));
        } catch (_) {}
      }
      this.emit('resume', { id: this.currentFile.id });
    }
  }

  handlePause() {
    if (this.currentFile && !this.isPaused) {
      this.isPaused = true;
      this.emit('pause', { id: this.currentFile.id, remote: true });
    }
  }

  handleResume() {
    if (this.currentFile && this.isPaused) {
      this.isPaused = false;
      this.emit('resume', { id: this.currentFile.id, remote: true });
    }
  }

  getResumeInfo() {
    if (!this.currentFile) return null;
    return {
      id: this.currentFile.id,
      receivedBytes: this.currentFile.receivedBytes
    };
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
      if (this.currentFile.isDirectStream && this.currentFile.writableStream) {
        try {
          this.currentFile.writableStream.abort();
        } catch (_) {}
      }
      this.currentFile.chunks = [];
      if (this.currentFile.downloadUrl) {
        URL.revokeObjectURL(this.currentFile.downloadUrl);
      }
    }
    this.currentFile = null;
    this.directStreamWritable = null;
    this.isPaused = false;
  }
}
