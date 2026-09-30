import AppKit
import CoreText
import Observation
import SwiftUI

/// A permission the last dictation was missing. The pill and the Talk page offer a button for each.
enum OverlayNeed: String, CaseIterable, Sendable {
    case accessibility, screenRecording, microphone

    var buttonTitle: String {
        switch self {
        case .accessibility: "Allow insertion"
        case .screenRecording: "Allow Screen Recording"
        case .microphone: "Allow microphone"
        }
    }

    var help: String {
        switch self {
        case .accessibility: "Allow Accessibility so BuddyMac can type into the field you were using."
        case .screenRecording: "Allow Screen Recording so Talk can send the active window with cleanup and voice edits."
        case .microphone: "Allow the microphone so Talk can hear you."
        }
    }
}

@MainActor
@Observable
final class DictationOverlayModel {
    var phase = DictationPhase.idle
    var audioLevel = 0.0
    var elapsed: TimeInterval = 0
    var targetAppName: String?
    var isEditingSelection = false
    var message = ""
    var needs: [OverlayNeed] = []
    var finishShortcut = ""
    var cancelShortcut = ""
    @ObservationIgnored var onStop: () -> Void = {}
    @ObservationIgnored var onCancel: () -> Void = {}
    @ObservationIgnored var onAllow: (OverlayNeed) -> Void = { _ in }

    var insertionNeedsAccessibility: Bool { needs.contains(.accessibility) }
}

/// BuddyTalk's floating dictation pill, owned by the speech helper so it follows the recorder directly.
/// It appears at the bottom of the screen with the pointer and never takes focus from the app being dictated into.
@MainActor
final class DictationOverlay {
    let model = DictationOverlayModel()
    var enabled = false { didSet { if !enabled { hide() } } }
    private var panel: NSPanel?
    private var generation = 0
    private var clock: Task<Void, Never>?
    private var dismissal: Task<Void, Never>?
    private var previewing = false

    /// Resets the pill for a new dictation. Nothing appears until the recorder reaches a visible phase.
    func begin(targetAppName: String?, editing: Bool, finishShortcut: String, cancelShortcut: String) {
        previewing = false
        dismissal?.cancel()
        model.targetAppName = targetAppName
        model.isEditingSelection = editing
        model.message = ""
        model.needs = []
        model.elapsed = 0
        model.audioLevel = 0
        model.finishShortcut = finishShortcut
        model.cancelShortcut = cancelShortcut
    }

    func show(_ phase: DictationPhase) {
        model.phase = phase
        clock?.cancel()
        if phase == .recording {
            let started = Date()
            clock = Task { [weak self] in
                while !Task.isCancelled {
                    self?.model.elapsed = Date().timeIntervalSince(started)
                    try? await Task.sleep(for: .milliseconds(100))
                }
            }
        }
        switch phase {
        case .requestingPermission: break
        case .recording, .transcribing, .formatting, .inserting:
            dismissal?.cancel()
            present()
        case .success, .failed:
            present()
            let linger: Duration = !model.needs.isEmpty ? .seconds(7) : phase == .success ? .seconds(2) : .seconds(4)
            dismissal?.cancel()
            dismissal = Task { [weak self] in
                try? await Task.sleep(for: linger)
                guard !Task.isCancelled else { return }
                self?.hide()
            }
        case .idle: hide()
        }
    }

    /// Shows one phase with synthetic values so the pill can be checked without a microphone or provider.
    /// Returns the panel's window number for `screencapture -l`.
    func preview(_ phase: DictationPhase, targetAppName: String?, message: String, needs: [OverlayNeed]) -> Int {
        begin(targetAppName: targetAppName, editing: false, finishShortcut: "", cancelShortcut: "")
        previewing = true
        model.message = message
        model.needs = needs
        model.phase = phase
        clock?.cancel()
        if phase == .idle { hide(); return 0 }
        if phase == .recording {
            let started = Date()
            clock = Task { [weak self] in
                while !Task.isCancelled {
                    let time = Date().timeIntervalSince(started)
                    let syllable = abs(sin(time * 7.3)) * abs(sin(time * 1.9))
                    self?.model.elapsed = time
                    self?.model.audioLevel = sin(time * 0.8) > -0.3 ? 0.04 + 0.28 * syllable : 0.01
                    try? await Task.sleep(for: .milliseconds(60))
                }
            }
        }
        present()
        return panel?.windowNumber ?? 0
    }

    func hide() {
        dismissal?.cancel()
        clock?.cancel()
        previewing = false
        guard let panel, panel.isVisible else { return }
        generation += 1
        let token = generation
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.22
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            Task { @MainActor in
                guard let self, self.generation == token else { return }
                panel.orderOut(nil)
            }
        })
    }

    private func present() {
        guard enabled || previewing else { return }
        let panel = panel ?? makePanel()
        generation += 1
        guard !panel.isVisible || panel.alphaValue < 1 else { return }
        if !panel.isVisible {
            let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
            if let screen {
                panel.setFrameOrigin(NSPoint(x: screen.visibleFrame.midX - panel.frame.width / 2, y: screen.visibleFrame.minY + 24))
            }
            panel.alphaValue = 0
        }
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            panel.animator().alphaValue = 1
        }
    }

    private func makePanel() -> NSPanel {
        OverlayFont.register()
        // Wider than the pill so it can grow between phases without clipping.
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 640, height: 110),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.title = "BuddyMac Dictation"
        // Keep the panel at its fixed size and centre the pill inside it, so the
        // pill stays put as it grows and shrinks between phases.
        let hosting = NSHostingView(rootView: DictationOverlayView(model: model).frame(maxWidth: .infinity, maxHeight: .infinity))
        hosting.sizingOptions = []
        hosting.frame = NSRect(origin: .zero, size: panel.contentRect(forFrameRect: panel.frame).size)
        hosting.autoresizingMask = [.width, .height]
        panel.contentView = hosting
        self.panel = panel
        return panel
    }
}

/// IBM Plex Mono ships in BuddyMac's resources. The helper registers it for its own process.
@MainActor
enum OverlayFont {
    static let name = "IBMPlexMono-Regular"
    private static var registered = false

    static func register() {
        guard !registered else { return }
        registered = true
        let directory = Bundle.main.executableURL?.resolvingSymlinksInPath().deletingLastPathComponent()
        let candidates = [
            directory?.appendingPathComponent("../Resources/fonts/IBMPlexMono-Regular.ttf"),
            directory?.appendingPathComponent("../../../assets/fonts/IBMPlexMono-Regular.ttf"),
        ].compactMap { $0?.standardizedFileURL }
        guard let url = candidates.first(where: { FileManager.default.fileExists(atPath: $0.path) }) else { return }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }

    static func mono(_ size: CGFloat) -> Font { .custom(name, size: size) }
}

/// The floating pill shown while dictating. Orb on the left, one line of text,
/// then the controls that matter for the current phase.
struct DictationOverlayView: View {
    var model: DictationOverlayModel
    @State private var hovering = false
    private let colors = ThinkingOrbColors.buddyMac

    var body: some View {
        HStack(spacing: 10) {
            leading
                .frame(width: 44, height: 44)

            HStack(spacing: 6) {
                Text(title)
                    .font(OverlayFont.mono(13))
                    .foregroundStyle(colors.label.color)
                    .contentTransition(.opacity)
                if let detail {
                    Text(detail)
                        .font(OverlayFont.mono(13))
                        .foregroundStyle(colors.muted.color)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                }
            }
            .lineLimit(1)
            .frame(maxWidth: 260, alignment: .leading)
            .fixedSize()

            trailing
        }
        .padding(.leading, 8)
        .padding(.trailing, 10)
        .padding(.vertical, 7)
        .background(colors.pill.color, in: .rect)
        .overlay { Rectangle().strokeBorder(hovering ? colors.muted.color.opacity(0.5) : colors.line.color) }
        .shadow(color: .black.opacity(0.28), radius: 14, y: 6)
        .animation(.spring(duration: 0.38, bounce: 0.18), value: model.phase)
        .animation(.easeOut(duration: 0.16), value: hovering)
        .onHover { hovering = $0 }
        .padding(20)
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("BuddyMac \(model.phase.title)")
    }

    // MARK: Pieces

    @ViewBuilder
    private var leading: some View {
        switch model.phase {
        case .recording:
            ThinkingOrbView(parameters: .listening, colors: colors, size: 44,
                            energy: OrbEnergy.fromLevel(model.audioLevel), label: "Listening")
                .transition(.scale(scale: 0.6).combined(with: .opacity))
        case .requestingPermission, .transcribing, .formatting, .inserting:
            ThinkingOrbView(parameters: .thinking, colors: colors, size: 44, label: model.phase.title)
                .transition(.scale(scale: 0.6).combined(with: .opacity))
        case .success:
            glyph(model.insertionNeedsAccessibility ? "doc.on.clipboard" : "checkmark",
                  tint: model.insertionNeedsAccessibility ? colors.accent.color : colors.label.color)
        case .failed:
            glyph("exclamationmark", tint: colors.accent.color)
        case .idle:
            ThinkingOrbView(parameters: .thinking, colors: colors, size: 44, paused: true, label: "Idle")
        }
    }

    private func glyph(_ symbol: String, tint: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(colors.pill.color)
            .frame(width: 26, height: 26)
            .background(tint, in: .rect)
            .transition(.scale(scale: 0.4).combined(with: .opacity))
            .accessibilityHidden(true)
    }

    private var title: String {
        switch model.phase {
        case .recording: model.isEditingSelection ? "Editing" : "Listening"
        case .success: model.insertionNeedsAccessibility ? "Copied" : "Done"
        default: model.phase.title
        }
    }

    private var detail: String? {
        switch model.phase {
        case .recording: return durationLabel(model.elapsed)
        case .success:
            if model.insertionNeedsAccessibility { return model.targetAppName.map { "· for \($0)" } }
            return firstSentence
        case .failed: return model.needs.isEmpty ? firstSentence : nil
        case .transcribing, .formatting, .inserting:
            return model.targetAppName.map { "· \($0)" }
        default: return nil
        }
    }

    private var firstSentence: String? {
        guard let sentence = model.message.split(separator: ".").first else { return nil }
        let text = sentence.trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? nil : "· \(text)"
    }

    @ViewBuilder
    private var trailing: some View {
        HStack(spacing: 6) {
            if model.phase == .recording {
                HoverButton(action: model.onStop) { hovered in
                    Image(systemName: "stop.fill")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(colors.pill.color)
                        .frame(width: 28, height: 28)
                        .background(hovered ? colors.accent.color : colors.label.color, in: .rect)
                }
                .help(model.finishShortcut.isEmpty ? "Finish dictation" : "Finish dictation · \(model.finishShortcut)")
                .accessibilityLabel("Finish dictation")
                .transition(.scale(scale: 0.5).combined(with: .opacity))
            }

            if model.phase == .success || model.phase == .failed {
                ForEach(model.needs, id: \.self) { need in
                    HoverButton(action: { model.onAllow(need) }) { hovered in
                        Text(need.buttonTitle)
                            .font(OverlayFont.mono(12))
                            .foregroundStyle(colors.pill.color)
                            .padding(.horizontal, 11)
                            .padding(.vertical, 6)
                            .background(hovered ? colors.accent.color : colors.label.color, in: .rect)
                    }
                    .help(need.help)
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
                }
            }

            if model.phase.isBusy {
                HoverButton(action: model.onCancel) { hovered in
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(hovered ? colors.label.color : colors.muted.color.opacity(0.7))
                        .frame(width: 26, height: 26)
                        .background(hovered ? colors.line.color : .clear, in: .rect)
                        .contentShape(.rect)
                }
                .disabled(model.phase == .inserting)
                .help(model.cancelShortcut.isEmpty ? "Cancel dictation" : "Cancel dictation · \(model.cancelShortcut)")
                .accessibilityLabel("Cancel dictation")
                .transition(.opacity)
            }
        }
    }
}

private struct HoverButton<Label: View>: View {
    let action: () -> Void
    @ViewBuilder let label: (Bool) -> Label
    @State private var hovering = false

    var body: some View {
        Button(action: action) { label(hovering) }
            .buttonStyle(.plain)
            .focusEffectDisabled()
            .onHover { hovering = $0 }
            .animation(.easeOut(duration: 0.12), value: hovering)
    }
}

enum OrbEnergy {
    /// Microphone level arrives as a linear 0…1 amplitude, where normal speech
    /// sits around 0.05–0.3. Lift it so the orb reacts to a normal voice.
    static func fromLevel(_ level: Double) -> Double {
        let clamped = min(1, max(0, level))
        return min(1, pow(clamped, 0.55) * 1.7)
    }
}

func durationLabel(_ duration: TimeInterval) -> String {
    let seconds = max(0, Int(duration))
    return String(format: "%d:%02d", seconds / 60, seconds % 60)
}
