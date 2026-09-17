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
