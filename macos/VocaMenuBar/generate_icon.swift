import AppKit

func drawIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()

    // Background
    let rect = NSRect(x: size * 0.1, y: size * 0.1, width: size * 0.8, height: size * 0.8)
    let path = NSBezierPath(roundedRect: rect, xRadius: size * 0.18, yRadius: size * 0.18)
    
    // Draw gradient
    if let gradient = NSGradient(colors: [
        NSColor(red: 0.15, green: 0.39, blue: 0.92, alpha: 1.0),
        NSColor(red: 0.11, green: 0.31, blue: 0.85, alpha: 1.0)
    ]) {
        gradient.draw(in: path, angle: -90)
    }

    // Draw V
    let vPath = NSBezierPath()
    let vWidth = size * 0.4
    let vHeight = size * 0.35
    let vX = (size - vWidth) / 2
    let vY = size * 0.32

    vPath.move(to: NSPoint(x: vX, y: vY + vHeight))
    vPath.line(to: NSPoint(x: size / 2, y: vY))
    vPath.line(to: NSPoint(x: vX + vWidth, y: vY + vHeight))
    
    vPath.lineWidth = size * 0.08
    vPath.lineCapStyle = .round
    vPath.lineJoinStyle = .round
    
    NSColor.white.setStroke()
    vPath.stroke()

    image.unlockFocus()
    return image
}

let sizes: [Int] = [16, 32, 64, 128, 256, 512, 1024]
let iconsetDir = "AppIcon.iconset"
let fm = FileManager.default

if !fm.fileExists(atPath: iconsetDir) {
    try? fm.createDirectory(atPath: iconsetDir, withIntermediateDirectories: true)
}

for size in sizes {
    let image = drawIcon(size: CGFloat(size))
    if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff) {
        if let png = bitmap.representation(using: .png, properties: [:]) {
            let url = URL(fileURLWithPath: "\(iconsetDir)/icon_\(size)x\(size).png")
            try? png.write(to: url)
        }
    }
    
    if size < 512 {
        let image2x = drawIcon(size: CGFloat(size * 2))
        if let tiff2x = image2x.tiffRepresentation, let bitmap2x = NSBitmapImageRep(data: tiff2x) {
            if let png2x = bitmap2x.representation(using: .png, properties: [:]) {
                let url2x = URL(fileURLWithPath: "\(iconsetDir)/icon_\(size)x\(size)@2x.png")
                try? png2x.write(to: url2x)
            }
        }
    }
}
print("Generated AppIcon.iconset")
