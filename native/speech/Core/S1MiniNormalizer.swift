import Foundation
import llama

public actor S1MiniNormalizer {
    private var loaded: NativeModel?
    private let modelURL: URL

    public init(modelURL: URL) { self.modelURL = modelURL }

    public func unload() { loaded = nil }

    public func prepare() throws {
        _ = try normalize("um", style: .natural)
    }

    public func normalize(_ transcript: String, style: DictationStyle) throws -> String {
        try Task.checkCancellation()
        guard !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        guard transcript.utf8.count <= 32_000 else { throw S1MiniError.tooLong }
        let prompt = try S1MiniPrompt.make(transcript, style: style)
        if loaded == nil {
            try S1MiniModel.verify(modelURL)
            loaded = try NativeModel(url: modelURL)
        }
        guard let loaded else { throw S1MiniError.initialization }
        return try loaded.normalize(transcript: transcript, prompt: prompt)
    }
}

private final class NativeModel {
    private let model: OpaquePointer
    private let vocab: OpaquePointer
    private static let backend: Void = {
        llama_log_set({ _, _, _ in }, nil)
        llama_backend_init()
    }()

    init(url: URL) throws {
        _ = Self.backend
        var parameters = llama_model_default_params()
        #if arch(arm64)
        parameters.n_gpu_layers = 99
        #else
        parameters.n_gpu_layers = 0
        #endif
        guard let model = llama_model_load_from_file(url.path, parameters) else {
            throw S1MiniError.initialization
        }
        self.model = model
        self.vocab = llama_model_get_vocab(model)
    }

    deinit { llama_model_free(model) }

    func normalize(transcript: String, prompt: String) throws -> String {
        let inputCount = try tokenize(transcript, special: false).count
        guard inputCount <= 1_000 else { throw S1MiniError.tooLong }
        var tokens = try tokenize(prompt, special: true)
        let outputLimit = Int(Double(inputCount) * 1.3) + 32
        var parameters = llama_context_default_params()
        parameters.n_ctx = UInt32(tokens.count + outputLimit + 64)
        parameters.n_batch = 256
        parameters.n_ubatch = 256
        parameters.n_threads = Int32(max(1, min(6, ProcessInfo.processInfo.activeProcessorCount - 2)))
        parameters.n_threads_batch = parameters.n_threads
        parameters.no_perf = true
        guard let context = llama_init_from_model(model, parameters) else { throw S1MiniError.initialization }
        defer { llama_free(context) }
        guard let sampler = llama_sampler_init_greedy() else { throw S1MiniError.initialization }
        defer { llama_sampler_free(sampler) }
        let deadline = ContinuousClock.now.advanced(by: .seconds(30))
        func check() throws {
            try Task.checkCancellation()
            guard ContinuousClock.now < deadline else { throw S1MiniError.timedOut }
        }
        for start in stride(from: 0, to: tokens.count, by: 256) {
            try check()
            let count = min(256, tokens.count - start)
            let status = tokens.withUnsafeMutableBufferPointer { buffer in
                llama_decode(context, llama_batch_get_one(buffer.baseAddress!.advanced(by: start), Int32(count)))
            }
            guard status == 0 else { throw S1MiniError.inference }
        }
        var output = [UInt8]()
        for _ in 0..<outputLimit {
            try check()
            var token = llama_sampler_sample(sampler, context, -1)
            if llama_vocab_is_eog(vocab, token) {
                guard let text = String(bytes: output, encoding: .utf8), !text.contains("<|") else {
                    throw S1MiniError.inference
                }
                return text.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            output.append(contentsOf: try piece(token))
            let status = withUnsafeMutablePointer(to: &token) {
                llama_decode(context, llama_batch_get_one($0, 1))
            }
            guard status == 0 else { throw S1MiniError.inference }
        }
        throw S1MiniError.inference
    }

    private func tokenize(_ text: String, special: Bool) throws -> [llama_token] {
        var tokens = [llama_token](repeating: 0, count: text.utf8.count + 8)
        let count = llama_tokenize(vocab, text, Int32(text.utf8.count), &tokens, Int32(tokens.count), false, special)
        guard count >= 0 else { throw S1MiniError.inference }
        return Array(tokens.prefix(Int(count)))
    }

    private func piece(_ token: llama_token) throws -> [UInt8] {
        var buffer = [CChar](repeating: 0, count: 128)
        var count = llama_token_to_piece(vocab, token, &buffer, Int32(buffer.count), 0, false)
        if count < 0 {
            buffer = [CChar](repeating: 0, count: Int(-count))
            count = llama_token_to_piece(vocab, token, &buffer, Int32(buffer.count), 0, false)
        }
        guard count >= 0 else { throw S1MiniError.inference }
        return buffer.prefix(Int(count)).map { UInt8(bitPattern: $0) }
    }
}
