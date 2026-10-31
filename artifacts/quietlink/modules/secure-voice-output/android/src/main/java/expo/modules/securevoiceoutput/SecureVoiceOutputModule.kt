package expo.modules.securevoiceoutput

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.jni.NativeArrayBuffer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.nio.ByteBuffer

class SecureVoiceOutputModule : Module() {
  @Volatile private var audioTrack: AudioTrack? = null
  @Volatile private var activeSampleRate: Int = 0
  private val stateLock = Any()
  private var recordingInterruptionMonitoring = false
  private var playbackActive = false
  private var audioManager: AudioManager? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private var audioDeviceCallback: AudioDeviceCallback? = null

  private val audioFocusListener = AudioManager.OnAudioFocusChangeListener { focusChange ->
    if (focusChange < 0) handleSystemAudioInterruption("audio_focus_lost")
  }

  override fun definition() = ModuleDefinition {
    Name("HiddenMessengerSecureVoiceOutput")

    Events("audioInterruption")

    AsyncFunction("startInterruptionMonitoring") Coroutine {
      withContext(Dispatchers.IO) {
        startInterruptionMonitoring()
      }
    }

    AsyncFunction("stopInterruptionMonitoring") {
      stopInterruptionMonitoring()
    }

    AsyncFunction("startPlayback") Coroutine { sampleRate: Int, speed: Double ->
      withContext(Dispatchers.IO) {
        startPlayback(sampleRate, speed)
      }
    }

    AsyncFunction("writePcmChunk") Coroutine { chunk: NativeArrayBuffer ->
      withContext(Dispatchers.IO) {
        writeChunk(chunk)
      }
    }

    AsyncFunction("setPlaybackSpeed") Coroutine { speed: Double ->
      withContext(Dispatchers.IO) {
        setPlaybackSpeed(speed)
      }
    }

    AsyncFunction("stopPlayback") {
      stopPlayback()
    }

    OnDestroy {
      stopPlayback()
      stopInterruptionMonitoring()
    }
  }

  private fun startPlayback(sampleRate: Int, speed: Double) {
    require(sampleRate in 8_000..48_000) { "Unsupported PCM sample rate." }
    require(speed == 1.0 || speed == 1.5 || speed == 2.0) { "Unsupported playback speed." }
    stopPlayback()

    val format = AudioFormat.Builder()
      .setSampleRate(sampleRate)
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .build()
    val minBuffer = AudioTrack.getMinBufferSize(
      sampleRate,
      AudioFormat.CHANNEL_OUT_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    )
    check(minBuffer > 0) { "Could not initialize PCM output." }

    val track = AudioTrack.Builder()
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_MEDIA)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
      )
      .setAudioFormat(format)
      .setBufferSizeInBytes(maxOf(minBuffer, 8_192))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()

    synchronized(stateLock) {
      audioTrack = track
      activeSampleRate = sampleRate
      playbackActive = true
    }
    try {
      ensureAudioInterruptionMonitoring()
      track.play()
      setPlaybackSpeed(speed)
    } catch (error: Throwable) {
      stopPlayback()
      throw error
    }
  }

  private fun writeChunk(chunk: NativeArrayBuffer) {
    require(chunk.size() in 2..(64 * 1024) && chunk.size() % 2 == 0) {
      "Invalid bounded PCM chunk."
    }
    val track = synchronized(stateLock) {
      audioTrack ?: error("Audio output is not active.")
    }
    val source: ByteBuffer = chunk.toDirectBuffer().duplicate()
    source.rewind()
    val bytes = ByteArray(source.remaining())
    source.get(bytes)
    try {
      val startFrame = track.playbackHeadPosition.toLong() and 0xFFFFFFFFL
      var offset = 0
      while (offset < bytes.size) {
        val written = track.write(bytes, offset, bytes.size - offset, AudioTrack.WRITE_BLOCKING)
        if (written < 0) error("PCM output was interrupted.")
        if (written == 0) {
          Thread.sleep(2)
        } else {
          offset += written
        }
      }
      val targetFrame = startFrame + bytes.size / 2
      while ((track.playbackHeadPosition.toLong() and 0xFFFFFFFFL) < targetFrame) {
        if (track.playState != AudioTrack.PLAYSTATE_PLAYING) error("PCM output was interrupted.")
        Thread.sleep(2)
      }
    } finally {
      bytes.fill(0)
      for (index in 0 until source.capacity()) {
        source.put(index, 0.toByte())
      }
    }
  }

  private fun setPlaybackSpeed(speed: Double) {
    require(speed == 1.0 || speed == 1.5 || speed == 2.0) { "Unsupported playback speed." }
    val track = synchronized(stateLock) {
      audioTrack ?: error("Audio output is not active.")
    }
    val rate = (activeSampleRate * speed).toInt()
    check(track.setPlaybackRate(rate) == AudioTrack.SUCCESS) { "Could not update playback speed." }
  }

  private fun stopPlayback() {
    val previous = synchronized(stateLock) {
      val current = audioTrack
      audioTrack = null
      activeSampleRate = 0
      playbackActive = false
      current
    }

    if (previous != null) {
      try {
        if (previous.playState == AudioTrack.PLAYSTATE_PLAYING) previous.pause()
        previous.flush()
        previous.stop()
      } catch (_: IllegalStateException) {
        // The stream may already have been interrupted by the system.
      } finally {
        previous.release()
      }
    }
    releaseAudioInterruptionMonitoringIfIdle()
  }

  private fun startInterruptionMonitoring() {
    synchronized(stateLock) {
      recordingInterruptionMonitoring = true
    }
    try {
      ensureAudioInterruptionMonitoring()
    } catch (error: Throwable) {
      synchronized(stateLock) {
        recordingInterruptionMonitoring = false
      }
      releaseAudioInterruptionMonitoringIfIdle()
      throw error
    }
  }

  private fun stopInterruptionMonitoring() {
    synchronized(stateLock) {
      recordingInterruptionMonitoring = false
    }
    releaseAudioInterruptionMonitoringIfIdle()
  }

  private fun ensureAudioInterruptionMonitoring() {
    synchronized(stateLock) {
      if (audioManager != null) return
      val context = appContext.reactContext
        ?: throw IllegalStateException("Audio interruption monitoring requires an active application context.")
      val manager = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        ?: throw IllegalStateException("Android audio focus is unavailable.")
      val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(
            AudioAttributes.Builder()
              .setUsage(AudioAttributes.USAGE_MEDIA)
              .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
              .build()
          )
          .setOnAudioFocusChangeListener(audioFocusListener, Handler(Looper.getMainLooper()))
          .build()
        audioFocusRequest = request
        manager.requestAudioFocus(request)
      } else {
        manager.requestAudioFocus(
          audioFocusListener,
          AudioManager.STREAM_MUSIC,
          AudioManager.AUDIOFOCUS_GAIN
        )
      }
      if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          audioFocusRequest?.let { manager.abandonAudioFocusRequest(it) }
        } else {
          manager.abandonAudioFocus(audioFocusListener)
        }
        audioFocusRequest = null
        throw IllegalStateException("Android audio focus was not granted.")
      }
      audioManager = manager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val callback = object : AudioDeviceCallback() {
          override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
            handleSystemAudioInterruption("audio_route_changed")
          }

          override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
            handleSystemAudioInterruption("audio_route_changed")
          }
        }
        audioDeviceCallback = callback
        manager.registerAudioDeviceCallback(callback, Handler(Looper.getMainLooper()))
      }
    }
  }

  private fun releaseAudioInterruptionMonitoringIfIdle() {
    synchronized(stateLock) {
      if (recordingInterruptionMonitoring || playbackActive) return
      val manager = audioManager ?: return
      audioDeviceCallback?.let { callback ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          try {
            manager.unregisterAudioDeviceCallback(callback)
          } catch (_: RuntimeException) {
            // The callback may already have been detached during module teardown.
          }
        }
      }
      audioDeviceCallback = null
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        audioFocusRequest?.let { manager.abandonAudioFocusRequest(it) }
      } else {
        manager.abandonAudioFocus(audioFocusListener)
      }
      audioFocusRequest = null
      audioManager = null
    }
  }

  private fun handleSystemAudioInterruption(reason: String) {
    val active = synchronized(stateLock) {
      recordingInterruptionMonitoring || playbackActive
    }
    if (!active) return
    stopPlayback()
    appContext.mainQueue.launch {
      sendEvent("audioInterruption", mapOf("reason" to reason))
    }
  }
}
