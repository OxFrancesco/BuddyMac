import Foundation

enum MultipartBody {
    static func encode(_ input: TranscriptionRequest, language: String?, boundary: String) -> Data {
        var body = Data()
        func append(_ string: String) { body.append(contentsOf: string.utf8) }
        func field(_ name: String, _ value: String) {
            append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
        }
        field("model", input.model)
        field("response_format", "json")
        if let language { field("language", language) }
        let unsafe = CharacterSet(charactersIn: "\"\\\r\n")
        let filename = input.fileName.components(separatedBy: unsafe).joined(separator: "_")
        let mimeType = input.mimeType.range(of: "^audio/[a-zA-Z0-9.+-]+$", options: .regularExpression) != nil
            ? input.mimeType : "application/octet-stream"
        append("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n")
        append("Content-Type: \(mimeType)\r\n\r\n")
        body.append(input.audio)
        append("\r\n--\(boundary)--\r\n")
        return body
    }
}
