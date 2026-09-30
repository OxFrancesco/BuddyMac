import AppKit
import Foundation
let destination=CommandLine.arguments[1]
let image=NSImage(size:NSSize(width:1024,height:1024))
image.lockFocus()
NSColor.black.setFill()
NSBezierPath(roundedRect:NSRect(x:64,y:64,width:896,height:896),xRadius:192,yRadius:192).fill()
NSColor.white.setStroke()
let frame=NSBezierPath(rect:NSRect(x:236,y:246,width:552,height:532));frame.lineWidth=20;frame.stroke()
for row in 0..<3 { for column in 0..<2 {
 let rect=NSRect(x:286+column*248,y:304+row*150,width:204,height:106)
 if row==2 && column==0 {NSColor(srgbRed:214/255,green:84/255,blue:75/255,alpha:1).setFill()} else {NSColor.white.setFill()}
 NSBezierPath(rect:rect).fill()
}}
image.unlockFocus()
let bitmap=NSBitmapImageRep(data:image.tiffRepresentation!)!
try bitmap.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:destination))
