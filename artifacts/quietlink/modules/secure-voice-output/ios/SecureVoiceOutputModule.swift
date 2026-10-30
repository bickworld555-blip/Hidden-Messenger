import AVFoundation
import ExpoModulesCore

private final class PendingVoiceChunk {
  let buffer: AVAudioPCMBuffer
  let promise: Promise

  init(buffer: AVAudioPCMBuffer, promise: Promise) {
    self.buffer = buffer
    self.promise = promise
  }
}

public final class SecureVoiceOutputModule: Module {
  private let stateQueue = DispatchQueue(label: "hidden-messenger.secure-voice-output")
  private var engine: AVAudioEngine?
  private var player: AVAudioPlayerNode?
  private var timePitch: AVAudioUnitTimePitch?
  private var pcmFormat: AVAudioFormat?
  private var pendingChunks: [UUID: PendingVoiceChunk] = [:]
  private var recordingInterruptionMonitoring = false
  private var playbackActive = false
  private var interruptionObserver: NSObjectProtocol?
  private var routeChangeObserver: NSObjectProtocol?
  private var mediaServicesResetObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("HiddenMessengerSecureVoiceOutput")

    Events("audioInterruption")

    AsyncFunction("startInterruptionMonitoring") {
      self.startInterruptionMonitoring()
    }

    AsyncFunction("stopInterruptionMonitoring") {
      self.stopInterruptionMonitoring()
    }

    AsyncFunction("startPlayback") { (sampleRate: Int, speed: Double) throws in
      try self.startPlayback(sampleRate: sampleRate, speed: speed)
    }

    AsyncFunction("writePcmChunk") { (chunk: ArrayBuffer, promise: Promise) in
      do {
        try self.schedule(chunk: chunk, promise: promise)
      } catch {
        promise.reject(Exception(
          name: "SecureVoiceOutputError",
          description: error.localizedDescription
        ))
      }
    }

    AsyncFunction("setPlaybackSpeed") { (speed: Double) throws in
      try self.setPlaybackSpeed(speed)
    }

    AsyncFunction("stopPlayback") {
      self.stopPlayback()
    }

    OnDestroy {
      self.stopPlayback()
      self.stopInterruptionMonitoring()
    }
  }

  private func startPlayback(sampleRate: Int, speed: Double) throws {
    guard (8_000...48_000).contains(sampleRate) else {
      throw Exception(name: "SecureVoiceOutputError", description: "Unsupported PCM sample rate.")
    }
    guard [1.0, 1.5, 2.0].contains(speed) else {
      throw Exception(name: "SecureVoiceOutputError", description: "Unsupported playback speed.")
    }

    try stateQueue.sync {
      stopPlaybackLocked()
      do {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio, options: [])
        playbackActive = true
        installInterruptionObserversLocked()
        try session.setActive(true)

        guard let format = AVAudioFormat(
          commonFormat: .pcmFormatInt16,
          sampleRate: Double(sampleRate),
          channels: 1,
          interleaved: false
        ) else {
          throw Exception(name: "SecureVoiceOutputError", description: "Could not create PCM output format.")
        }

        let audioEngine = AVAudioEngine()
        let audioPlayer = AVAudioPlayerNode()
        let pitch = AVAudioUnitTimePitch()
        pitch.rate = Float(speed)
        audioEngine.attach(audioPlayer)
        audioEngine.attach(pitch)
        audioEngine.connect(audioPlayer, to: pitch, format: format)
        audioEngine.connect(pitch, to: audioEngine.mainMixerNode, format: format)
        engine = audioEngine
        player = audioPlayer
        timePitch = pitch
        pcmFormat = format
        audioEngine.prepare()
        try audioEngine.start()
        audioPlayer.play()
      } catch {
        stopPlaybackLocked()
        throw error
      }
    }
  }

  private func schedule(chunk: ArrayBuffer, promise: Promise) throws {
    defer {
      chunk.withUnsafeMutableBytes { bytes in
        if let baseAddress = bytes.baseAddress {
          memset(baseAddress, 0, bytes.count)
        }
      }
    }
    guard chunk.byteLength > 0,
          chunk.byteLength <= 64 * 1024,
          chunk.byteLength % MemoryLayout<Int16>.size == 0 else {
      throw Exception(name: "SecureVoiceOutputError", description: "Invalid bounded PCM chunk.")
    }

    try stateQueue.sync {
      guard let audioPlayer = player, let format = pcmFormat else {
        throw Exception(name: "SecureVoiceOutputError", description: "Audio output is not active.")
      }
      let frameCount = AVAudioFrameCount(chunk.byteLength / MemoryLayout<Int16>.size)
      guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount),
            let channel = pcmBuffer.int16ChannelData?.pointee else {
        throw Exception(name: "SecureVoiceOutputError", description: "Could not allocate PCM output buffer.")
      }
      pcmBuffer.frameLength = frameCount
      chunk.withUnsafeBytes { source in
        if let baseAddress = source.baseAddress {
          memcpy(channel, baseAddress, chunk.byteLength)
        }
      }

      let id = UUID()
      pendingChunks[id] = PendingVoiceChunk(buffer: pcmBuffer, promise: promise)
      audioPlayer.scheduleBuffer(pcmBuffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
        guard let self else { return }
        self.stateQueue.async {
          guard let pending = self.pendingChunks.removeValue(forKey: id) else { return }
          self.zero(pending.buffer)
          pending.promise.resolve(nil)
        }
      }
    }
  }

  private func setPlaybackSpeed(_ speed: Double) throws {
    guard [1.0, 1.5, 2.0].contains(speed) else {
      throw Exception(name: "SecureVoiceOutputError", description: "Unsupported playback speed.")
    }
    stateQueue.sync {
      timePitch?.rate = Float(speed)
    }
  }

  private func stopPlayback() {
    stateQueue.sync {
      stopPlaybackLocked()
    }
  }

  private func stopPlaybackLocked() {
    player?.stop()
    engine?.stop()
    playbackActive = false
    for pending in pendingChunks.values {
      zero(pending.buffer)
      pending.promise.reject(Exception(
        name: "SecureVoiceOutputInterrupted",
        description: "Voice playback was stopped."
      ))
    }
    pendingChunks.removeAll()
    player = nil
    timePitch = nil
    pcmFormat = nil
    engine = nil
    if !recordingInterruptionMonitoring {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    removeInterruptionObserversIfIdleLocked()
  }

  private func startInterruptionMonitoring() {
    stateQueue.sync {
      recordingInterruptionMonitoring = true
      installInterruptionObserversLocked()
    }
  }

  private func stopInterruptionMonitoring() {
    stateQueue.sync {
      recordingInterruptionMonitoring = false
      if !playbackActive {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      }
      removeInterruptionObserversIfIdleLocked()
    }
  }

  private func installInterruptionObserversLocked() {
    guard interruptionObserver == nil else { return }
    let session = AVAudioSession.sharedInstance()
    interruptionObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: session,
      queue: .main
    ) { [weak self] notification in
      guard
        let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        let type = AVAudioSession.InterruptionType(rawValue: rawType),
        type == .began
      else { return }
      self?.handleSystemInterruption(reason: "audio_interrupted")
    }
    routeChangeObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: session,
      queue: .main
    ) { [weak self] notification in
      guard
        let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
        let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason)
      else { return }
      switch reason {
      case .newDeviceAvailable, .oldDeviceUnavailable, .noSuitableRouteForCategory, .routeConfigurationChange:
        self?.handleSystemInterruption(reason: "audio_route_changed")
      default:
        break
      }
    }
    mediaServicesResetObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.mediaServicesWereResetNotification,
      object: session,
      queue: .main
    ) { [weak self] _ in
      self?.handleSystemInterruption(reason: "audio_session_reset")
    }
  }

  private func removeInterruptionObserversIfIdleLocked() {
    guard !recordingInterruptionMonitoring && !playbackActive else { return }
    if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
    if let routeChangeObserver { NotificationCenter.default.removeObserver(routeChangeObserver) }
    if let mediaServicesResetObserver { NotificationCenter.default.removeObserver(mediaServicesResetObserver) }
    interruptionObserver = nil
    routeChangeObserver = nil
    mediaServicesResetObserver = nil
  }

  private func handleSystemInterruption(reason: String) {
    stateQueue.async {
      guard self.recordingInterruptionMonitoring || self.playbackActive else { return }
      self.stopPlaybackLocked()
      self.emit(event: "audioInterruption", payload: ["reason": reason])
    }
  }

  private func zero(_ buffer: AVAudioPCMBuffer) {
    guard let channel = buffer.int16ChannelData?.pointee else { return }
    memset(channel, 0, Int(buffer.frameLength) * MemoryLayout<Int16>.size)
    buffer.frameLength = 0
  }
}
