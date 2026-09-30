import AppKit
import Foundation

@main
struct SpeechMain {
    @MainActor static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        do {
            let service = try SpeechService()
            DispatchQueue.global(qos: .userInitiated).async {
                while let line = readLine() {
                    let data = Data(line.utf8)
                    DispatchQueue.main.async { service.receive(data) }
                }
                DispatchQueue.main.async { service.shutdown(); application.terminate(nil) }
            }
            application.run()
        } catch {
            let message = ["event": "error", "message": "Speech data could not be imported. Original data is unchanged. " + error.localizedDescription]
            if let bytes = try? JSONSerialization.data(withJSONObject: message) { try? FileHandle.standardOutput.write(contentsOf: bytes + Data([10])) }
            exit(1)
        }
    }
}
