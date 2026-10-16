import AppKit
import Foundation

struct Mask {
    let rep: NSBitmapImageRep
    let alpha: [Double]
    let bounds: [Int]
}
func inspect(_ path: String) throws -> Mask {
    guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
          let rep = NSBitmapImageRep(data: data) else {
        throw NSError(domain: "MenuIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing icon: \(path)"])
    }
    var alpha = [Double]()
    var bounds = [rep.pixelsWide, rep.pixelsHigh, -1, -1]
    for y in 0..<rep.pixelsHigh {
        for x in 0..<rep.pixelsWide {
            let value = Double(rep.colorAt(x: x, y: y)!.alphaComponent)
            alpha.append(value)
            if value > 0.02 {
                bounds[0] = min(bounds[0], x); bounds[1] = min(bounds[1], y)
                bounds[2] = max(bounds[2], x); bounds[3] = max(bounds[3], y)
            }
        }
    }
    print("\(path): \(rep.pixelsWide)×\(rep.pixelsHigh) pixels, \(rep.size.width)×\(rep.size.height) points, bounds \(bounds)")
    return Mask(rep: rep, alpha: alpha, bounds: bounds)
}
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw NSError(domain: "MenuIcon", code: 2, userInfo: [NSLocalizedDescriptionKey: message]) }
}
do {
    let prefix = CommandLine.arguments.dropFirst().first ?? "assets"
    let normal = try inspect("\(prefix)/menuTemplate.png")
    let retina = try inspect("\(prefix)/menuTemplate@2x.png")
    try require(normal.rep.pixelsWide == 18 && normal.rep.pixelsHigh == 18, "1x pixel dimensions are incorrect")
    try require(retina.rep.pixelsWide == 36 && retina.rep.pixelsHigh == 36, "2x pixel dimensions are incorrect")
    for mask in [normal, retina] {
        try require(abs(mask.rep.size.width - 18) < 0.1 && abs(mask.rep.size.height - 18) < 0.1, "Logical menu size must remain 18×18 points")
        try require(mask.bounds[0] > 0 && mask.bounds[1] > 0 && mask.bounds[2] < mask.rep.pixelsWide - 1 && mask.bounds[3] < mask.rep.pixelsHigh - 1, "Icon touches its canvas edge: artwork is clipped")
    }
    var difference = 0.0
    for y in 0..<18 {
        for x in 0..<18 {
            var sum = 0.0
            for dy in 0..<2 {
                for dx in 0..<2 { sum += retina.alpha[(2 * y + dy) * 36 + 2 * x + dx] }
            }
            let high = sum / 4
            difference += abs(normal.alpha[y * 18 + x] - high)
        }
    }
    let mean = difference / 324
    try require(mean < 0.07, "1x and downsampled 2x silhouettes differ: \(mean)")
    print("PASS: transparent margins, equal logical size, and matching silhouettes (mean alpha difference \(String(format: "%.4f", mean))).")
} catch {
    fputs("FAIL: \(error.localizedDescription)\n", stderr)
    exit(1)
}
