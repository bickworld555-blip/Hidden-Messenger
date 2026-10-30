export type AbortableVoiceNoteWriter = {
  abort: () => Promise<void>;
};

const interruptionListeners = new Set<() => void>();

export function subscribeToVoiceNoteInterruption(listener: () => void) {
  interruptionListeners.add(listener);
  return () => interruptionListeners.delete(listener);
}

export function notifyVoiceNoteInterruption() {
  for (const listener of [...interruptionListeners]) {
    try {
      listener();
    } catch {
      // One screen's cleanup must not prevent other active capture owners from stopping.
    }
  }
}

/**
 * Discards a capture after an OS interruption. This path intentionally exposes
 * only abort(), never finish(), so an incomplete note cannot create a DB row.
 */
export async function discardInterruptedVoiceCapture(input: {
  writer: AbortableVoiceNoteWriter;
  stopStream: () => void;
  drainPendingWrites: () => Promise<void>;
  stopInterruptionMonitoring: () => Promise<void>;
}) {
  try {
    input.stopStream();
  } finally {
    try {
      await input.drainPendingWrites();
    } finally {
      try {
        await input.writer.abort();
      } finally {
        try {
          await input.stopInterruptionMonitoring();
        } catch {
          // Monitor teardown must not prevent ciphertext/key cleanup.
        }
      }
    }
  }
}
