import AVFAudio
import CoreGraphics
import CoreMedia
import Darwin
import Foundation
import ScreenCaptureKit

private func diagnostic(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}

private func permissionDenied(_ error: Error) -> Bool {
    let failure = error as NSError
    return failure.domain == SCStreamErrorDomain
        && failure.code == SCStreamError.Code.userDeclined.rawValue
}

private struct CaptureError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// The audio callback queue exclusively owns the converter and its resampling state.
private final class PCMEncoder {
    private let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true
    )!
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?

    func encode(_ input: AVAudioPCMBuffer?) throws -> Data {
        if let input, inputFormat != input.format {
            guard converter == nil else {
                throw CaptureError(message: "The capture audio format changed. Restart capture.")
            }
            converter = AVAudioConverter(from: input.format, to: outputFormat)
            inputFormat = input.format
            // Continuous streaming must not wait for a future input buffer to prime output.
            converter?.primeMethod = .none
        }
        guard let converter else { return Data() }
        var suppliedInput = false
        var result = Data()
        while true {
            guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: 8192) else {
                throw CaptureError(message: "Unable to allocate the audio conversion buffer.")
            }
            var error: NSError?
            let status = converter.convert(to: output, error: &error) { _, inputStatus in
                if let input, !suppliedInput {
                    suppliedInput = true
                    inputStatus.pointee = .haveData
                    return input
                }
                inputStatus.pointee = input == nil ? .endOfStream : .noDataNow
                return nil
            }
            if let error { throw error }
            if output.frameLength > 0, let samples = output.int16ChannelData?[0] {
                // This target is arm64 only; native Int16 is little endian.
                result.append(Data(bytes: samples, count: Int(output.frameLength) * MemoryLayout<Int16>.size))
            }
            switch status {
            case .haveData: continue
            case .inputRanDry, .endOfStream: return result
            case .error: throw CaptureError(message: "AVAudioConverter failed without an error message.")
            @unknown default: throw CaptureError(message: "Unexpected AVAudioConverter output status.")
            }
        }
    }

    func encode(_ sample: CMSampleBuffer) throws -> Data {
        guard let description = CMSampleBufferGetFormatDescription(sample) else {
            throw CaptureError(message: "ScreenCaptureKit returned an unsupported audio format.")
        }
        let format = AVAudioFormat(cmAudioFormatDescription: description)
        let count = CMSampleBufferGetNumSamples(sample)
        guard count > 0 else { return Data() }
        guard count <= Int(Int32.max),
              let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)) else {
            throw CaptureError(message: "Unable to allocate the captured PCM buffer.")
        }
        input.frameLength = AVAudioFrameCount(count)
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sample, at: 0, frameCount: Int32(count), into: input.mutableAudioBufferList
        )
        guard status == noErr else {
            throw CaptureError(message: "Cannot copy captured PCM audio (OSStatus \(status)).")
        }
        return try encode(input)
    }
}

private final class AudioOutput: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let queue = DispatchQueue(label: "jp.realtime-translation.audio.pcm")
    private let encoder = PCMEncoder()
    private let stopped: AsyncStream<Int32>.Continuation
    private var failed = false

    init(stopped: AsyncStream<Int32>.Continuation) { self.stopped = stopped }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .audio, CMSampleBufferDataIsReady(sampleBuffer), !failed else { return }
        do {
            let pcm = try encoder.encode(sampleBuffer)
            try FileHandle.standardOutput.write(contentsOf: pcm)
        } catch {
            failed = true
            diagnostic("audio-capture: \(error.localizedDescription)")
            stopped.yield(3)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        if permissionDenied(error) {
            diagnostic("audio-capture: capture_permission_required")
        } else {
            diagnostic("audio-capture: ScreenCaptureKit stopped: \(error.localizedDescription)")
        }
        stopped.yield(2)
    }

    func finish() {
        queue.sync {
            guard !failed else { return }
            do {
                let tail = try encoder.encode(nil as AVAudioPCMBuffer?)
                try FileHandle.standardOutput.write(contentsOf: tail)
            } catch {
                diagnostic("audio-capture: final audio flush: \(error.localizedDescription)")
            }
        }
    }
}

private func selfTest() throws {
    let encoder = PCMEncoder()
    let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
    var pcm = Data()
    for chunk in 0..<10 {
        let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800)!
        input.frameLength = 4800
        for channel in 0..<2 {
            for frame in 0..<4800 {
                input.floatChannelData![channel][frame] = Float(
                    0.25 * sin(2 * Double.pi * 1000 * Double(chunk * 4800 + frame) / 48_000)
                )
            }
        }
        pcm.append(try encoder.encode(input))
    }
    pcm.append(try encoder.encode(nil as AVAudioPCMBuffer?))
    guard abs(pcm.count - 32_000) <= 128, pcm.count.isMultiple(of: 2) else {
        throw CaptureError(message: "Self-test resampling length failed: \(pcm.count) bytes.")
    }
    let samples: [Int16] = stride(from: 0, to: pcm.count, by: 2).map { offset in
        Int16(bitPattern: UInt16(pcm[offset]) | UInt16(pcm[offset + 1]) << 8)
    }
    let rms = sqrt(samples.reduce(0.0) { sum, sample in
        sum + pow(Double(sample) / 32768, 2)
    } / Double(samples.count))
    guard rms > 0.16, rms < 0.19 else {
        throw CaptureError(message: "Self-test stereo downmix amplitude failed: RMS \(rms).")
    }
    let crossings = zip(samples, samples.dropFirst()).filter { $0 < 0 && $1 >= 0 }.count
    guard abs(crossings - 1000) <= 4 else {
        throw CaptureError(message: "Self-test sample rate or byte order failed: \(crossings) crossings.")
    }
    diagnostic("audio-capture: self-test passed (48 kHz stereo → 16 kHz mono PCM16 LE, \(samples.count) samples, RMS \(rms)).")
}

@main
private struct AudioCapture {
    static func main() async {
        signal(SIGPIPE, SIG_IGN)
        let args = Array(CommandLine.arguments.dropFirst())
        if args == ["--check"] || args == ["--request-permission"] {
            // Permission setup is separate from capture and never creates an SCStream.
            let allowed = CGPreflightScreenCaptureAccess()
                || (args == ["--request-permission"] && CGRequestScreenCaptureAccess())
            print("{\"available\":\(allowed),\"permission\":\"\(allowed ? "granted" : "required")\",\"sample_rate\":16000,\"channels\":1,\"format\":\"pcm_s16le\"}")
            return
        }
        if args == ["--self-test"] {
            do { try selfTest() } catch {
                diagnostic("audio-capture: \(error.localizedDescription)")
                exit(1)
            }
            return
        }
        if !args.isEmpty {
            diagnostic("Usage: audio-capture [--check | --request-permission | --self-test]\nDefault: system audio as raw 16 kHz mono PCM16 little endian on stdout.")
            exit(64)
        }

        // Missing access returns to the setup UI; capture must not request permission.
        guard CGPreflightScreenCaptureAccess() else {
            diagnostic("audio-capture: capture_permission_required")
            exit(77)
        }
        let events = AsyncStream<Int32>.makeStream()
        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)
        let signals = [SIGINT, SIGTERM].map { number in
            let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
            source.setEventHandler { events.continuation.yield(0) }
            source.resume()
            return source
        }
        defer { signals.forEach { $0.cancel() }; events.continuation.finish() }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = content.displays.first else {
                throw CaptureError(message: "No display is available for a ScreenCaptureKit audio stream.")
            }
            let configuration = SCStreamConfiguration()
            // No screen output is registered and no video frames are recorded or written.
            configuration.width = 2
            configuration.height = 2
            configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            configuration.queueDepth = 3
            configuration.showsCursor = false
            configuration.capturesAudio = true
            configuration.captureMicrophone = false
            configuration.excludesCurrentProcessAudio = true
            configuration.sampleRate = 48_000
            configuration.channelCount = 2
            let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
            let output = AudioOutput(stopped: events.continuation)
            let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
            try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: output.queue)
            try await stream.startCapture()
            diagnostic("audio-capture: started (system audio → 16 kHz mono PCM16 LE).")
            var code: Int32 = 0
            for await event in events.stream {
                code = event
                break
            }
            try await stream.stopCapture()
            output.finish()
            diagnostic("audio-capture: stopped.")
            exit(code)
        } catch {
            if permissionDenied(error) {
                diagnostic("audio-capture: capture_permission_required")
                exit(77)
            }
            diagnostic("audio-capture: \(error.localizedDescription)")
            exit(1)
        }
    }
}
