import type { SignedForensicReport, ForensicValidation, DeviceFingerprint } from '../types.js';

// ── Bounds to prevent unbounded memory growth ────────────────────────────────

const MAX_REPORTS = 500;
const MAX_PHASHES = 2_000;
const MAX_FINGERPRINTS_PER_WORKER = 20;

interface StoredForensicData {
  signedReport: SignedForensicReport;
  validation: ForensicValidation;
  storedAt: number;
}

interface PhashEntry {
  taskId: string;
  workerAddress: string;
  phash: string;
  storedAt: number;
}

export class ForensicStore {
  private reports = new Map<string, StoredForensicData>();
  private phashes: PhashEntry[] = [];
  private deviceFingerprints = new Map<string, DeviceFingerprint[]>();

  saveReport(taskId: string, signedReport: SignedForensicReport, validation: ForensicValidation): void {
    // Evict oldest report when at capacity
    if (this.reports.size >= MAX_REPORTS && !this.reports.has(taskId)) {
      const oldest = this.reports.keys().next().value!;
      this.reports.delete(oldest);
    }
    this.reports.set(taskId, { signedReport, validation, storedAt: Date.now() });

    // Evict oldest phash when at capacity
    if (this.phashes.length >= MAX_PHASHES) {
      this.phashes.splice(0, this.phashes.length - MAX_PHASHES + 1);
    }
    this.phashes.push({
      taskId,
      workerAddress: signedReport.report.workerAddress,
      phash: signedReport.report.phash,
      storedAt: Date.now(),
    });
  }

  getReport(taskId: string): { signedReport: SignedForensicReport; validation: ForensicValidation } | null {
    const data = this.reports.get(taskId);
    if (!data) return null;
    return { signedReport: data.signedReport, validation: data.validation };
  }

  findPhashMatches(phash: string, maxHammingDistance: number): { taskId: string; workerAddress: string; distance: number }[] {
    const matches: { taskId: string; workerAddress: string; distance: number }[] = [];
    for (const entry of this.phashes) {
      const distance = hammingDistance(phash, entry.phash);
      if (distance <= maxHammingDistance) {
        matches.push({ taskId: entry.taskId, workerAddress: entry.workerAddress, distance });
      }
    }
    return matches;
  }

  recordDeviceFingerprint(workerAddress: string, fingerprint: DeviceFingerprint): void {
    const existing = this.deviceFingerprints.get(workerAddress) || [];
    const isDuplicate = existing.some(
      (fp) => fp.screenWidth === fingerprint.screenWidth &&
              fp.screenHeight === fingerprint.screenHeight &&
              fp.webglRenderer === fingerprint.webglRenderer &&
              fp.userAgent === fingerprint.userAgent
    );
    if (!isDuplicate) {
      existing.push(fingerprint);
      // Evict oldest when per-worker limit reached
      if (existing.length > MAX_FINGERPRINTS_PER_WORKER) {
        existing.splice(0, existing.length - MAX_FINGERPRINTS_PER_WORKER);
      }
      this.deviceFingerprints.set(workerAddress, existing);
    }
  }

  getDeviceCount(workerAddress: string): number {
    return (this.deviceFingerprints.get(workerAddress) || []).length;
  }
}

function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < a.length; i += 2) {
    const byteA = parseInt(a.substring(i, i + 2), 16);
    const byteB = parseInt(b.substring(i, i + 2), 16);
    let xor = byteA ^ byteB;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

// Singleton
export const forensicStore = new ForensicStore();
