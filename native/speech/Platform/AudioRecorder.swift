import AVFoundation
import Foundation

struct CapturedAudio: Sendable {
    let data: Data
    let duration: TimeInterval
    var fileURL: URL? = nil
}

enum AudioRecordingError: LocalizedError {
    case permissionDenied
    case alreadyRecording
    case noInputDevice
    case couldNotStart
    case notRecording
    case tooShort
    case interrupted

    var errorDescription: String? {
        switch self {
        case .permissionDenied: "Allow microphone access in System Settings to dictate."
        case .alreadyRecording: "A recording is already in progress."
        case .noInputDevice: "Connect a microphone or choose an input in Sound settings."
        case .couldNotStart: "The microphone could not start recording."
        case .notRecording: "There is no active recording."
        case .tooShort: "The recording was too short. Hold the shortcut while you speak."
        case .interrupted: "The microphone stopped before recording finished. Try again."
        }
    }
}

@MainActor
final class AudioRecorder: NSObject, AVAudioRecorderDelegate {
    static let recordingSettings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: 16_000,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
    ]

    private(set) var lastRecordingURL: URL?

    var onLevel: ((Double) -> Void)?
    var onError: ((Error) -> Void)?

    var permission: AVAuthorizationStatus { AVCaptureDevice.authorizationStatus(for: .audio) }
    var isRecording: Bool { recorder?.isRecording == true }

    private var recorder: AVAudioRecorder?
    private var meteringTask: Task<Void, Never>?
    private var startGeneration = 0
    private var isStarting = false

    func requestPermission() async -> Bool {
        switch permission {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }

    func start() async throws {
        guard recorder == nil, !isStarting else { throw AudioRecordingError.alreadyRecording }
        isStarting = true
        startGeneration += 1
        let generation = startGeneration
        defer { if generation == startGeneration { isStarting = false } }
        guard await requestPermission() else { throw AudioRecordingError.permissionDenied }
        try Task.checkCancellation()
        guard generation == startGeneration else { throw CancellationError() }
        guard AVCaptureDevice.default(for: .audio) != nil else { throw AudioRecordingError.noInputDevice }

        let url = try RecordingFiles().create()
        lastRecordingURL = url
        do {
            let newRecorder = try AVAudioRecorder(url: url, settings: Self.recordingSettings)
            newRecorder.delegate = self
            newRecorder.isMeteringEnabled = true
            guard newRecorder.prepareToRecord(), newRecorder.record() else {
                throw AudioRecordingError.couldNotStart
            }
            recorder = newRecorder
            meteringTask = Task { [weak self] in
                while !Task.isCancelled {
                    guard let self, let recorder = self.recorder, recorder.isRecording else { return }
                    recorder.updateMeters()
                    let power = Double(recorder.averagePower(forChannel: 0))
                    self.onLevel?(min(1, max(0, pow(10, power / 20))))
                    do { try await Task.sleep(for: .milliseconds(60)) } catch { return }
                }
            }
        } catch {
            cleanUp()
            throw error
        }
    }

    func stop() throws -> CapturedAudio {
        guard let recorder else { throw AudioRecordingError.notRecording }
        let duration = recorder.currentTime
        let url = recorder.url
        recorder.delegate = nil
        recorder.stop()
        defer { cleanUp() }
        guard duration >= 0.15 else { throw AudioRecordingError.tooShort }
        let data = try Data(contentsOf: url)
        guard data.count > 44 else { throw AudioRecordingError.tooShort }
        return CapturedAudio(data: data, duration: duration, fileURL: url)
    }

    func cancel() {
        startGeneration += 1
        isStarting = false
        recorder?.delegate = nil
        recorder?.stop()
        cleanUp()
    }

    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: (any Error)?) {
        Task { @MainActor [weak self] in
            guard let self, self.recorder === recorder else { return }
            self.cancel()
            self.onError?(error ?? AudioRecordingError.interrupted)
        }
    }

    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            guard let self, self.recorder === recorder else { return }
            self.cancel()
            self.onError?(AudioRecordingError.interrupted)
        }
    }

    private func cleanUp() {
        meteringTask?.cancel()
        meteringTask = nil
        recorder = nil
        onLevel?(0)
    }
}
