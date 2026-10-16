import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assets = root.appendingPathComponent("assets")
guard let source = NSImage(contentsOf: assets.appendingPathComponent("icon-source.png")) else {
    fatalError("Missing source artwork")
}
func bitmap(_ size: Int, scale: CGFloat = 1, paint: () -> Void) throws -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: CGFloat(size) / scale, height: CGFloat(size) / scale)
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = context
    // The bitmap context already maps its logical point size to Retina pixels.
    paint()
    NSGraphicsContext.restoreGraphicsState()
    return rep
}
func save(_ rep: NSBitmapImageRep, _ url: URL) throws {
    guard let data = rep.representation(using: .png, properties: [:]) else { fatalError("PNG encoding failed") }
    try data.write(to: url)
}
// Crop the supplied tile, retaining its artwork and removing the surrounding background.
let icon = try bitmap(1024) {
    let tile = NSRect(x: 64, y: 64, width: 896, height: 896)
    NSBezierPath(roundedRect: tile, xRadius: 174, yRadius: 174).addClip()
    source.draw(in: tile, from: NSRect(x: 110, y: 115, width: 1032, height: 1054),
        operation: .copy, fraction: 1, respectFlipped: false, hints: [.interpolation: NSImageInterpolation.high])
}
try save(icon, assets.appendingPathComponent("kotonoha.png"))
// A simple monochrome leaf/speech silhouette remains recognizable at menu-bar sizes.
for scale in [1, 2] {
    let image = try bitmap(18 * scale, scale: CGFloat(scale)) {
        NSColor.black.setFill()
        let leaf = NSBezierPath()
        leaf.move(to: NSPoint(x: 2, y: 3))
        leaf.curve(to: NSPoint(x: 16, y: 16), controlPoint1: NSPoint(x: 0, y: 13), controlPoint2: NSPoint(x: 10, y: 17))
        leaf.curve(to: NSPoint(x: 2, y: 3), controlPoint1: NSPoint(x: 17, y: 5), controlPoint2: NSPoint(x: 10, y: 0))
        leaf.fill()
        let vein = NSBezierPath()
        vein.move(to: NSPoint(x: 3, y: 3)); vein.line(to: NSPoint(x: 12.8, y: 12.8))
        vein.lineWidth = 1.35
        NSColor.clear.setStroke()
        NSGraphicsContext.current!.compositingOperation = .clear
        vein.stroke()
        NSGraphicsContext.current!.compositingOperation = .sourceOver
    }
    try save(image, assets.appendingPathComponent(scale == 1 ? "menuTemplate.png" : "menuTemplate@2x.png"))
}
print("Exported cropped app artwork and 1x/2x menu-bar template images.")
