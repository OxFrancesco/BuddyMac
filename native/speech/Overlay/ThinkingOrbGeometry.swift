import Foundation

/// Parameters mirrored from the Metal Forge thinking-orbs preset and its Kotlin port.
struct ThinkingOrbParameters: Equatable, Sendable {
    var speed = 1.0
    var reverse = false
    var phase = 0.0
    var spin = 0.0
    var yaw = 0.0
    var pitch = 0.0
    var dots = 1.0
    var spread = 1.0
    var dotScale = 1.0
    var perspective = 1.0
    var depthSize = 1.0
    var depthFade = 1.0
    var opacity = 1.0

    /// Slow, calm band for transcription and cleanup.
    static let thinking = ThinkingOrbParameters(speed: 0.72, dots: 0.78, spread: 0.92, perspective: 0.9)

    /// Faster spinning band while the microphone is open.
    static let listening = ThinkingOrbParameters(speed: 1.8, spin: 1, dots: 0.86, spread: 0.96, perspective: 0.92)
}

struct OrbDot: Equatable, Sendable {
    var x: Double
    var y: Double
    var z: Double
    var radius: Double
    var alpha: Double
    var accent: Double
}

/// Pure geometry. The view only paints the returned, depth-sorted dots.
enum ThinkingOrbGeometry {
    private static let baseLanes = 12.0
    private static let baseSegments = 44.0
    private static let baseGhostDots = 38.0
    private static let minRadius = 0.3

    /// `time` is the animation clock in seconds. Callers that vary
    /// `speed` over time should accumulate it themselves and pass `speed = 1`.
    static func band(size: Double, time: Double, parameters: ThinkingOrbParameters = ThinkingOrbParameters()) -> [OrbDot] {
        precondition(size > 0, "size must be positive")

        let direction = parameters.reverse ? -1.0 : 1.0
        let t = (time * parameters.speed + parameters.phase * 2 * .pi) * direction
        let center = size / 2
        let radius = center * 0.78 * clamp(parameters.spread, 0.35, 1.45)
        let density = sqrt(clamp(parameters.dots, 0.1, 3))
        let lanes = max(2, Int((baseLanes * density).rounded()))
        let segments = max(12, Int((baseSegments * density).rounded()))
        let ghostCount = max(0, Int((baseGhostDots * clamp(parameters.dots, 0, 3)).rounded()))
        let cameraPitch = 0.30 + parameters.pitch * .pi
        let cameraYaw = parameters.yaw * .pi + t * 0.10 * parameters.spin
        let radiusScale = pow(size / 300, 0.6) * clamp(parameters.dotScale, 0.2, 3)
        var output: [OrbDot] = []
        output.reserveCapacity(ghostCount + lanes * segments)

        for index in 0..<ghostCount {
            let direction3D = fibonacciDirection(index, count: ghostCount)
            let projected = project(direction3D * radius, yaw: cameraYaw, pitch: cameraPitch,
                                    center: center, radius: radius, perspective: parameters.perspective)
            let depth = normalizedDepth(projected.z, radius: radius)
            output.append(OrbDot(
                x: projected.x, y: projected.y, z: projected.z,
                radius: max(minRadius, 0.68 * radiusScale),
                alpha: clamp(parameters.opacity * depthAlpha(0.10 + 0.22 * depth, fade: parameters.depthFade), 0, 1),
                accent: 0))
        }

        let planeYaw = t * 0.24 * parameters.spin
        let planeTilt = 0.55 + 0.30 * sin(t * 0.18) * parameters.spin
        let u = Vec3(x: cos(planeYaw), y: 0, z: sin(planeYaw))
        let v = Vec3(x: -u.z * sin(planeTilt), y: cos(planeTilt), z: u.x * sin(planeTilt))
        let normal = u.cross(v)
        let halfLanes = Double(lanes - 1) / 2

        for lane in 0..<lanes {
            let laneOffset = (Double(lane) - halfLanes) * 0.075 * parameters.spread
            let edge = abs(Double(lane) - halfLanes) / max(1, halfLanes)
            let accentCenter = fraction(t * 0.075 + Double(lane) / Double(lanes))

            for segment in 0..<segments {
                let angularPosition = Double(segment) / Double(segments)
                let angle = angularPosition * 2 * .pi
                let wobble = (0.16 * sin(angle * 3 - t * 1.7 + Double(lane) * 0.22)
                    + 0.07 * sin(angle * 5 + t * 1.1)) * parameters.spread
                let point = (u * cos(angle) + v * sin(angle) + normal * (laneOffset + wobble)).normalized() * radius
                let projected = project(point, yaw: cameraYaw, pitch: cameraPitch,
                                        center: center, radius: radius, perspective: parameters.perspective)
                let depth = normalizedDepth(projected.z, radius: radius)
                let baseRadius = 0.935 + 1.445 * lerp(0.5, depth, parameters.depthSize)
                let alpha = depthAlpha(0.40 + 0.60 * depth, fade: parameters.depthFade)
                let accentDistance = circularDistance(angularPosition, accentCenter)
                let accent = smoothStep(0.22, 0.02, accentDistance) * (1 - edge * 0.45)

                output.append(OrbDot(
                    x: projected.x, y: projected.y, z: projected.z,
                    radius: max(minRadius, baseRadius * (1 - 0.25 * edge) * radiusScale),
                    alpha: clamp(parameters.opacity * alpha, 0, 1),
                    accent: clamp(accent, 0, 1)))
            }
        }

        output.sort { $0.z < $1.z }
        return output
    }

    private static func project(_ point: Vec3, yaw: Double, pitch: Double, center: Double,
                                radius: Double, perspective: Double) -> Vec3 {
        let rotatedX = point.x * cos(yaw) + point.z * sin(yaw)
        let rotatedZ = -point.x * sin(yaw) + point.z * cos(yaw)
        let rotatedY = point.y * cos(pitch) - rotatedZ * sin(pitch)
        let depth = point.y * sin(pitch) + rotatedZ * cos(pitch)
        let perspectiveAmount = clamp(perspective, 0, 2) * 0.20
        let scale = 1 + depth / max(1, radius) * perspectiveAmount
        return Vec3(x: center + rotatedX * scale, y: center - rotatedY * scale, z: depth)
    }

    private static func depthAlpha(_ base: Double, fade: Double) -> Double {
        clamp(lerp(1, base, clamp(fade, 0, 2)), 0, 1)
    }

    private static func normalizedDepth(_ z: Double, radius: Double) -> Double {
        clamp((z / radius + 1) / 2, 0, 1)
    }

    private static func fibonacciDirection(_ index: Int, count: Int) -> Vec3 {
        let golden = Double.pi * (3 - sqrt(5.0))
        let y = 1 - 2 * (Double(index) + 0.5) / Double(count)
        let radial = sqrt(1 - y * y)
        let angle = Double(index) * golden
        return Vec3(x: radial * cos(angle), y: y, z: radial * sin(angle))
    }

    private static func circularDistance(_ a: Double, _ b: Double) -> Double {
        let direct = abs(a - b)
        return min(direct, 1 - direct)
    }

    private static func smoothStep(_ edge0: Double, _ edge1: Double, _ value: Double) -> Double {
        let x = clamp((value - edge0) / (edge1 - edge0), 0, 1)
        return x * x * (3 - 2 * x)
    }

    private static func fraction(_ value: Double) -> Double { value - floor(value) }
    private static func lerp(_ start: Double, _ end: Double, _ amount: Double) -> Double { start + (end - start) * amount }
    private static func clamp(_ value: Double, _ lower: Double, _ upper: Double) -> Double { min(upper, max(lower, value)) }

    private struct Vec3 {
        var x: Double
        var y: Double
        var z: Double

        static func + (lhs: Vec3, rhs: Vec3) -> Vec3 { Vec3(x: lhs.x + rhs.x, y: lhs.y + rhs.y, z: lhs.z + rhs.z) }
        static func * (lhs: Vec3, scale: Double) -> Vec3 { Vec3(x: lhs.x * scale, y: lhs.y * scale, z: lhs.z * scale) }

        func cross(_ other: Vec3) -> Vec3 {
            Vec3(x: y * other.z - z * other.y, y: z * other.x - x * other.z, z: x * other.y - y * other.x)
        }

        func normalized() -> Vec3 {
            let length = sqrt(x * x + y * y + z * z)
            return Vec3(x: x / length, y: y / length, z: z / length)
        }
    }
}
