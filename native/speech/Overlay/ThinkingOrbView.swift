import SwiftUI

struct OrbRGB: Equatable, Sendable {
    var red: Double
    var green: Double
    var blue: Double

    init(hex: UInt32) {
        red = Double((hex >> 16) & 0xFF) / 255
        green = Double((hex >> 8) & 0xFF) / 255
        blue = Double(hex & 0xFF) / 255
    }

    func mixed(with other: OrbRGB, amount: Double, alpha: Double) -> Color {
        Color(red: red + (other.red - red) * amount,
              green: green + (other.green - green) * amount,
              blue: blue + (other.blue - blue) * amount,
              opacity: alpha)
    }

    var color: Color { Color(red: red, green: green, blue: blue) }
}

/// BuddyMac's palette, matching `C` in `src/ui.tsx`. The pill colour lives here so
/// the overlay and the orb agree.
struct ThinkingOrbColors: Equatable, Sendable {
    var accent = OrbRGB(hex: 0xD6544B)
    var dots = OrbRGB(hex: 0xFFFFFF)
    var pill = OrbRGB(hex: 0x000000)
    var label = OrbRGB(hex: 0xFFFFFF)
    var muted = OrbRGB(hex: 0xB3B3B3)
    var line = OrbRGB(hex: 0x222222)

    static let buddyMac = ThinkingOrbColors()
}

/// Frame clock owned by the orb. Integrating speed here keeps the band from
/// jumping when audio energy changes the tempo between frames.
final class OrbClock {
    private var lastDate: Date?
    private(set) var time = 0.0
    private(set) var energy = 0.0

    func advance(to date: Date, speed: Double, targetEnergy: Double) -> (time: Double, energy: Double) {
        let delta = lastDate.map { min(0.1, max(0, date.timeIntervalSince($0))) } ?? 0
        lastDate = date
        // Fast attack, slower release, so a word lands right away and fades out gently.
        let rate = targetEnergy > energy ? 18.0 : 6.0
        energy += (targetEnergy - energy) * min(1, delta * rate)
        time += delta * speed * (1 + 0.9 * energy)
        return (time, energy)
    }
}

/// Native port of the Thinking Orbs band. Draws with Canvas; no assets.
struct ThinkingOrbView: View {
    var parameters = ThinkingOrbParameters.thinking
    var colors = ThinkingOrbColors.buddyMac
    var size: CGFloat = 44
    /// 0…1 microphone energy. Widens and brightens the band while speaking.
    var energy = 0.0
    var paused = false
    var label = "Thinking"

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var clock = OrbClock()

    var body: some View {
        TimelineView(.animation(paused: paused || reduceMotion)) { context in
            Canvas(rendersAsynchronously: false) { graphics, canvasSize in
                let frame = clock.advance(to: context.date, speed: parameters.speed, targetEnergy: energy)
                var live = parameters
                live.speed = 1
                live.spread = parameters.spread * (1 + 0.20 * frame.energy)
                live.dotScale = parameters.dotScale * (1 + 0.28 * frame.energy)
                live.opacity = min(1, parameters.opacity * (0.88 + 0.12 * frame.energy))
                let dots = ThinkingOrbGeometry.band(size: min(canvasSize.width, canvasSize.height),
                                                    time: frame.time, parameters: live)
                for dot in dots {
                    let rect = CGRect(x: dot.x - dot.radius, y: dot.y - dot.radius, width: dot.radius * 2, height: dot.radius * 2)
                    graphics.fill(Path(ellipseIn: rect), with: .color(colors.dots.mixed(with: colors.accent, amount: dot.accent, alpha: dot.alpha)))
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(label)
    }
}
