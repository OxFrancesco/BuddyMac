import AppKit
import AVFoundation

// BuddyMac's camera helper. JSON lines on stdin and stdout, like the speech helper.
// Frames never leave the capture pipeline: the preview is an AVCaptureVideoPreviewLayer the window server composites,
// and AVCaptureMovieFileOutput hands frames to the hardware encoder. Nothing is copied through this process or Bun.

private let output = NSLock()
func emit(_ object: [String: Any]) { autoreleasepool {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    output.lock(); FileHandle.standardOutput.write(data + Data([10])); output.unlock()
} }

struct Settings: Codable {
    var device: String?
    var mode: String?
    var mirror: Bool?
    var microphone: String?
    var codec: String?
    var folder: String?
}

/// One resolution at one frame rate, backed by the device format that delivers it with the least work.
struct Mode {
    let id: String
    let width: Int
    let height: Int
    let fps: Double
    let format: AVCaptureDevice.Format
    let duration: CMTime
    let compressed: Bool
}

private let uncompressed: Set<FourCharCode> = [
    kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    kCVPixelFormatType_422YpCbCr8, kCVPixelFormatType_422YpCbCr8_yuvs, kCVPixelFormatType_32BGRA,
]

func modes(of device: AVCaptureDevice) -> [Mode] {
    var best: [String: Mode] = [:]
    for format in device.formats {
        let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
        let compressed = !uncompressed.contains(CMFormatDescriptionGetMediaSubType(format.formatDescription))
        for range in format.videoSupportedFrameRateRanges {
            // The range maximum plus the usual integer rates it contains. Integer durations are always inside the range.
            var rates: [(Double, CMTime)] = [(range.maxFrameRate, range.minFrameDuration)]
            for rate in [60.0, 30, 25, 24, 15] where rate < range.maxFrameRate - 0.5 && rate >= range.minFrameRate - 0.01 {
                rates.append((rate, CMTime(value: 1, timescale: CMTimeScale(rate))))
            }
            for (rate, duration) in rates {
                let fps = (rate * 100).rounded() / 100
                let id = "\(dimensions.width)x\(dimensions.height)@" + (fps == fps.rounded() ? String(Int(fps)) : String(fps))
                // Uncompressed frames skip the MJPEG decode, so they win a tie.
                if let existing = best[id], !existing.compressed || compressed { continue }
                best[id] = Mode(id: id, width: Int(dimensions.width), height: Int(dimensions.height), fps: fps, format: format, duration: duration, compressed: compressed)
            }
        }
    }
    return best.values.sorted { ($0.width * $0.height, $0.width, $0.fps) > ($1.width * $1.height, $1.width, $1.fps) }
}

/// 1080p or the largest size under it, at the highest rate up to 60: sharp enough for a webcam without 4K's bandwidth.
func defaultMode(_ list: [Mode]) -> Mode? {
    let fitting = list.filter { $0.width * $0.height <= 1920 * 1080 && $0.fps <= 60.5 }
    return fitting.max { ($0.width * $0.height, $0.fps) < ($1.width * $1.height, $1.fps) } ?? list.first
}

func kind(of device: AVCaptureDevice) -> String {
    switch device.deviceType {
    case .external: return "usb"
    case .continuityCamera: return "continuity"
    case .builtInWideAngleCamera: return "builtIn"
    case .deskViewCamera: return "deskView"
    default: return "other"
    }
}

func authorization(_ media: AVMediaType) -> String {
    switch AVCaptureDevice.authorizationStatus(for: media) {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    default: return "notDetermined"
    }
}

final class Camera: NSObject, AVCaptureFileOutputRecordingDelegate {
    private let queue = DispatchQueue(label: "org.buddytools.BuddyMac.camera", qos: .userInteractive, autoreleaseFrequency: .workItem)
    private let session = AVCaptureSession()
    private let movie = AVCaptureMovieFileOutput()
    private let cameras = AVCaptureDevice.DiscoverySession(deviceTypes: [.external, .continuityCamera, .builtInWideAngleCamera, .deskViewCamera], mediaType: .video, position: .unspecified)
    private let microphones = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone], mediaType: .audio, position: .unspecified)
    private let settingsURL: URL
    private var settings: Settings
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private var mode: Mode?
    private var preview = false
    private var recordingURL: URL?
    private var recordingStarted: Date?
    private var lastRecording: String?
    private var error = ""
    private var observers: [NSObjectProtocol] = []
    private var runtimeObserver: NSObjectProtocol?
    private var window: PreviewWindow?
    private var closed: DispatchSemaphore?
    /// Every state carries a number. A reply and an event can reach BuddyMac in one read, so it keeps the newest.
    private var version = 0

    override init() {
        let data = ProcessInfo.processInfo.environment["BUDDYMAC_DATA_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/BuddyMac")
        settingsURL = data.appendingPathComponent("Camera/settings.json")
        settings = (try? JSONDecoder().decode(Settings.self, from: Data(contentsOf: settingsURL))) ?? Settings()
        super.init()
        movie.movieFragmentInterval = CMTime(seconds: 10, preferredTimescale: 600)
        let center = NotificationCenter.default
        for name in [AVCaptureDevice.wasConnectedNotification, AVCaptureDevice.wasDisconnectedNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in self?.queue.async { self?.devicesChanged() } })
        }
        runtimeObserver = center.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { [weak self] note in
            let message = (note.userInfo?[AVCaptureSessionErrorKey] as? NSError)?.localizedDescription ?? "The camera stopped."
            self?.queue.async { self?.error = message; self?.publish() }
        }
    }

    // MARK: Requests

    func handle(_ method: String, _ request: [String: Any], reply: @escaping (Result<Any, Error>) -> Void) {
        // Ask for access first, off the camera queue: the prompt can stay up for minutes, and a blocked queue
        // would hold every other request, including the shutdown that finishes a recording.
        if let media = queue.sync(execute: { accessToAsk(method, request) }) {
            AVCaptureDevice.requestAccess(for: media) { [weak self] _ in self?.handle(method, request, reply: reply) }
            return
        }
        queue.async { [self] in
            do {
                switch method {
                case "state": reply(.success(state()))
                case "configure":
                    try configure(request)
                    reply(.success(state()))
                case "preview":
                    try setPreview(request["enabled"] as? Bool ?? !preview)
                    reply(.success(state()))
                case "record":
                    if request["enabled"] as? Bool ?? (recordingURL == nil) { try startRecording() } else { stopRecording() }
                    reply(.success(state()))
                case "recordings": reply(.success(recordings()))
                case "trash":
                    guard let path = request["path"] as? String, path.hasPrefix(folder().path + "/") else { throw failure("That file is not in the recordings folder.") }
                    try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
                    reply(.success(recordings()))
                case "chooseFolder":
                    DispatchQueue.main.async { [self] in
                        let panel = NSOpenPanel()
                        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
                        panel.prompt = "Use folder"; panel.directoryURL = folder()
                        NSApp.activate(ignoringOtherApps: true)
                        let chosen = panel.runModal() == .OK ? panel.url : nil
                        queue.async { [self] in
                            if let chosen { settings.folder = chosen.path; save() }
                            reply(.success(state()))
                        }
                    }
                case "previewWindow":
                    DispatchQueue.main.async { [self] in reply(.success(["windowNumber": window?.isVisible == true ? window!.windowNumber : 0])) }
                default: throw failure("Unknown camera request \(method).")
                }
            } catch { reply(.failure(error)) }
        }
    }

    private func accessToAsk(_ method: String, _ request: [String: Any]) -> AVMediaType? {
        let starting = method == "preview" ? request["enabled"] as? Bool ?? !preview : method == "record" ? request["enabled"] as? Bool ?? (recordingURL == nil) : false
        guard starting else { return nil }
        if AVCaptureDevice.authorizationStatus(for: .video) == .notDetermined { return .video }
        if method == "record", settings.microphone != nil, AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined { return .audio }
        return nil
    }

    /// Stops a running recording and waits for AVFoundation to close the file, so quitting never leaves a broken movie.
    func shutdown() {
        let done = DispatchSemaphore(value: 0)
        queue.async { [self] in
            if movie.isRecording { closed = done; movie.stopRecording() } else { session.stopRunning(); done.signal() }
        }
        _ = done.wait(timeout: .now() + 6)
    }

    // MARK: State

    private func currentDevice() -> AVCaptureDevice? {
        let devices = cameras.devices
        if let id = settings.device, let device = devices.first(where: { $0.uniqueID == id }) { return device }
        return devices.first { kind(of: $0) == "usb" } ?? devices.first { kind(of: $0) == "continuity" } ?? devices.first { $0.deviceType == .builtInWideAngleCamera } ?? devices.first
    }

    private func folder() -> URL {
        settings.folder.map { URL(fileURLWithPath: $0) } ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Movies/BuddyMac")
    }

    private func codec() -> AVVideoCodecType { settings.codec == "h264" ? .h264 : .hevc }

    private func state() -> [String: Any] {
        let device = currentDevice()
        let list = device.map(modes(of:)) ?? []
        version += 1
        let chosen = mode ?? list.first { $0.id == settings.mode } ?? defaultMode(list)
        return [
            "authorization": authorization(.video),
            "microphoneAuthorization": authorization(.audio),
            "devices": cameras.devices.map { ["id": $0.uniqueID, "name": $0.localizedName, "kind": kind(of: $0), "model": $0.modelID, "manufacturer": $0.manufacturer] },
            "microphones": microphones.devices.map { ["id": $0.uniqueID, "name": $0.localizedName] },
            "device": device?.uniqueID ?? NSNull(),
            "modes": list.map { ["id": $0.id, "width": $0.width, "height": $0.height, "fps": $0.fps, "compressed": $0.compressed] },
            "mode": chosen?.id ?? NSNull(),
            "mirror": settings.mirror ?? true,
            "microphone": settings.microphone ?? NSNull(),
            "codec": settings.codec ?? "hevc",
            "folder": folder().path,
            "preview": preview,
            "running": session.isRunning,
            "recording": recordingURL.map { ["path": $0.path, "startedAt": (recordingStarted ?? Date()).timeIntervalSince1970 * 1000] } ?? NSNull(),
            "lastRecording": lastRecording ?? NSNull(),
            "error": error,
            "version": version,
        ]
    }

    private func publish() {
        var value = state()
        value["event"] = "state"
        emit(value)
    }

    private func save() {
        try? FileManager.default.createDirectory(at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(settings) { try? data.write(to: settingsURL, options: .atomic) }
    }

    private func failure(_ message: String) -> NSError { NSError(domain: "BuddyMacCamera", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }

    // MARK: Session

    private var active: Bool { preview || recordingURL != nil }

    private func configure(_ request: [String: Any]) throws {
        var rebuild = false
        if let device = request["device"] as? String, device != currentDevice()?.uniqueID {
            if recordingURL != nil { throw failure("Stop recording before switching cameras.") }
            settings.device = device; settings.mode = nil; mode = nil; rebuild = true
        }
        if let id = request["mode"] as? String, id != mode?.id {
            if recordingURL != nil { throw failure("Stop recording before changing the resolution.") }
            settings.mode = id; mode = nil; rebuild = true
        }
        if let mirror = request["mirror"] as? Bool { settings.mirror = mirror; applyMirror() }
        if request.keys.contains("microphone") { settings.microphone = request["microphone"] as? String }
        if let codec = request["codec"] as? String, codec == "hevc" || codec == "h264" { settings.codec = codec }
        if let folder = request["folder"] as? String, folder.hasPrefix("/") {
            if recordingURL != nil { throw failure("Stop recording before changing the folder.") }
            settings.folder = folder
        }
        save()
        if rebuild && active { try startSession() }
    }

    private func setPreview(_ enabled: Bool) throws {
        if enabled == preview { return }
        if enabled { try startSession() }
        preview = enabled
        showWindow(enabled)
        if !active { stopSession() }
    }

    /// Builds the session for the chosen camera and mode and starts it. Called on the camera queue.
    private func startSession() throws {
        try requireAccess(.video, "BuddyMac can't use the camera. Allow it in System Settings › Privacy & Security › Camera.")
        guard let device = currentDevice() else { throw failure("No camera is connected.") }
        let list = modes(of: device)
        guard let chosen = list.first(where: { $0.id == settings.mode }) ?? defaultMode(list) else { throw failure("\(device.localizedName) reports no video formats.") }
        error = ""
        session.beginConfiguration()
        if videoInput?.device != device {
            if let videoInput { session.removeInput(videoInput) }
            let input = try AVCaptureDeviceInput(device: device)
            guard session.canAddInput(input) else { session.commitConfiguration(); throw failure("\(device.localizedName) is in use by another app.") }
            session.addInput(input)
            videoInput = input
        }
        session.commitConfiguration()
        try apply(chosen, to: device)
        if !session.isRunning { session.startRunning() }
        // Setting the format before the session runs can be undone when it starts. Check and apply it again.
        if device.activeFormat != chosen.format { try apply(chosen, to: device) }
        applyMirror()
        resizeWindow()
        publish()
    }

    private func apply(_ chosen: Mode, to device: AVCaptureDevice) throws {
        try device.lockForConfiguration()
        defer { device.unlockForConfiguration() }
        device.activeFormat = chosen.format
        device.activeVideoMinFrameDuration = chosen.duration
        device.activeVideoMaxFrameDuration = chosen.duration
        mode = chosen
    }

    private func stopSession() {
        if session.isRunning { session.stopRunning() }
        // Release the camera so its light goes off and other apps can take it.
        session.beginConfiguration()
        for input in session.inputs { session.removeInput(input) }
        session.commitConfiguration()
        videoInput = nil; audioInput = nil
        publish()
    }

    private func requireAccess(_ media: AVMediaType, _ message: String) throws {
        if AVCaptureDevice.authorizationStatus(for: media) != .authorized { throw failure(message) }
    }

    private func devicesChanged() {
        if let input = videoInput, !input.device.isConnected {
            // The camera was unplugged. AVFoundation closes the recording on its own; the delegate reports it.
            error = "\(input.device.localizedName) was disconnected."
            if session.isRunning { session.stopRunning() }
            session.removeInput(input)
            videoInput = nil
        }
        // The chosen camera came back, or another one took over as the default: pick up where it left off.
        if active && videoInput == nil, let device = currentDevice(), settings.device == nil || device.uniqueID == settings.device { try? startSession() }
        publish()
    }

    private func applyMirror() {
        let mirror = settings.mirror ?? true
        DispatchQueue.main.async { [weak self] in self?.window?.mirror(mirror) }
    }

    // MARK: Recording

    private func startRecording() throws {
        if recordingURL != nil { return }
        if settings.microphone != nil { try requireAccess(.audio, "BuddyMac can't use the microphone. Allow it in System Settings or record without sound.") }
        try startSession()
        session.beginConfiguration()
        if let id = settings.microphone, let microphone = microphones.devices.first(where: { $0.uniqueID == id }) {
            let input = try AVCaptureDeviceInput(device: microphone)
            if session.canAddInput(input) { session.addInput(input); audioInput = input }
        }
        if !session.outputs.contains(movie) {
            guard session.canAddOutput(movie) else { session.commitConfiguration(); throw failure("The camera can't record in this mode.") }
            session.addOutput(movie)
        }
        session.commitConfiguration()
        if let mode, let device = videoInput?.device, device.activeFormat != mode.format { try apply(mode, to: device) }
        guard let connection = movie.connection(with: .video) else { throw failure("The camera isn't delivering video.") }
        if connection.isVideoMirroringSupported { connection.automaticallyAdjustsVideoMirroring = false; connection.isVideoMirrored = false }
        // Without explicit dimensions the output follows the session preset and scales 720p up to 1080p.
        // The chosen mode's own size keeps frames at their native resolution, so nothing is scaled before encoding.
        var settings: [String: Any] = [AVVideoCodecKey: codec()]
        if let mode { settings[AVVideoWidthKey] = mode.width; settings[AVVideoHeightKey] = mode.height }
        movie.setOutputSettings(settings, for: connection)
        let directory = folder()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd 'at' HH.mm.ss"
        let url = directory.appendingPathComponent("BuddyMac Camera \(formatter.string(from: Date())).mov")
        movie.startRecording(to: url, recordingDelegate: self)
        recordingURL = url
        recordingStarted = Date()
        DispatchQueue.main.async { [weak self] in self?.window?.recording(since: Date()) }
        publish()
    }

    private func stopRecording() {
        if movie.isRecording { movie.stopRecording() }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo url: URL, from connections: [AVCaptureConnection], error: Error?) {
        queue.async { [self] in
            let finished = (error as NSError?)?.userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? (error == nil)
            if finished { lastRecording = url.path } else if let error { self.error = error.localizedDescription }
            recordingURL = nil; recordingStarted = nil
            session.beginConfiguration()
            // The movie output and microphone come off again so plain previews never hold the microphone.
            if let audioInput { session.removeInput(audioInput); self.audioInput = nil }
            session.removeOutput(movie)
            session.commitConfiguration()
            if let mode, let device = videoInput?.device, device.activeFormat != mode.format { try? apply(mode, to: device) }
            DispatchQueue.main.async { [weak self] in self?.window?.recording(since: nil) }
            if !active { stopSession() }
            var event: [String: Any] = ["event": "recorded", "path": url.path, "ok": finished]
            if !finished { event["error"] = self.error }
            emit(event)
            publish()
            closed?.signal()
        }
    }

    private func recordings() -> [[String: Any]] {
        let directory = folder()
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])) ?? []
        return files.filter { ["mov", "mp4", "m4v"].contains($0.pathExtension.lowercased()) && $0 != recordingURL }.compactMap { url in
            guard let values = try? url.resourceValues(forKeys: Set(keys)) else { return nil }
            return ["path": url.path, "name": url.lastPathComponent, "size": values.fileSize ?? 0, "modifiedAt": (values.contentModificationDate ?? Date()).timeIntervalSince1970 * 1000]
        }.sorted { ($0["modifiedAt"] as? Double ?? 0) > ($1["modifiedAt"] as? Double ?? 0) }
    }

    // MARK: Preview window

    private func showWindow(_ visible: Bool) {
        let size = mode.map { NSSize(width: $0.width, height: $0.height) } ?? NSSize(width: 16, height: 9)
        let mirror = settings.mirror ?? true
        DispatchQueue.main.async { [self] in
            if visible {
                if window == nil {
                    window = PreviewWindow(session: session, aspect: size, onClose: { [weak self] in self?.queue.async { try? self?.setPreview(false); self?.publish() } },
                        onRecord: { [weak self] in
                            DispatchQueue.global(qos: .userInitiated).async {
                                self?.handle("record", [:]) { result in if case .failure(let error) = result { self?.queue.async { self?.error = error.localizedDescription; self?.publish() } } }
                            }
                        })
                }
                window?.mirror(mirror)
                window?.aspect(size)
                window?.orderFrontRegardless()
            } else { window?.orderOut(nil) }
        }
    }

    private func resizeWindow() {
        guard let mode else { return }
        let size = NSSize(width: mode.width, height: mode.height)
        DispatchQueue.main.async { [weak self] in self?.window?.aspect(size) }
    }
}

/// A floating, borderless panel holding the preview layer. It never takes focus, follows every Space and stays
/// above full-screen apps, so it works as the face bubble while you record or share your screen.
final class PreviewWindow: NSPanel {
    private let content: PreviewView

    init(session: AVCaptureSession, aspect: NSSize, onClose: @escaping () -> Void, onRecord: @escaping () -> Void) {
        content = PreviewView(session: session, onClose: onClose, onRecord: onRecord)
        let width: CGFloat = 360
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let height = (width * aspect.height / max(aspect.width, 1)).rounded()
        super.init(contentRect: NSRect(x: screen.maxX - width - 24, y: screen.minY + 24, width: width, height: height),
            styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isMovableByWindowBackground = true
        hidesOnDeactivate = false
        hasShadow = true
        backgroundColor = .black
        isReleasedWhenClosed = false
        minSize = NSSize(width: 160, height: 90)
        contentView = content
        setFrameAutosaveName("BuddyMacCameraPreview")
        self.aspect(aspect)
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    func aspect(_ size: NSSize) {
        guard size.width > 0, size.height > 0 else { return }
        contentAspectRatio = size
        var frame = self.frame
        let height = (frame.width * size.height / size.width).rounded()
        if abs(height - frame.height) > 1 { frame.origin.y += frame.height - height; frame.size.height = height; setFrame(frame, display: true) }
    }
    func mirror(_ enabled: Bool) { content.mirror(enabled) }
    func recording(since start: Date?) { content.recording(since: start) }
}

final class PreviewView: NSView {
    private let layerView = AVCaptureVideoPreviewLayer()
    private let record = ControlButton(symbol: "record.circle", label: "Record")
    private let close = ControlButton(symbol: "xmark", label: "Hide preview")
    private let time = NSTextField(labelWithString: "")
    private let onClose: () -> Void
    private let onRecord: () -> Void
    private var timer: Timer?
    private var started: Date?
    private var mirrored = true

    init(session: AVCaptureSession, onClose: @escaping () -> Void, onRecord: @escaping () -> Void) {
        self.onClose = onClose
        self.onRecord = onRecord
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        layerView.session = session
        layerView.videoGravity = .resizeAspectFill
        layer?.addSublayer(layerView)
        for button in [record, close] { button.alphaValue = 0; addSubview(button) }
        record.target = self; record.action = #selector(recordPressed)
        close.target = self; close.action = #selector(closePressed)
        time.font = NSFont(name: "IBM Plex Mono", size: 12) ?? .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
        time.textColor = .white
        time.drawsBackground = true
        time.backgroundColor = NSColor(srgbRed: 0xd6 / 255, green: 0x54 / 255, blue: 0x4b / 255, alpha: 1)
        time.isHidden = true
        addSubview(time)
    }
    required init?(coder: NSCoder) { nil }

    override var mouseDownCanMoveWindow: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func layout() {
        super.layout()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        layerView.frame = bounds
        CATransaction.commit()
        close.frame = NSRect(x: bounds.maxX - 36, y: bounds.maxY - 36, width: 28, height: 28)
        record.frame = NSRect(x: bounds.midX - 18, y: 10, width: 36, height: 36)
        time.sizeToFit()
        time.frame = NSRect(x: 8, y: bounds.maxY - time.frame.height - 10, width: time.frame.width + 4, height: time.frame.height + 2)
    }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }
    override func mouseEntered(with event: NSEvent) { reveal(true) }
    override func mouseExited(with event: NSEvent) { reveal(false) }
    private func reveal(_ shown: Bool) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = shown ? 0.12 : 0.2
            for button in [record, close] { button.animator().alphaValue = shown ? 1 : 0 }
        }
    }

    func mirror(_ enabled: Bool) {
        mirrored = enabled
        guard let connection = layerView.connection, connection.isVideoMirroringSupported else { return }
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = enabled
    }

    func recording(since start: Date?) {
        started = start
        timer?.invalidate(); timer = nil
        record.symbol(start == nil ? "record.circle" : "stop.fill", label: start == nil ? "Record" : "Stop recording")
        time.isHidden = start == nil
        // The layer gets its connection once the session has an input; apply the mirror setting again now that it has one.
        mirror(mirrored)
        guard start != nil else { return }
        tick()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    }
    private func tick() {
        guard let started else { return }
        let seconds = Int(Date().timeIntervalSince(started))
        time.stringValue = String(format: " %d:%02d ", seconds / 60, seconds % 60)
        needsLayout = true
    }

    @objc private func recordPressed() { onRecord() }
    @objc private func closePressed() { onClose() }
}

final class ControlButton: NSButton {
    init(symbol: String, label: String) {
        super.init(frame: .zero)
        isBordered = false
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.withAlphaComponent(0.72).cgColor
        contentTintColor = .white
        imageScaling = .scaleProportionallyDown
        self.symbol(symbol, label: label)
    }
    required init?(coder: NSCoder) { nil }
    func symbol(_ name: String, label: String) {
        image = NSImage(systemSymbolName: name, accessibilityDescription: label)?.withSymbolConfiguration(.init(pointSize: 14, weight: .semibold))
        setAccessibilityLabel(label)
        toolTip = label
    }
    override var mouseDownCanMoveWindow: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

@main
struct CameraMain {
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let camera = Camera()
        DispatchQueue.global(qos: .userInitiated).async {
            // This loop is one work item for the helper's whole life, so each line gets its own pool.
            while let line = readLine() { autoreleasepool {
                guard let request = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any],
                      let id = request["id"] as? Int, let method = request["method"] as? String else { return }
                camera.handle(method, request) { result in
                    switch result {
                    case .success(let value): emit(["id": id, "ok": true, "result": value])
                    case .failure(let error): emit(["id": id, "ok": false, "error": error.localizedDescription])
                    }
                }
            } }
            // BuddyMac closed the pipe. Finish any recording so the file is playable, then exit.
            camera.shutdown()
            exit(0)
        }
        application.run()
    }
}
