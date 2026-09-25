// public/js/utils.js - Shared helper utilities and speed smoothing

export function formatBytes(bytes, decimals = 1) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '-- MB/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatETA(seconds) {
  if (!seconds || seconds <= 0 || !isFinite(seconds)) return '--';
  if (seconds < 1) return '< 1s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const remSec = Math.round(seconds % 60);
  return `${mins}m ${remSec}s`;
}

export function truncateFilename(filename, maxLength = 26) {
  if (!filename || filename.length <= maxLength) return filename;
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex === -1 || dotIndex < filename.length - 8) {
    return filename.slice(0, maxLength - 3) + '...';
  }
  const ext = filename.slice(dotIndex);
  const nameWithoutExt = filename.slice(0, dotIndex);
  const remainingLength = maxLength - ext.length - 3;
  return nameWithoutExt.slice(0, remainingLength) + '...' + ext;
}

// Rolling window smoothed speed & ETA tracker
export class SpeedTracker {
  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
    this.samples = []; // Array of { time, bytes }
    this.smoothedSpeed = 0;
  }

  reset() {
    this.samples = [];
    this.smoothedSpeed = 0;
  }

  update(currentBytes, totalBytes) {
    const now = performance.now();
    this.samples.push({ time: now, bytes: currentBytes });

    // Prune samples older than windowMs
    const cutoff = now - this.windowMs;
    while (this.samples.length > 2 && this.samples[0].time < cutoff) {
      this.samples.shift();
    }

    if (this.samples.length >= 2) {
      const oldest = this.samples[0];
      const timeDiffSec = (now - oldest.time) / 1000;
      const bytesDiff = currentBytes - oldest.bytes;

      if (timeDiffSec > 0.1) {
        const instantSpeed = bytesDiff / timeDiffSec;
        // Exponential moving average for smooth display
        if (this.smoothedSpeed === 0) {
          this.smoothedSpeed = instantSpeed;
        } else {
          this.smoothedSpeed = this.smoothedSpeed * 0.7 + instantSpeed * 0.3;
        }
      }
    }

    const remainingBytes = Math.max(0, totalBytes - currentBytes);
    const etaSeconds = this.smoothedSpeed > 0 ? remainingBytes / this.smoothedSpeed : 0;

    return {
      speed: this.smoothedSpeed,
      speedFormatted: formatSpeed(this.smoothedSpeed),
      etaSeconds,
      etaFormatted: formatETA(etaSeconds)
    };
  }
}

// Pre-computed CRC-32 lookup table (polynomial 0xEDB88320)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

/**
 * Fast streaming CRC-32 calculator: updates running CRC on each chunk without memory copies.
 * @param {number} prevCrc Initial or previous CRC-32 value (start with 0)
 * @param {Uint8Array} uint8Array Chunk data
 * @returns {number} Updated unsigned 32-bit CRC
 */
export function crc32Update(prevCrc, uint8Array) {
  let crc = prevCrc ^ (-1);
  for (let i = 0, len = uint8Array.length; i < len; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ uint8Array[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

/**
 * Format 32-bit integer as hex string (e.g. "A3F89B21")
 */
export function formatChecksum(num) {
  if (typeof num === 'string') return num.toUpperCase();
  return (num >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Compute cryptographic SHA-256 hash using Web Crypto API
 */
export async function computeSha256(arrayBuffer) {
  if (typeof crypto !== 'undefined' && crypto.subtle && arrayBuffer) {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Format chunk size tier for UI indicators
 */
export function formatChunkTier(chunkSize) {
  if (chunkSize >= 256 * 1024) return '256 KB Ultra';
  if (chunkSize >= 128 * 1024) return '128 KB Turbo';
  return '64 KB Base';
}

