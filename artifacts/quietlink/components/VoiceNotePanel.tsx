import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioStream, type AudioStreamBuffer } from 'expo-audio';
import { AppState, Animated, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import {
  beginLocalVoiceNote,
  addLocalVoiceInterruptionListener,
  deleteLocalVoiceNoteAndCiphertext,
  isSecureVoiceNotePathAvailable,
  listLocalVoiceNoteSummaries,
  playLocalVoiceNote,
  setLocalVoicePlaybackSpeed,
  startLocalVoiceInterruptionMonitoring,
  stopLocalVoiceInterruptionMonitoring,
  stopLocalVoicePlayback,
  type LocalVoiceNoteWriter,
} from '@/storage/secureVoiceNotes';
import type { LocalVoiceNoteSummary } from '@/storage/secureChatDb';
import {
  discardInterruptedVoiceCapture,
  subscribeToVoiceNoteInterruption,
} from '@/storage/voiceNoteInterruption';

const SAMPLE_RATE = 16_000;
const CHANNELS = 1;
const MAX_DURATION_SECONDS = 5 * 60;
const MAX_PENDING_AUDIO_BYTES = 256 * 1024;
const waveform = [8, 17, 12, 23, 10, 18, 28, 15, 9, 21, 13, 25, 11, 19, 8, 16, 24, 12, 20, 9, 15, 26, 11, 18, 8, 21, 13, 17];
const playbackSpeeds = [1, 1.5, 2] as const;

function WaveBar({ height, active, index, color }: { height: number; active: boolean; index: number; color: string }) {
  const progress = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (!active) {
      progress.setValue(0.45);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: 250 + (index % 5) * 45, useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0.25, duration: 280 + (index % 4) * 55, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, index, progress]);
  return (
    <Animated.View
      style={[
        styles.waveBar,
        { height, opacity: active ? 1 : 0.55, backgroundColor: color, transform: [{ scaleY: progress }] },
      ]}
    />
  );
}

function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function stopAudioStreamSafely(stream: { stop: () => void } | null) {
  try {
    stream?.stop();
  } catch {
    // The stream may already have stopped during an OS interruption.
  }
}

function LockedVoiceNotePanel({
  onCheckMicrophone,
  onClose,
  storageReady,
}: {
  onCheckMicrophone: () => Promise<boolean>;
  onClose: () => void;
  storageReady: boolean;
}) {
  const colors = useColors();
  const reason = storageReady
    ? 'This build does not include the native encrypted audio path.'
    : 'The encrypted SQLCipher vault is unavailable.';

  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: colors.accent }]}>
          <Feather name="mic" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Voice notes</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Recording unavailable</Text>
        </View>
        <Text style={[styles.duration, { color: colors.mutedForeground }]}>00:00</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close voice note panel">
          <Feather name="x" size={17} color={colors.mutedForeground} />
        </Pressable>
      </View>
      <View style={styles.waveform} accessibilityLabel="Locked voice note waveform">
        {waveform.map((height, index) => (
          <WaveBar key={index} height={height} active={false} index={index} color={colors.primary} />
        ))}
      </View>
      <View style={styles.controls}>
        <Pressable
          disabled
          style={[styles.recordButton, { backgroundColor: colors.muted, opacity: 0.65 }]}
          accessibilityRole="button"
          accessibilityLabel="Recording disabled"
        >
          <Feather name="lock" size={15} color={colors.mutedForeground} />
        </Pressable>
        <View style={styles.speedRow}>
          {['1x', '1.5x', '2x'].map((speed) => (
            <View key={speed} style={[styles.speed, { backgroundColor: colors.secondary, opacity: 0.55 }]}>
              <Text style={[styles.speedText, { color: colors.mutedForeground }]}>{speed}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.locked, { color: colors.mutedForeground }]}>Locked</Text>
      </View>
      <Text style={[styles.disclosure, { color: colors.mutedForeground }]}>
        {reason} Voice controls stay disabled instead of saving an unencrypted audio file. Local recordings will not be sent or shared until a reviewed E2EE protocol is selected.
      </Text>
      <Pressable onPress={() => void onCheckMicrophone()} style={styles.permissionLink} accessibilityRole="button">
        <Feather name="mic" size={13} color={colors.primary} />
        <Text style={[styles.permissionText, { color: colors.primary }]}>Check microphone permission</Text>
      </Pressable>
    </View>
  );
}

function SecureVoiceNoteControls({
  conversationId,
  onCheckMicrophone,
  onClose,
}: {
  conversationId: string;
  onCheckMicrophone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const colors = useColors();
  const writerRef = useRef<LocalVoiceNoteWriter | null>(null);
  const streamRef = useRef<{ stop: () => void } | null>(null);
  const captureActiveRef = useRef(false);
  const savingRef = useRef(false);
  const pendingBytesRef = useRef(0);
  const pipelineRef = useRef<Promise<void>>(Promise.resolve());
  const captureFailureRef = useRef<unknown>(null);
  const stopCaptureRef = useRef<() => void>(() => {});
  const playbackAbortRef = useRef<AbortController | null>(null);
  const startInProgressRef = useRef(false);
  const interruptionEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const [captureState, setCaptureState] = useState<'idle' | 'starting' | 'recording' | 'saving' | 'interrupted'>('idle');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [notes, setNotes] = useState<LocalVoiceNoteSummary[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<(typeof playbackSpeeds)[number]>(1);
  const [notice, setNotice] = useState('');

  const onBuffer = useCallback((buffer: AudioStreamBuffer) => {
    const chunk = new Uint8Array(buffer.data);
    const writer = writerRef.current;
    if (!captureActiveRef.current || !writer) {
      chunk.fill(0);
      return;
    }
    if (buffer.sampleRate !== SAMPLE_RATE || buffer.channels !== 1 || chunk.length % 2 !== 0) {
      chunk.fill(0);
      captureFailureRef.current = new Error('The device did not provide the required mono 16 kHz PCM format.');
      captureActiveRef.current = false;
      stopAudioStreamSafely(streamRef.current);
      stopCaptureRef.current();
      return;
    }
    if (pendingBytesRef.current + chunk.length > MAX_PENDING_AUDIO_BYTES) {
      chunk.fill(0);
      captureFailureRef.current = new Error('Audio capture exceeded its bounded memory queue.');
      captureActiveRef.current = false;
      stopAudioStreamSafely(streamRef.current);
      stopCaptureRef.current();
      return;
    }

    pendingBytesRef.current += chunk.length;
    const operation = pipelineRef.current.then(() => writer.appendPcmChunk(chunk));
    pipelineRef.current = operation
      .catch((error: unknown) => {
        captureFailureRef.current ??= error;
        captureActiveRef.current = false;
        chunk.fill(0);
        stopAudioStreamSafely(streamRef.current);
        stopCaptureRef.current();
      })
      .finally(() => {
        pendingBytesRef.current = Math.max(0, pendingBytesRef.current - chunk.length);
      });
    setDurationSeconds(Math.min(MAX_DURATION_SECONDS, Math.floor(buffer.timestamp)));
    if (buffer.timestamp >= MAX_DURATION_SECONDS) stopCaptureRef.current();
  }, []);

  const { stream } = useAudioStream({
    sampleRate: SAMPLE_RATE,
    channels: 1,
    encoding: 'int16',
    onBuffer,
  });
  streamRef.current = stream;

  const refreshNotes = useCallback(async () => {
    try {
      const nextNotes = await listLocalVoiceNoteSummaries(conversationId);
      if (mountedRef.current) setNotes(nextNotes);
    } catch {
      if (mountedRef.current) setNotice('Could not read encrypted voice-note metadata.');
    }
  }, [conversationId]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshNotes();
    return () => {
      mountedRef.current = false;
      captureActiveRef.current = false;
      playbackAbortRef.current?.abort();
      stopAudioStreamSafely(stream);
      const writer = writerRef.current;
      writerRef.current = null;
      if (writer) void writer.abort();
      void stopLocalVoicePlayback().catch(() => undefined);
      void stopLocalVoiceInterruptionMonitoring().catch(() => undefined);
    };
  }, [refreshNotes, stream]);

  const stopRecording = useCallback(async () => {
    if (!writerRef.current || savingRef.current) return;
    savingRef.current = true;
    captureActiveRef.current = false;
    setCaptureState('saving');
    try {
      await stream.stop();
      await pipelineRef.current;
      const writer = writerRef.current;
      writerRef.current = null;
      if (!writer) return;
      if (captureFailureRef.current) {
        await writer.abort();
        throw captureFailureRef.current;
      }
      await writer.finish();
      captureFailureRef.current = null;
      if (mountedRef.current) {
        setNotice('Saved on this device only. Voice-note sharing is locked until E2EE is reviewed.');
        await refreshNotes();
      }
    } catch (error) {
      captureFailureRef.current ??= error;
      if (mountedRef.current) {
        setNotice('Recording was interrupted or could not be saved. The incomplete note was discarded. Tap the microphone to try again.');
      }
      const writer = writerRef.current;
      writerRef.current = null;
      if (writer) {
        try { await writer.abort(); } catch { /* the writer already discarded its key/file best-effort */ }
      }
    } finally {
      savingRef.current = false;
      void stopLocalVoiceInterruptionMonitoring().catch(() => undefined);
      if (mountedRef.current) {
        setCaptureState(captureFailureRef.current ? 'interrupted' : 'idle');
        setDurationSeconds(0);
      }
    }
  }, [refreshNotes, stream]);

  useEffect(() => {
    stopCaptureRef.current = () => { void stopRecording(); };
  }, [stopRecording]);

  const discardInterruptedCapture = useCallback(async () => {
    const writer = writerRef.current;
    if (!writer || savingRef.current) return;
    savingRef.current = true;
    captureActiveRef.current = false;
    captureFailureRef.current = new Error('Audio capture was interrupted.');
    if (mountedRef.current) setCaptureState('saving');
    try {
      await discardInterruptedVoiceCapture({
        writer,
        stopStream: () => stopAudioStreamSafely(streamRef.current),
        drainPendingWrites: () => pipelineRef.current,
        stopInterruptionMonitoring: stopLocalVoiceInterruptionMonitoring,
      });
    } catch {
      try { await writer.abort(); } catch { /* cleanup is best-effort after capture interruption */ }
    } finally {
      writerRef.current = null;
      pendingBytesRef.current = 0;
      savingRef.current = false;
      void stopLocalVoiceInterruptionMonitoring().catch(() => undefined);
      if (mountedRef.current) {
        setCaptureState('interrupted');
        setDurationSeconds(0);
        setNotice('Recording interrupted. The incomplete encrypted note was discarded. Tap the microphone to try again.');
      }
    }
  }, []);

  const handleSystemInterruption = useCallback(() => {
    interruptionEpochRef.current += 1;
    if (writerRef.current) void discardInterruptedCapture();
    const controller = playbackAbortRef.current;
    if (!controller) return;
    playbackAbortRef.current = null;
    controller.abort();
    void stopLocalVoicePlayback().catch(() => undefined);
    if (mountedRef.current) {
      setPlayingId(null);
      setNotice('Playback interrupted. Audio buffers were cleared. Tap Play to try again.');
    }
  }, [discardInterruptedCapture]);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') handleSystemInterruption();
    });
    const audioSubscription = addLocalVoiceInterruptionListener(() => handleSystemInterruption());
    const callSubscription = subscribeToVoiceNoteInterruption(handleSystemInterruption);
    return () => {
      appStateSubscription.remove();
      audioSubscription?.remove();
      callSubscription();
    };
  }, [handleSystemInterruption]);

  const startRecording = async () => {
    if (
      (captureState !== 'idle' && captureState !== 'interrupted') ||
      writerRef.current ||
      savingRef.current ||
      startInProgressRef.current
    ) return;
    startInProgressRef.current = true;
    const startEpoch = interruptionEpochRef.current;
    setCaptureState('starting');
    setNotice('');

    let writer: LocalVoiceNoteWriter | null = null;
    try {
      const permissionGranted = await onCheckMicrophone();
      if (!permissionGranted) {
        setCaptureState(captureFailureRef.current ? 'interrupted' : 'idle');
        return;
      }
      if (startEpoch !== interruptionEpochRef.current) {
        throw new Error('Audio capture was interrupted before it started.');
      }
      writer = await beginLocalVoiceNote(conversationId);
      writerRef.current = writer;
      captureFailureRef.current = null;
      pendingBytesRef.current = 0;
      pipelineRef.current = Promise.resolve();
      captureActiveRef.current = false;
      setDurationSeconds(0);
      await startLocalVoiceInterruptionMonitoring();
      if (captureFailureRef.current || startEpoch !== interruptionEpochRef.current) {
        throw captureFailureRef.current ?? new Error('Audio capture was interrupted before it started.');
      }
      await stream.start();
      if (startEpoch !== interruptionEpochRef.current) {
        throw new Error('Audio capture was interrupted before it started.');
      }
      if (stream.sampleRate !== SAMPLE_RATE || stream.channels !== CHANNELS) {
        throw new Error('This device cannot provide the required mono 16 kHz PCM format.');
      }
      if (captureFailureRef.current) throw captureFailureRef.current;
      captureActiveRef.current = true;
      setCaptureState('recording');
      setNotice('Recording is encrypted before each audio chunk is written.');
    } catch (error) {
      captureActiveRef.current = false;
      try { await stream.stop(); } catch { /* stream did not start */ }
      if (writer) {
        try { await writer.abort(); } catch { /* never keep an incomplete note active for retry */ }
      }
      writerRef.current = null;
      void stopLocalVoiceInterruptionMonitoring().catch(() => undefined);
      setCaptureState('interrupted');
      setNotice('Could not start recording. No partial note was kept. Tap the microphone to try again.');
    } finally {
      startInProgressRef.current = false;
    }
  };

  const togglePlayback = async (noteId: string) => {
    if (playingId === noteId) {
      playbackAbortRef.current?.abort();
      try { await stopLocalVoicePlayback(); } catch { /* already stopped */ }
      return;
    }
    playbackAbortRef.current?.abort();
    try { await stopLocalVoicePlayback(); } catch { /* no previous playback */ }
    const controller = new AbortController();
    playbackAbortRef.current = controller;
    setPlayingId(noteId);
    setNotice('');
    try {
      await playLocalVoiceNote(noteId, { signal: controller.signal, speed: playbackSpeed });
    } catch {
      if (!controller.signal.aborted && mountedRef.current) {
        setNotice('Playback stopped or authentication failed. No audio file was written.');
      }
    } finally {
      if (playbackAbortRef.current === controller) playbackAbortRef.current = null;
      if (mountedRef.current) setPlayingId(null);
    }
  };

  const changePlaybackSpeed = async (speed: (typeof playbackSpeeds)[number]) => {
    setPlaybackSpeed(speed);
    if (playingId) {
      try {
        await setLocalVoicePlaybackSpeed(speed);
      } catch {
        setNotice('Could not change playback speed.');
      }
    }
  };

  const deleteNote = (noteId: string) => {
    Alert.alert(
      'Delete local voice note?',
      'The SQLCipher-protected key will be removed and the encrypted file deleted where possible. Flash-storage erasure cannot be guaranteed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteLocalVoiceNoteAndCiphertext(noteId)
              .then(refreshNotes)
              .catch(() => setNotice('Could not remove the local voice note.'));
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: colors.accent }]}>
          <Feather name="mic" size={16} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Voice notes</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Encrypted local recording</Text>
        </View>
        <Text style={[styles.duration, { color: captureState === 'recording' ? colors.destructive : colors.mutedForeground }]}>
          {formatTime(captureState === 'recording' ? durationSeconds : 0)}
        </Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close voice note panel">
          <Feather name="x" size={17} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <View style={styles.waveform} accessibilityLabel={captureState === 'recording' || !!playingId ? 'Active voice note waveform' : 'Voice note waveform'}>
        {waveform.map((height, index) => (
          <WaveBar key={index} height={height} active={captureState === 'recording' || !!playingId} index={index} color={colors.primary} />
        ))}
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => captureState === 'recording' ? void stopRecording() : void startRecording()}
          disabled={captureState === 'saving' || captureState === 'starting' || !!playingId}
          style={[
            styles.recordButton,
            { backgroundColor: captureState === 'recording' ? colors.destructive : colors.primary },
            (captureState === 'saving' || captureState === 'starting' || !!playingId) && { opacity: 0.55 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            captureState === 'recording'
              ? 'Stop and save encrypted voice note'
              : captureState === 'starting'
                ? 'Starting encrypted voice note recording'
              : captureState === 'interrupted'
                ? 'Retry encrypted voice note recording'
                : 'Record encrypted voice note'
          }
        >
          <Feather
            name={captureState === 'recording' ? 'square' : captureState === 'interrupted' ? 'refresh-cw' : 'mic'}
            size={14}
            color={colors.primaryForeground}
          />
        </Pressable>
        <View style={styles.speedRow}>
          {playbackSpeeds.map((speed) => (
            <Pressable
              key={speed}
              onPress={() => void changePlaybackSpeed(speed)}
              style={[
                styles.speed,
                { backgroundColor: speed === playbackSpeed ? colors.accent : colors.secondary },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Set playback speed to ${speed} times`}
            >
              <Text style={[styles.speedText, { color: speed === playbackSpeed ? colors.primary : colors.mutedForeground }]}>
                {speed}x
              </Text>
            </Pressable>
          ))}
        </View>
        {captureState === 'starting' ? <Text style={[styles.locked, { color: colors.mutedForeground }]}>Starting</Text> : null}
        {captureState === 'saving' ? <Text style={[styles.locked, { color: colors.mutedForeground }]}>Saving</Text> : null}
      </View>

      <Text style={[styles.disclosure, { color: colors.mutedForeground }]}>
        Audio is encrypted per chunk before app-owned writes and decrypted one authenticated chunk at a time for in-memory playback. Notes stay on this device; sharing remains locked until E2EE review.
      </Text>

      {notice ? <Text style={[styles.notice, { color: colors.mutedForeground }]}>{notice}</Text> : null}

      {notes.slice(0, 4).map((note) => (
        <View key={note.id} style={[styles.noteRow, { borderTopColor: colors.border }]}>
          <Pressable
            onPress={() => void togglePlayback(note.id)}
            style={[styles.notePlay, { backgroundColor: colors.accent }]}
            accessibilityRole="button"
            accessibilityLabel={playingId === note.id ? 'Stop voice note playback' : 'Play local voice note'}
          >
            <Feather name={playingId === note.id ? 'square' : 'play'} size={13} color={colors.primary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={[styles.noteTitle, { color: colors.foreground }]}>Local encrypted note</Text>
            <Text style={[styles.noteTime, { color: colors.mutedForeground }]}>
              {formatTime(note.total_bytes / (SAMPLE_RATE * CHANNELS * 2))} · {new Date(note.created_at).toLocaleString()}
            </Text>
          </View>
          <Pressable onPress={() => deleteNote(note.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Delete local voice note">
            <Feather name="trash-2" size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ))}
      {!notes.length ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>No local voice notes yet.</Text>
      ) : null}
    </View>
  );
}

export function VoiceNotePanel({
  conversationId,
  storageReady,
  onCheckMicrophone,
  onClose,
}: {
  conversationId: string;
  storageReady: boolean;
  onCheckMicrophone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const nativePathReady = isSecureVoiceNotePathAvailable();
  if (!storageReady || !nativePathReady) {
    return <LockedVoiceNotePanel storageReady={storageReady} onCheckMicrophone={onCheckMicrophone} onClose={onClose} />;
  }
  return (
    <SecureVoiceNoteControls
      conversationId={conversationId}
      onCheckMicrophone={onCheckMicrophone}
      onClose={onClose}
    />
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 18, marginHorizontal: 12, marginBottom: 8, padding: 13 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 13, fontWeight: '700' },
  subtitle: { fontSize: 10, marginTop: 3 },
  duration: { fontSize: 11, fontVariant: ['tabular-nums'] },
  waveform: { height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 12 },
  waveBar: { width: 3, borderRadius: 4 },
  controls: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10 },
  recordButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
  speedRow: { flex: 1, flexDirection: 'row', gap: 6 },
  speed: { minWidth: 38, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  speedText: { fontSize: 10, fontWeight: '700' },
  locked: { fontSize: 10, fontWeight: '700' },
  disclosure: { fontSize: 10, lineHeight: 15, marginTop: 10 },
  permissionLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start' },
  permissionText: { fontSize: 10, fontWeight: '700' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 9, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9, marginTop: 9 },
  notePlay: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  noteTitle: { fontSize: 11, fontWeight: '700' },
  noteTime: { fontSize: 9, marginTop: 2 },
  notice: { fontSize: 10, lineHeight: 14, marginTop: 8 },
  empty: { fontSize: 10, marginTop: 12, textAlign: 'center' },
});
