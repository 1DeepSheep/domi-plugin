import Foundation
import AVFoundation
import Darwin

private func emit(_ value: [String: Any], toStderr: Bool = false) {
    guard JSONSerialization.isValidJSONObject(value),
          let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
          let line = String(data: data, encoding: .utf8) else {
        return
    }
    let output = line + "\n"
    if toStderr {
        FileHandle.standardError.write(output.data(using: .utf8)!)
    } else {
        FileHandle.standardOutput.write(output.data(using: .utf8)!)
    }
}

private func permissionName(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "granted"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not_determined"
    @unknown default: return "unknown"
    }
}

private func value(after flag: String, in args: [String]) -> String? {
    guard let index = args.firstIndex(of: flag), index + 1 < args.count else { return nil }
    return args[index + 1]
}

private func matchesStopRequest(at url: URL, sessionId: String, token: String) -> Bool {
    guard let data = try? Data(contentsOf: url),
          let object = try? JSONSerialization.jsonObject(with: data),
          let request = object as? [String: Any],
          request["sessionId"] as? String == sessionId,
          request["token"] as? String == token else {
        return false
    }
    return true
}

private func writePrivateJSON(_ value: [String: Any], to url: URL) throws {
    guard JSONSerialization.isValidJSONObject(value) else {
        throw NSError(domain: "DomiMacRecording", code: 20, userInfo: [
            NSLocalizedDescriptionKey: "Ready receipt is not valid JSON"
        ])
    }
    if FileManager.default.fileExists(atPath: url.path) {
        throw NSError(domain: "DomiMacRecording", code: 21, userInfo: [
            NSLocalizedDescriptionKey: "Ready receipt already exists"
        ])
    }
    var data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    data.append(0x0A)
    let temporaryURL = url.deletingLastPathComponent().appendingPathComponent(
        ".\(url.lastPathComponent).tmp-\(UUID().uuidString)"
    )
    defer { try? FileManager.default.removeItem(at: temporaryURL) }
    guard FileManager.default.createFile(
        atPath: temporaryURL.path,
        contents: data,
        attributes: [.posixPermissions: 0o600]
    ) else {
        throw NSError(domain: "DomiMacRecording", code: 22, userInfo: [
            NSLocalizedDescriptionKey: "Could not create private ready receipt"
        ])
    }
    try FileManager.default.moveItem(at: temporaryURL, to: url)
}

private func writeReadyAcknowledgement(_ value: [String: Any]) throws {
    guard JSONSerialization.isValidJSONObject(value) else {
        throw NSError(domain: "DomiMacRecording", code: 23, userInfo: [
            NSLocalizedDescriptionKey: "Readiness acknowledgement is not valid JSON"
        ])
    }
    var data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    data.append(0x0A)
    let handle = FileHandle(fileDescriptor: 3, closeOnDealloc: false)
    try handle.write(contentsOf: data)
    try handle.close()
}

private final class RecorderSession: NSObject, AVAudioRecorderDelegate, @unchecked Sendable {
    private let recorder: AVAudioRecorder
    private let finalURL: URL
    private let workingURL: URL
    private var startedAt = Date()
    private let finishLock = NSLock()
    private var finishing = false

    init(finalURL: URL) throws {
        self.finalURL = finalURL
        self.workingURL = finalURL.deletingPathExtension().appendingPathExtension("partial.m4a")

        if FileManager.default.fileExists(atPath: finalURL.path) ||
            FileManager.default.fileExists(atPath: workingURL.path) {
            throw NSError(domain: "DomiMacRecording", code: 10, userInfo: [
                NSLocalizedDescriptionKey: "Output or partial file already exists"
            ])
        }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 128_000,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        self.recorder = try AVAudioRecorder(url: workingURL, settings: settings)
        super.init()
        self.recorder.delegate = self
    }

    func start() throws -> [String: Any] {
        guard recorder.prepareToRecord(), recorder.record() else {
            throw NSError(domain: "DomiMacRecording", code: 11, userInfo: [
                NSLocalizedDescriptionKey: "AVAudioRecorder could not start"
            ])
        }
        startedAt = Date()
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: workingURL.path)
        let event: [String: Any] = [
            "event": "recording_started",
            "outputPath": finalURL.path,
            "startedAt": ISO8601DateFormatter().string(from: startedAt),
            "workingPath": workingURL.path,
        ]
        emit(event)
        return event
    }

    func finish(
        reason: String,
        exitCode: Int32 = 0,
        errorMessage: String? = nil,
        finalizeAudioOnError: Bool = false
    ) {
        finishLock.lock()
        if finishing {
            finishLock.unlock()
            return
        }
        finishing = true
        finishLock.unlock()

        recorder.stop()

        if exitCode != 0 && !finalizeAudioOnError {
            if FileManager.default.fileExists(atPath: workingURL.path) {
                try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: workingURL.path)
            }
            emit([
                "code": "RECORDING_FAILED",
                "error": errorMessage ?? "Recording stopped because of \(reason)",
                "event": "error",
                "partialPath": workingURL.path,
            ], toStderr: true)
            fflush(stderr)
            Darwin.exit(exitCode)
        }

        do {
            guard FileManager.default.fileExists(atPath: workingURL.path) else {
                throw NSError(domain: "DomiMacRecording", code: 12, userInfo: [
                    NSLocalizedDescriptionKey: "Partial recording file is missing"
                ])
            }
            try FileManager.default.moveItem(at: workingURL, to: finalURL)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: finalURL.path)
            emit([
                "audioPath": finalURL.path,
                "durationSec": Date().timeIntervalSince(startedAt),
                "event": "recording_stopped",
                "reason": reason,
                "stoppedAt": ISO8601DateFormatter().string(from: Date()),
                "successful": exitCode == 0,
            ])
            fflush(stdout)
            if exitCode != 0 {
                emit([
                    "audioPath": finalURL.path,
                    "code": "EXTERNAL_TERMINATION",
                    "error": errorMessage ?? "Recording was interrupted by \(reason)",
                    "event": "error",
                ], toStderr: true)
                fflush(stderr)
            }
            Darwin.exit(exitCode)
        } catch {
            emit([
                "code": "FINALIZE_FAILED",
                "error": error.localizedDescription,
                "event": "error",
                "partialPath": workingURL.path,
            ], toStderr: true)
            fflush(stderr)
            Darwin.exit(6)
        }
    }

    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        finish(
            reason: "encode_error",
            exitCode: 7,
            errorMessage: error?.localizedDescription ?? "Unknown encoder error"
        )
    }

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        finish(
            reason: flag ? "recorder_finished" : "recorder_failed",
            exitCode: flag ? 0 : 8,
            errorMessage: flag ? nil : "AVAudioRecorder finished unsuccessfully"
        )
    }
}

@main
private struct DomiMacRecorder {
    static func requestPermission() async -> Bool {
        let current = AVCaptureDevice.authorizationStatus(for: .audio)
        if current == .authorized { return true }
        if current == .denied || current == .restricted { return false }
        return await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())
        guard let command = args.first else {
            emit([
                "code": "USAGE",
                "error": "Expected permission, authorize, verify-stop-request, or record"
            ], toStderr: true)
            Darwin.exit(2)
        }

        if command == "permission" {
            emit(["permission": permissionName(AVCaptureDevice.authorizationStatus(for: .audio))])
            return
        }

        if command == "authorize" {
            let granted = await requestPermission()
            let status = permissionName(AVCaptureDevice.authorizationStatus(for: .audio))
            emit(["granted": granted, "permission": status])
            if !granted { Darwin.exit(3) }
            return
        }

        if command == "verify-stop-request" {
            guard let stopFile = value(after: "--stop-file", in: args),
                  let sessionId = value(after: "--session-id", in: args),
                  let token = value(after: "--token", in: args) else {
                emit(["code": "USAGE", "error": "verify-stop-request requires stop file, session, and token"], toStderr: true)
                Darwin.exit(2)
            }
            let matches = matchesStopRequest(
                at: URL(fileURLWithPath: stopFile).standardizedFileURL,
                sessionId: sessionId,
                token: token
            )
            emit(["matches": matches])
            if !matches { Darwin.exit(4) }
            return
        }

        guard command == "record",
              let output = value(after: "--output", in: args),
              let stopFile = value(after: "--stop-file", in: args),
              let readyFile = value(after: "--ready-file", in: args),
              let sessionId = value(after: "--session-id", in: args),
              let token = value(after: "--token", in: args) else {
            emit([
                "code": "USAGE",
                "error": "record requires --output, --stop-file, --ready-file, --session-id, and --token"
            ], toStderr: true)
            Darwin.exit(2)
        }

        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            emit(["code": "MIC_PERMISSION_DENIED", "error": "Microphone permission is not granted"], toStderr: true)
            Darwin.exit(3)
        }

        _ = Darwin.umask(0o077)

        do {
            let finalURL = URL(fileURLWithPath: output).standardizedFileURL
            let stopRequestURL = URL(fileURLWithPath: stopFile).standardizedFileURL
            let readyReceiptURL = URL(fileURLWithPath: readyFile).standardizedFileURL
            let session = try RecorderSession(finalURL: finalURL)

            signal(SIGINT, SIG_IGN)
            signal(SIGTERM, SIG_IGN)

            let interruptSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
            interruptSource.setEventHandler {
                session.finish(
                    reason: "external_sigint",
                    exitCode: 9,
                    errorMessage: "Recorder received SIGINT outside the authenticated stop flow",
                    finalizeAudioOnError: true
                )
            }
            interruptSource.resume()

            let terminateSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
            terminateSource.setEventHandler {
                session.finish(
                    reason: "external_sigterm",
                    exitCode: 10,
                    errorMessage: "Recorder received SIGTERM outside the authenticated stop flow",
                    finalizeAudioOnError: true
                )
            }
            terminateSource.resume()

            let stopRequestSource = DispatchSource.makeTimerSource(queue: .main)
            stopRequestSource.schedule(
                deadline: .now() + .milliseconds(100),
                repeating: .milliseconds(100),
                leeway: .milliseconds(20)
            )
            stopRequestSource.setEventHandler {
                if matchesStopRequest(at: stopRequestURL, sessionId: sessionId, token: token) {
                    session.finish(reason: "stop_request")
                }
            }
            stopRequestSource.resume()
            defer { stopRequestSource.cancel() }

            var readyReceipt = try session.start()
            readyReceipt["sessionId"] = sessionId
            readyReceipt["token"] = token
            readyReceipt["readyAt"] = ISO8601DateFormatter().string(from: Date())
            do {
                try writePrivateJSON(readyReceipt, to: readyReceiptURL)
                var acknowledgement = readyReceipt
                acknowledgement.removeValue(forKey: "token")
                acknowledgement["pid"] = Int(getpid())
                try writeReadyAcknowledgement(acknowledgement)
            } catch {
                session.finish(
                    reason: "ready_receipt_failed",
                    exitCode: 11,
                    errorMessage: error.localizedDescription
                )
                return
            }

            if let rawSeconds = value(after: "--max-seconds", in: args),
               let seconds = Double(rawSeconds), seconds > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
                    session.finish(reason: "duration_limit")
                }
            }

            while true {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
            }
        } catch {
            emit([
                "code": "RECORDING_START_FAILED",
                "error": error.localizedDescription,
                "event": "error",
                "outputPath": output,
            ], toStderr: true)
            Darwin.exit(5)
        }
    }
}
