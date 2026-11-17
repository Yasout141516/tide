// Spike M0d: does Apple's AVFoundation (what Apple Books uses) see the chapters in a Tide .m4b?
// Usage: swift scripts/check-chapters.swift <file.m4b> <expected chapter count>
// Prints the chapter count and titles; exits 1 if the count differs. Needs macOS 12+.
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count == 3, let expected = Int(args[2]) else {
  FileHandle.standardError.write("usage: check-chapters.swift <file.m4b> <expected count>\n".data(using: .utf8)!)
  exit(2)
}

let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
do {
  let groups = try await asset.loadChapterMetadataGroups(bestMatchingPreferredLanguages: ["en"])
  print("AVFoundation chapters: \(groups.count)")
  for (i, group) in groups.enumerated() {
    let titleItem = AVMetadataItem.metadataItems(
      from: group.items, filteredByIdentifier: .commonIdentifierTitle
    ).first ?? group.items.first(where: { $0.commonKey == .commonKeyTitle })
    var title = "<no title>"
    if let item = titleItem, let s = try? await item.load(.stringValue) { title = s }
    let start = CMTimeGetSeconds(group.timeRange.start)
    let dur = CMTimeGetSeconds(group.timeRange.duration)
    print(String(format: "  %d. %@  (start %.3f s, duration %.3f s)", i + 1, title, start, dur))
  }
  if groups.count != expected {
    print("FAIL: expected \(expected) chapters")
    exit(1)
  }
  print("OK: \(expected) chapters")
} catch {
  print("FAIL: could not load chapters: \(error)")
  exit(1)
}
