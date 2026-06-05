import AppKit
import Carbon
import ServiceManagement
import SwiftUI
import UserNotifications

struct ServerCard: Identifiable, Decodable, Equatable {
  var id: String { file }
  let word: String
  let file: String
  let partOfSpeech: String?
  let topic: String?
  let meaningEn: String?
  let meaningVi: String?
  let pronunciation: String?
  let slug: String?
}

struct CardsResponse: Decodable {
  let cards: [ServerCard]
}

@main
struct VocaMenuBarApp {
  static func main() {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)

    let delegate = AppDelegate()
    app.delegate = delegate
    app.run()
  }
}



@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
  private var statusItem: NSStatusItem!
  private let popover = NSPopover()
  private let runner = VocaRunner()
  private var hotKeyRef: EventHotKeyRef?
  private var eventHandler: EventHandlerRef?

  func applicationDidFinishLaunching(_ notification: Notification) {
    setupMainMenu()
    statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    statusItem.button?.image = Self.menuBarIcon()
    statusItem.button?.imagePosition = .imageOnly
    statusItem.button?.target = self
    statusItem.button?.action = #selector(togglePopover)

    popover.behavior = .transient
    popover.animates = true
    popover.contentViewController = NSHostingController(rootView: VocaPopoverView(runner: runner))

    runner.onShortcutChanged = { [weak self] in
      self?.registerHotKey()
    }
    runner.onSizeChanged = { [weak self] size in
      DispatchQueue.main.async {
        self?.popover.contentSize = size
      }
    }
    registerHotKey()
  }

  private func setupMainMenu() {
    let mainMenu = NSMenu()
    let editMenuItem = NSMenuItem()
    mainMenu.addItem(editMenuItem)

    let editMenu = NSMenu(title: "Edit")
    editMenuItem.submenu = editMenu

    editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
    editMenu.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
    editMenu.addItem(NSMenuItem.separator())
    editMenu.addItem(withTitle: "Cut", action: Selector(("cut:")), keyEquivalent: "x")
    editMenu.addItem(withTitle: "Copy", action: Selector(("copy:")), keyEquivalent: "c")
    editMenu.addItem(withTitle: "Paste", action: Selector(("paste:")), keyEquivalent: "v")
    editMenu.addItem(withTitle: "Select All", action: Selector(("selectAll:")), keyEquivalent: "a")

    NSApplication.shared.mainMenu = mainMenu
  }

  func applicationWillTerminate(_ notification: Notification) {
    runner.stopLocalAPI()
  }

  private static func menuBarIcon() -> NSImage {
    if let image = NSImage(systemSymbolName: "character.book.closed", accessibilityDescription: "Voca Dictionary") {
      image.isTemplate = true
      return image
    }

    let size = NSSize(width: 22, height: 22)
    let image = NSImage(size: size)
    image.lockFocus()

    NSColor.clear.setFill()
    NSRect(origin: .zero, size: size).fill()

    let v = NSBezierPath()
    v.move(to: NSPoint(x: 6, y: 15))
    v.line(to: NSPoint(x: 11, y: 6))
    v.line(to: NSPoint(x: 16, y: 15))
    v.lineWidth = 2.0
    v.lineCapStyle = .round
    v.lineJoinStyle = .round
    NSColor.labelColor.setStroke()
    v.stroke()

    image.unlockFocus()
    image.isTemplate = true
    return image
  }

  @objc private func togglePopover() {
    togglePopoverFromHotKey()
  }

  private func togglePopoverFromHotKey() {
    guard let button = statusItem.button else { return }
    if popover.isShown {
      popover.performClose(nil)
    } else {
      runner.showCreatePage()
      runner.resetVisibleStateForOpen()
      
      NSApplication.shared.activate(ignoringOtherApps: true)
      
      popover.contentViewController?.view.layoutSubtreeIfNeeded()
      if let size = popover.contentViewController?.view.fittingSize {
        popover.contentSize = NSSize(width: 320, height: size.height)
      }
      
      popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
      NotificationCenter.default.post(name: .focusVocaInput, object: nil)
    }
  }

  private func registerHotKey() {
    if let hotKeyRef {
      UnregisterEventHotKey(hotKeyRef)
      self.hotKeyRef = nil
    }

    if eventHandler == nil {
      var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: OSType(kEventHotKeyPressed))
      let selfPointer = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
      InstallEventHandler(GetApplicationEventTarget(), { _, _, userData in
        guard let userData else { return noErr }
        let delegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
        Task { @MainActor in
          delegate.togglePopoverFromHotKey()
        }
        return noErr
      }, 1, &eventType, selfPointer, &eventHandler)
    }

    let hotKeyID = EventHotKeyID(signature: OSType(0x564F4341), id: 1)
    var newHotKey: EventHotKeyRef?
    let status = RegisterEventHotKey(
      UInt32(runner.shortcut.keyCode),
      runner.shortcut.carbonModifiers,
      hotKeyID,
      GetApplicationEventTarget(),
      0,
      &newHotKey
    )
    if status == noErr {
      hotKeyRef = newHotKey
    } else {
      runner.logLines.append("Could not register shortcut: \(status)")
    }
  }
}

extension Notification.Name {
  static let focusVocaInput = Notification.Name("focusVocaInput")
}

struct KeyboardShortcutSetting: Equatable {
  var keyCode: Int
  var modifiers: NSEvent.ModifierFlags

  static let defaultValue = KeyboardShortcutSetting(keyCode: kVK_ANSI_V, modifiers: [.option])

  var carbonModifiers: UInt32 {
    var flags: UInt32 = 0
    if modifiers.contains(.command) { flags |= UInt32(cmdKey) }
    if modifiers.contains(.option) { flags |= UInt32(optionKey) }
    if modifiers.contains(.control) { flags |= UInt32(controlKey) }
    if modifiers.contains(.shift) { flags |= UInt32(shiftKey) }
    return flags
  }

  var label: String {
    var parts: [String] = []
    if modifiers.contains(.control) { parts.append("⌃") }
    if modifiers.contains(.option) { parts.append("⌥") }
    if modifiers.contains(.shift) { parts.append("⇧") }
    if modifiers.contains(.command) { parts.append("⌘") }
    parts.append(Self.keyLabel(for: keyCode))
    return parts.joined(separator: " ")
  }

  private static func keyLabel(for keyCode: Int) -> String {
    switch keyCode {
    case kVK_Space: return "Space"
    case kVK_Return: return "Return"
    case kVK_Escape: return "Esc"
    case kVK_ANSI_A...kVK_ANSI_Z:
      return keyLabels[keyCode] ?? "Key \(keyCode)"
    default:
      return keyLabels[keyCode] ?? "Key \(keyCode)"
    }
  }

  private static let keyLabels: [Int: String] = [
    kVK_ANSI_A: "A", kVK_ANSI_B: "B", kVK_ANSI_C: "C", kVK_ANSI_D: "D",
    kVK_ANSI_E: "E", kVK_ANSI_F: "F", kVK_ANSI_G: "G", kVK_ANSI_H: "H",
    kVK_ANSI_I: "I", kVK_ANSI_J: "J", kVK_ANSI_K: "K", kVK_ANSI_L: "L",
    kVK_ANSI_M: "M", kVK_ANSI_N: "N", kVK_ANSI_O: "O", kVK_ANSI_P: "P",
    kVK_ANSI_Q: "Q", kVK_ANSI_R: "R", kVK_ANSI_S: "S", kVK_ANSI_T: "T",
    kVK_ANSI_U: "U", kVK_ANSI_V: "V", kVK_ANSI_W: "W", kVK_ANSI_X: "X",
    kVK_ANSI_Y: "Y", kVK_ANSI_Z: "Z",
    kVK_ANSI_0: "0", kVK_ANSI_1: "1", kVK_ANSI_2: "2", kVK_ANSI_3: "3",
    kVK_ANSI_4: "4", kVK_ANSI_5: "5", kVK_ANSI_6: "6", kVK_ANSI_7: "7",
    kVK_ANSI_8: "8", kVK_ANSI_9: "9",
    
    // Symbols
    kVK_ANSI_Grave: "`",
    kVK_ANSI_Minus: "-",
    kVK_ANSI_Equal: "=",
    kVK_ANSI_LeftBracket: "[",
    kVK_ANSI_RightBracket: "]",
    kVK_ANSI_Backslash: "\\",
    kVK_ANSI_Semicolon: ";",
    kVK_ANSI_Quote: "'",
    kVK_ANSI_Comma: ",",
    kVK_ANSI_Period: ".",
    kVK_ANSI_Slash: "/",
    
    // Control & Functions
    kVK_Tab: "Tab",
    kVK_Delete: "Delete",
    kVK_ForwardDelete: "Fwd Del",
    kVK_Home: "Home",
    kVK_End: "End",
    kVK_PageUp: "PgUp",
    kVK_PageDown: "PgDn",
    kVK_LeftArrow: "←",
    kVK_RightArrow: "→",
    kVK_UpArrow: "↑",
    kVK_DownArrow: "↓",
    kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4",
    kVK_F5: "F5", kVK_F6: "F6", kVK_F7: "F7", kVK_F8: "F8",
    kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12"
  ]
}

@MainActor
final class VocaRunner: ObservableObject {
  enum Page {
    case create
    case history
    case settings
  }

  enum JobStage: String, CaseIterable {
    case generating = "Generate data"
    case rendering = "Render PNG"
    case syncing = "Sync dictionary"
    case complete = "Complete"
  }

  struct RecentCard: Identifiable {
    let id = UUID()
    let word: String
    let file: String
  }

  @Published var page: Page = .create {
    didSet {
      updatePopoverSize()
    }
  }
  @Published var input = "" {
    didSet {
      updateSearchResults()
      updatePopoverSize()
    }
  }
  @Published var apiKey = ""
  @Published var baseURL = "http://localhost:20128/v1"
  @Published var model = "cx/gpt-5.5"
  @Published var vocaApiToken = ""
  @Published var vocaApiPort = "22053"
  @Published var vocaApiBindAddress = "127.0.0.1"
  @Published var vocaApiUrl = ""
  @Published var runLocalBridge = true
  @Published var localAPIProcessActive = false
  @Published var logLines: [String] = ["Ready"]
  @Published var connectionTestStatus = ""
  @Published var bridgeTestStatus = ""
  @Published var saveStatus = ""
  @Published var isRunning = false {
    didSet {
      updatePopoverSize()
    }
  }
  @Published var hasSavedAPIKey = false
  @Published var launchAtLogin = false
  @Published var clearInputAfterSuccess = true
  @Published var keepPopoverOpenWhileRunning = true
  @Published var showNotificationWhenDone = true
  @Published var isRecordingShortcut = false
  @Published var shortcut = KeyboardShortcutSetting.defaultValue
  @Published var recentCards: [RecentCard] = []
  @Published var showRecentCards = false
  @Published var currentStage: JobStage?
  @Published var completedStages: Set<JobStage> = []
  @Published var lastOutputDir: String?
  @Published var hasStartedJob = false {
    didSet {
      updatePopoverSize()
    }
  }
  @Published var currentResult: RecentCard?

  @Published var allCards: [ServerCard] = []
  @Published var searchResults: [ServerCard] = []
  @Published var selectedSearchCard: ServerCard? = nil {
    didSet {
      updatePopoverSize()
    }
  }
  @Published var isPlayingAudio = false

  var onShortcutChanged: (() -> Void)?
  var onSizeChanged: ((NSSize) -> Void)?

  private var process: Process?
  private var localAPIProcess: Process?
  private var shortcutMonitor: Any?
  private let envURL = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".voca-menubar.env")
  private let defaults = UserDefaults.standard

  init() {
    hasSavedAPIKey = Self.readEnvValue(key: "OPENAI_API_KEY", from: envURL) != nil
    baseURL = Self.readEnvValue(key: "OPENAI_BASE_URL", from: envURL) ?? baseURL
    model = Self.readEnvValue(key: "OPENAI_MODEL", from: envURL) ?? model
    vocaApiToken = Self.readEnvValue(key: "VOCA_API_TOKEN", from: envURL) ?? "voca_55c2ac41266be58e43d0ef2b5817b4c9053a2ed7410fcefd"
    vocaApiPort = Self.readEnvValue(key: "VOCA_LOCAL_API_PORT", from: envURL) ?? "22053"
    vocaApiBindAddress = Self.readEnvValue(key: "VOCA_BIND_ADDRESS", from: envURL) ?? "127.0.0.1"
    vocaApiUrl = Self.readEnvValue(key: "VOCA_API_URL", from: envURL) ?? ""
    runLocalBridge = (Self.readEnvValue(key: "VOCA_RUN_LOCAL_BRIDGE", from: envURL) ?? "1") == "1"
    loadSettings()
    loadRecentCards()
    startLocalAPIIfNeeded()
    fetchCardsFromServer()
  }

  var canRun: Bool {
    !isRunning && !input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var setupStatus: String {
    hasSavedAPIKey ? "Configured" : "Setup required"
  }

  var repoPath: String {
    ProcessInfo.processInfo.environment["VOCA_DICTIONARY_DIR"]
      ?? "/Users/thaonv/Projects/Personal/voca-dictionary"
  }

  func scriptPath(_ name: String) -> String? {
    let candidates = [
      "\(repoPath)/skills/scripts/\(name)",
      "\(repoPath)/scripts/\(name)",
    ]
    return candidates.first { FileManager.default.fileExists(atPath: $0) }
  }

  func showCreatePage() {
    page = .create
  }

  func showHistoryPage() {
    page = .history
  }

  func showSettingsPage() {
    page = .settings
  }

  func resetVisibleStateForOpen() {
    guard !isRunning else { return }
    hasStartedJob = false
    currentStage = nil
    completedStages = []
    currentResult = nil
    showRecentCards = false
    logLines = ["Ready"]
    fetchCardsFromServer()
  }

  func saveSetup() {
    let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
    let existingKey = Self.readEnvValue(key: "OPENAI_API_KEY", from: envURL)
    let keyToSave = trimmed.isEmpty ? existingKey : trimmed
    let trimmedBaseURL = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
    
    let trimmedVocaToken = vocaApiToken.trimmingCharacters(in: .whitespacesAndNewlines)
    let defaultVocaToken = "voca_55c2ac41266be58e43d0ef2b5817b4c9053a2ed7410fcefd"
    let vocaTokenToSave = trimmedVocaToken.isEmpty ? defaultVocaToken : trimmedVocaToken

    let trimmedPort = vocaApiPort.trimmingCharacters(in: .whitespacesAndNewlines)
    let portToSave = trimmedPort.isEmpty ? "22053" : trimmedPort

    let trimmedBind = vocaApiBindAddress.trimmingCharacters(in: .whitespacesAndNewlines)
    let bindToSave = trimmedBind.isEmpty ? "127.0.0.1" : trimmedBind

    let trimmedApiUrl = vocaApiUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    let runLocalBridgeVal = runLocalBridge ? "1" : "0"

    saveStatus = "Saving config..."
    var lines: [String] = []
    if let key = keyToSave, !key.isEmpty {
      lines.append("OPENAI_API_KEY=\(key)")
    }
    if !trimmedBaseURL.isEmpty {
      lines.append("OPENAI_BASE_URL=\(trimmedBaseURL)")
    }
    if !trimmedModel.isEmpty {
      lines.append("OPENAI_MODEL=\(trimmedModel)")
    }
    lines.append("VOCA_API_TOKEN=\(vocaTokenToSave)")
    lines.append("VOCA_LOCAL_API_PORT=\(portToSave)")
    lines.append("VOCA_BIND_ADDRESS=\(bindToSave)")
    lines.append("VOCA_API_URL=\(trimmedApiUrl)")
    lines.append("VOCA_RUN_LOCAL_BRIDGE=\(runLocalBridgeVal)")
    
    let content = lines.joined(separator: "\n")
    do {
      try content.write(to: envURL, atomically: true, encoding: .utf8)
      try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: envURL.path)
      apiKey = ""
      hasSavedAPIKey = keyToSave != nil && !keyToSave!.isEmpty
      saveStatus = "Saved setup"
      logLines.append("Saved setup")
      stopLocalAPI()
      startLocalAPIIfNeeded()
      fetchCardsFromServer()
    } catch {
      saveStatus = "Save failed: \(error.localizedDescription)"
      logLines.append("Failed to save setup: \(error.localizedDescription)")
    }
  }

  func testConnection() {
    connectionTestStatus = "Testing connection with \(model)..."
    logLines = ["Testing connection with \(model)..."]
    let task = Process()
    task.executableURL = URL(fileURLWithPath: nodePath())
    task.arguments = ["-e", "fetch(process.env.OPENAI_BASE_URL.replace(/\\/+$/, '') + '/models', {headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY}}).then(r=>{console.log(r.status); process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message); process.exit(1)})"]
    task.environment = processEnvironment()

    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = pipe
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let text = String(data: handle.availableData, encoding: .utf8) ?? ""
      Task { @MainActor in self?.appendPlain(text) }
    }
    task.terminationHandler = { [weak self] process in
      Task { @MainActor in
        pipe.fileHandleForReading.readabilityHandler = nil
        let success = process.terminationStatus == 0
        self?.connectionTestStatus = success ? "Connection OK" : "Connection failed"
        self?.logLines.append(success ? "Connection OK" : "Connection failed")
      }
    }
    do {
      try task.run()
    } catch {
      connectionTestStatus = "Failed to test: \(error.localizedDescription)"
      logLines.append("Failed to test: \(error.localizedDescription)")
    }
  }
  
  func testBridgeConnection() {
    let url: String
    let trimmedUrl = vocaApiUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    if runLocalBridge || trimmedUrl.isEmpty {
      url = "http://\(vocaApiBindAddress):\(vocaApiPort)/v1/health"
    } else {
      url = trimmedUrl.replacingOccurrences(of: "/+$", with: "", options: .regularExpression) + "/v1/health"
    }
    bridgeTestStatus = "Testing bridge connection..."
    logLines = ["Testing bridge connection at \(url)..."]
    let task = Process()
    task.executableURL = URL(fileURLWithPath: nodePath())
    task.arguments = ["-e", "fetch('\(url)', {headers:{Authorization:'Bearer \(vocaApiToken)'}}).then(r=>r.json()).then(d=>{console.log('Bridge: ' + (d.service || 'Connected')); process.exit(0)}).catch(e=>{console.error(e.message); process.exit(1)})"]
    task.environment = processEnvironment()

    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = pipe
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let text = String(data: handle.availableData, encoding: .utf8) ?? ""
      guard !text.isEmpty else { return }
      Task { @MainActor in self?.appendPlain(text) }
    }
    task.terminationHandler = { [weak self] process in
      Task { @MainActor in
        pipe.fileHandleForReading.readabilityHandler = nil
        let success = process.terminationStatus == 0
        self?.bridgeTestStatus = success ? "Bridge connection OK" : "Bridge connection failed"
        self?.logLines.append(success ? "Bridge connection OK" : "Bridge connection failed")
      }
    }
    do {
      try task.run()
    } catch {
      bridgeTestStatus = "Failed to test: \(error.localizedDescription)"
      logLines.append("Failed to test: \(error.localizedDescription)")
    }
  }

  func startLocalAPIIfNeeded() {
    guard runLocalBridge else {
      localAPIProcessActive = false
      return
    }
    guard localAPIProcess == nil else { return }
    guard let scriptPath = scriptPath("voca-local-api.mjs") else {
      logLines.append("Local API script not found")
      localAPIProcessActive = false
      return
    }

    let task = Process()
    task.executableURL = URL(fileURLWithPath: nodePath())
    task.arguments = [scriptPath]
    task.currentDirectoryURL = URL(fileURLWithPath: repoPath)
    task.environment = processEnvironment()

    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = pipe
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let text = String(data: handle.availableData, encoding: .utf8) ?? ""
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
      Task { @MainActor in self?.appendPlain(text) }
    }
    task.terminationHandler = { [weak self] _ in
      Task { @MainActor in
        pipe.fileHandleForReading.readabilityHandler = nil
        self?.localAPIProcess = nil
        self?.localAPIProcessActive = false
      }
    }

    do {
      try task.run()
      localAPIProcess = task
      localAPIProcessActive = true
      logLines.append("Local API bridge listening on \(vocaApiBindAddress):\(vocaApiPort)")
    } catch {
      localAPIProcessActive = false
      logLines.append("Failed to start local API: \(error.localizedDescription)")
    }
  }

  func stopLocalAPI() {
    localAPIProcess?.terminate()
    localAPIProcess = nil
    localAPIProcessActive = false
  }

  func openOutputFolder() {
    let url = URL(fileURLWithPath: repoPath)
      .deletingLastPathComponent()
      .appendingPathComponent("output/vocabulary_cards")
    NSWorkspace.shared.open(url)
  }

  func run() {
    guard canRun else { return }
    let words = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let scriptPath = scriptPath("voca-create-card.mjs") else {
      logLines.append("Card creation script not found")
      return
    }

    isRunning = true
    hasStartedJob = true
    currentResult = nil
    currentStage = nil
    completedStages = []
    logLines = ["Starting: \(words)"]

    let task = Process()
    task.executableURL = URL(fileURLWithPath: nodePath())
    task.arguments = [scriptPath, words]
    task.currentDirectoryURL = URL(fileURLWithPath: repoPath)
    task.environment = processEnvironment()

    let pipe = Pipe()
    let errorPipe = Pipe()
    task.standardOutput = pipe
    task.standardError = errorPipe

    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let text = String(data: handle.availableData, encoding: .utf8) ?? ""
      Task { @MainActor in self?.appendOutput(text) }
    }
    errorPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let text = String(data: handle.availableData, encoding: .utf8) ?? ""
      Task { @MainActor in self?.appendPlain(text) }
    }

    task.terminationHandler = { [weak self] process in
      Task { @MainActor in
        pipe.fileHandleForReading.readabilityHandler = nil
        errorPipe.fileHandleForReading.readabilityHandler = nil
        self?.isRunning = false
        self?.process = nil
        if process.terminationStatus == 0 {
          self?.completedStages.insert(.complete)
          self?.currentStage = .complete
          self?.logLines.append("Done")
          if self?.clearInputAfterSuccess == true {
            self?.input = ""
          }
          self?.fetchCardsFromServer()
          self?.notifyIfNeeded()
        } else {
          self?.logLines.append("Failed")
        }
      }
    }

    do {
      process = task
      try task.run()
    } catch {
      isRunning = false
      process = nil
      logLines.append("Failed to start: \(error.localizedDescription)")
    }
  }

  func cancel() {
    process?.terminate()
  }

  func quit() {
    NSApplication.shared.terminate(nil)
  }

  func startShortcutRecording() {
    isRecordingShortcut = true
    if let shortcutMonitor {
      NSEvent.removeMonitor(shortcutMonitor)
    }
    shortcutMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
      Task { @MainActor in
        self?.captureShortcut(event)
      }
      return nil
    }
  }

  func updateLaunchAtLogin(_ enabled: Bool) {
    launchAtLogin = enabled
    defaults.set(enabled, forKey: "launchAtLogin")
    do {
      if enabled {
        try SMAppService.mainApp.register()
      } else {
        try SMAppService.mainApp.unregister()
      }
    } catch {
      logLines.append("Launch at login update failed: \(error.localizedDescription)")
    }
  }

  func saveBehaviorSettings() {
    defaults.set(clearInputAfterSuccess, forKey: "clearInputAfterSuccess")
    defaults.set(keepPopoverOpenWhileRunning, forKey: "keepPopoverOpenWhileRunning")
    defaults.set(showNotificationWhenDone, forKey: "showNotificationWhenDone")
  }

  private func captureShortcut(_ event: NSEvent) {
    let allowed = event.modifierFlags.intersection([.command, .option, .control, .shift])
    guard !allowed.isEmpty else {
      logLines.append("Shortcut needs a modifier")
      stopShortcutRecording()
      return
    }
    shortcut = KeyboardShortcutSetting(keyCode: Int(event.keyCode), modifiers: allowed)
    defaults.set(shortcut.keyCode, forKey: "shortcutKeyCode")
    defaults.set(Int(shortcut.modifiers.rawValue), forKey: "shortcutModifiers")
    stopShortcutRecording()
    logLines.append("Shortcut set to \(shortcut.label)")
    onShortcutChanged?()
  }

  private func stopShortcutRecording() {
    if let shortcutMonitor {
      NSEvent.removeMonitor(shortcutMonitor)
      self.shortcutMonitor = nil
    }
    isRecordingShortcut = false
  }

  private func loadSettings() {
    if defaults.object(forKey: "clearInputAfterSuccess") != nil {
      clearInputAfterSuccess = defaults.bool(forKey: "clearInputAfterSuccess")
    }
    if defaults.object(forKey: "keepPopoverOpenWhileRunning") != nil {
      keepPopoverOpenWhileRunning = defaults.bool(forKey: "keepPopoverOpenWhileRunning")
    }
    if defaults.object(forKey: "showNotificationWhenDone") != nil {
      showNotificationWhenDone = defaults.bool(forKey: "showNotificationWhenDone")
    }
    launchAtLogin = defaults.bool(forKey: "launchAtLogin")
    var keyCode = defaults.object(forKey: "shortcutKeyCode") as? Int ?? KeyboardShortcutSetting.defaultValue.keyCode
    var modifierRaw = defaults.object(forKey: "shortcutModifiers") as? Int ?? Int(KeyboardShortcutSetting.defaultValue.modifiers.rawValue)
    
    // Migrate old Option + Space default to Option + V to prevent Alfred/Raycast/system shortcut conflicts
    if keyCode == kVK_Space && modifierRaw == Int(NSEvent.ModifierFlags.option.rawValue) {
      keyCode = kVK_ANSI_V
      modifierRaw = Int(NSEvent.ModifierFlags.option.rawValue)
      defaults.set(keyCode, forKey: "shortcutKeyCode")
      defaults.set(modifierRaw, forKey: "shortcutModifiers")
    }
    
    shortcut = KeyboardShortcutSetting(keyCode: keyCode, modifiers: NSEvent.ModifierFlags(rawValue: UInt(modifierRaw)))
  }

  private func loadRecentCards() {
    guard let values = defaults.array(forKey: "recentCards") as? [[String: String]] else { return }
    recentCards = values.prefix(3).compactMap { item in
      guard let word = item["word"], let file = item["file"] else { return nil }
      return RecentCard(word: word, file: file)
    }
  }

  private func saveRecentCards() {
    let values = recentCards.prefix(3).map { ["word": $0.word, "file": $0.file] }
    defaults.set(values, forKey: "recentCards")
  }

  private func addRecentCards(_ cards: [RecentCard]) {
    guard !cards.isEmpty else { return }
    var merged = cards + recentCards
    var seen = Set<String>()
    merged = merged.filter { card in
      let key = card.file.lowercased()
      if seen.contains(key) { return false }
      seen.insert(key)
      return true
    }
    recentCards = Array(merged.prefix(3))
    saveRecentCards()
  }

  private func processEnvironment() -> [String: String] {
    var environment = ProcessInfo.processInfo.environment
    environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    environment["VOCA_DICTIONARY_DIR"] = repoPath
    environment["OPENAI_API_KEY"] = Self.readEnvValue(key: "OPENAI_API_KEY", from: envURL)
    environment["OPENAI_BASE_URL"] = Self.readEnvValue(key: "OPENAI_BASE_URL", from: envURL) ?? baseURL
    environment["OPENAI_MODEL"] = Self.readEnvValue(key: "OPENAI_MODEL", from: envURL) ?? model
    environment["VOCA_API_TOKEN"] = Self.readEnvValue(key: "VOCA_API_TOKEN", from: envURL) ?? vocaApiToken
    environment["VOCA_LOCAL_API_PORT"] = Self.readEnvValue(key: "VOCA_LOCAL_API_PORT", from: envURL) ?? vocaApiPort
    environment["VOCA_BIND_ADDRESS"] = Self.readEnvValue(key: "VOCA_BIND_ADDRESS", from: envURL) ?? vocaApiBindAddress
    environment["VOCA_API_URL"] = Self.readEnvValue(key: "VOCA_API_URL", from: envURL) ?? vocaApiUrl
    environment["VOCA_RUN_LOCAL_BRIDGE"] = Self.readEnvValue(key: "VOCA_RUN_LOCAL_BRIDGE", from: envURL) ?? (runLocalBridge ? "1" : "0")
    return environment
  }

  private func nodePath() -> String {
    if FileManager.default.fileExists(atPath: "/opt/homebrew/bin/node") {
      return "/opt/homebrew/bin/node"
    }
    return "/usr/local/bin/node"
  }

  private func appendOutput(_ text: String) {
    for line in text.split(whereSeparator: \.isNewline) {
      let raw = String(line)
      if let data = raw.data(using: .utf8),
         let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         let type = object["type"] as? String,
         let message = object["message"] as? String {
        updateProgress(type: type, message: message, object: object)
      } else {
        logLines.append(raw)
      }
    }
  }

  private func updateProgress(type: String, message: String, object: [String: Any]) {
    logLines.append(message)
    if message.contains("Generating vocabulary") {
      currentStage = .generating
    } else if message.contains("Rendering PNG") {
      completedStages.insert(.generating)
      currentStage = .rendering
    } else if message.contains("Syncing") {
      completedStages.insert(.rendering)
      currentStage = .syncing
    } else if type == "done" {
      completedStages.formUnion([.generating, .rendering, .syncing])
      currentStage = .complete
      lastOutputDir = object["outputDir"] as? String
      if let copied = object["copied"] as? [[String: Any]], !copied.isEmpty {
        let cards = copied.compactMap { item -> RecentCard? in
          guard let word = item["word"] as? String, let file = item["file"] as? String else { return nil }
          return RecentCard(word: word, file: file)
        }
        addRecentCards(cards)
        currentResult = cards.first
        let words = cards.map(\.word).joined(separator: ", ")
        logLines.append("Created: \(words)")
      }
      if let skipped = object["skipped"] as? [[String: Any]], !skipped.isEmpty {
        let cards = skipped.compactMap { item -> RecentCard? in
          guard let word = item["word"] as? String, let file = item["file"] as? String else { return nil }
          return RecentCard(word: word, file: file)
        }
        addRecentCards(cards)
        currentResult = cards.first
        let words = skipped.compactMap { $0["word"] as? String }.joined(separator: ", ")
        logLines.append("Skipped: \(words)")
      }
    }
  }

  private func appendPlain(_ text: String) {
    for line in text.split(whereSeparator: \.isNewline) {
      logLines.append(String(line))
    }
  }

  private func notifyIfNeeded() {
    guard showNotificationWhenDone else { return }
    let body = recentCards.first.map { "\($0.word) is ready." } ?? "Card generation finished."
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
      guard granted else { return }
      let content = UNMutableNotificationContent()
      content.title = "Voca card complete"
      content.body = body
      let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
      UNUserNotificationCenter.current().add(request)
    }
  }

  var bridgeBaseUrl: String {
    let trimmedUrl = vocaApiUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    if runLocalBridge || trimmedUrl.isEmpty {
      return "http://\(vocaApiBindAddress):\(vocaApiPort)"
    } else {
      return trimmedUrl.replacingOccurrences(of: "/+$", with: "", options: .regularExpression)
    }
  }

  func openCardImage(_ card: ServerCard) {
    let urlString = "\(bridgeBaseUrl)/v1/assets/cards/\(card.file.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "")"
    if let url = URL(string: urlString) {
      NSWorkspace.shared.open(url)
    }
  }

  func playPronunciation(for card: ServerCard) {
    guard !isPlayingAudio else { return }
    isPlayingAudio = true
    
    let cardId = card.slug ?? card.word.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? card.word
    guard let url = URL(string: "\(bridgeBaseUrl)/v1/audio/\(cardId)") else {
      isPlayingAudio = false
      return
    }
    
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.setValue("Bearer \(vocaApiToken)", forHTTPHeaderField: "Authorization")
    
    Task {
      do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
          await MainActor.run {
            self.isPlayingAudio = false
            self.logLines.append("Audio not found on server")
          }
          return
        }
        
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(card.id).mp3")
        try data.write(to: tempURL)
        
        await MainActor.run {
          if let sound = NSSound(contentsOf: tempURL, byReference: true) {
            sound.play()
          } else {
            self.logLines.append("Could not play audio file")
          }
          self.isPlayingAudio = false
        }
      } catch {
        await MainActor.run {
          self.isPlayingAudio = false
          self.logLines.append("Play audio error: \(error.localizedDescription)")
        }
      }
    }
  }

  func updateSearchResults() {
    let query = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if query.isEmpty {
      searchResults = []
      selectedSearchCard = nil
    } else {
      searchResults = allCards.filter { card in
        card.word.lowercased().contains(query) ||
        (card.meaningEn?.lowercased().contains(query) ?? false) ||
        (card.meaningVi?.lowercased().contains(query) ?? false)
      }
    }
  }

  func updatePopoverSize() {}

  func fetchCardsFromServer() {
    guard let url = URL(string: "\(bridgeBaseUrl)/v1/cards") else { return }
    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.setValue("Bearer \(vocaApiToken)", forHTTPHeaderField: "Authorization")
    
    Task {
      do {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
          await MainActor.run {
            self.logLines.append("Failed to fetch cards: invalid status")
          }
          return
        }
        
        let decoder = JSONDecoder()
        let result = try decoder.decode(CardsResponse.self, from: data)
        await MainActor.run {
          self.allCards = result.cards
          self.updateSearchResults()
          self.logLines.append("Loaded \(result.cards.count) cards from server")
        }
      } catch {
        await MainActor.run {
          self.logLines.append("Fetch cards error: \(error.localizedDescription)")
        }
      }
    }
  }

  static func readEnvValue(key: String, from url: URL) -> String? {
    guard let content = try? String(contentsOf: url, encoding: .utf8) else {
      return nil
    }
    for line in content.split(whereSeparator: \.isNewline) {
      let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmed.isEmpty, !trimmed.hasPrefix("#") else { continue }
      let parts = trimmed.split(separator: "=", maxSplits: 1).map(String.init)
      if parts.count == 2, parts[0].trimmingCharacters(in: .whitespacesAndNewlines) == key {
        return parts[1].trimmingCharacters(in: CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "\"'")))
      }
    }
    return nil
  }
}

struct Theme {
  static let accent = Color(red: 14/255, green: 165/255, blue: 233/255) // #0EA5E9 (Sky Blue)
  static let accentDark = Color(red: 2/255, green: 132/255, blue: 199/255) // #0284C7
  static let gradientStart = Color(red: 6/255, green: 182/255, blue: 212/255) // #06B6D4 (Cyan)
  static let gradientEnd = Color(red: 16/255, green: 185/255, blue: 129/255) // #10B981 (Teal)
}

struct ThemeBackground: View {
  @Environment(\.colorScheme) var colorScheme
  
  var body: some View {
    ZStack {
      if colorScheme == .dark {
        Color(red: 15/255, green: 23/255, blue: 42/255) // Slate 900
        RadialGradient(
          gradient: Gradient(colors: [Theme.gradientStart.opacity(0.24), Color.clear]),
          center: .topLeading,
          startRadius: 0,
          endRadius: 240
        )
        RadialGradient(
          gradient: Gradient(colors: [Theme.gradientEnd.opacity(0.18), Color.clear]),
          center: .bottomTrailing,
          startRadius: 0,
          endRadius: 200
        )
      } else {
        Color(red: 240/255, green: 249/255, blue: 255/255) // Sky 50 (Very clean and bright ice-blue)
        RadialGradient(
          gradient: Gradient(colors: [Theme.gradientStart.opacity(0.15), Color.clear]),
          center: .topLeading,
          startRadius: 0,
          endRadius: 240
        )
        RadialGradient(
          gradient: Gradient(colors: [Theme.gradientEnd.opacity(0.10), Color.clear]),
          center: .bottomTrailing,
          startRadius: 0,
          endRadius: 200
        )
      }
    }
    .ignoresSafeArea()
  }
}

struct BrandMark: View {
  var body: some View {
    Text("V")
      .font(.system(size: 15, weight: .black))
      .foregroundStyle(.white)
      .frame(width: 32, height: 32)
      .background(
        LinearGradient(
          colors: [Theme.gradientStart, Theme.gradientEnd],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      )
      .clipShape(RoundedRectangle(cornerRadius: 8))
      .shadow(color: Theme.gradientStart.opacity(0.3), radius: 6, x: 0, y: 3)
  }
}

struct FormCard<Content: View>: View {
  @Environment(\.colorScheme) var colorScheme
  let content: Content
  
  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }
  
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      content
    }
    .padding(14)
    .background(colorScheme == .dark ? Color(red: 30/255, green: 41/255, blue: 59/255) : Color.white)
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .overlay(
      RoundedRectangle(cornerRadius: 12)
        .stroke(colorScheme == .dark ? Theme.accent.opacity(0.15) : Color(red: 229/255, green: 231/255, blue: 235/255), lineWidth: 1)
    )
    .shadow(color: Color(red: 24/255, green: 39/255, blue: 75/255).opacity(colorScheme == .dark ? 0.25 : 0.04), radius: 10, x: 0, y: 5)
  }
}

struct FormInput: View {
  @Binding var text: String
  var placeholder: String
  var isFocused: FocusState<Bool>.Binding
  @Environment(\.colorScheme) var colorScheme

  var body: some View {
    TextField(placeholder, text: $text)
      .textFieldStyle(.plain)
      .focused(isFocused)
      .font(.system(size: 13))
      .padding(.horizontal, 11)
      .frame(height: 38)
      .background(colorScheme == .dark ? Color(red: 12/255, green: 15/255, blue: 28/255) : Color.white)
      .clipShape(RoundedRectangle(cornerRadius: 8))
      .overlay(
        RoundedRectangle(cornerRadius: 8)
          .stroke(isFocused.wrappedValue ? Theme.accent : (colorScheme == .dark ? Color.secondary.opacity(0.2) : Color(red: 229/255, green: 231/255, blue: 235/255)), lineWidth: 1)
      )
      .shadow(color: isFocused.wrappedValue ? Theme.accent.opacity(0.12) : Color.clear, radius: 3, x: 0, y: 0)
  }
}

struct ViewSizeKey: PreferenceKey {
  static var defaultValue: CGSize = .zero
  static func reduce(value: inout CGSize, nextValue: () -> CGSize) {
    value = nextValue()
  }
}

struct VocaPopoverView: View {
  @ObservedObject var runner: VocaRunner

  var body: some View {
    Group {
      switch runner.page {
      case .create, .history:
        CreatePage(runner: runner)
      case .settings:
        SettingsPage(runner: runner)
      }
    }
    .frame(width: 320)
    .background(ThemeBackground())
    .background(
      GeometryReader { geometry in
        Color.clear
          .preference(key: ViewSizeKey.self, value: geometry.size)
      }
    )
    .onPreferenceChange(ViewSizeKey.self) { size in
      if size.height > 0 {
        runner.onSizeChanged?(NSSize(width: 320, height: size.height))
      }
    }
    .fixedSize(horizontal: false, vertical: true)
  }
}

struct FormButton: View {
  var title: String
  var isEnabled: Bool = true
  var action: () -> Void
  @State private var isHovering = false
  @State private var isActive = false

  var body: some View {
    Button(action: action) {
      Text(title)
        .font(.system(size: 14, weight: .bold))
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .frame(height: 38)
        .background(
          isEnabled 
            ? (isHovering ? Color(red: 24/255, green: 88/255, blue: 199/255) : Color(red: 31/255, green: 111/255, blue: 235/255))
            : Color(red: 113/255, green: 128/255, blue: 154/255)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .shadow(color: isEnabled && isHovering ? Color(red: 31/255, green: 111/255, blue: 235/255).opacity(0.2) : Color.clear, radius: 10, x: 0, y: 4)
        .scaleEffect(isActive ? 0.98 : 1.0)
    }
    .buttonStyle(.plain)
    .disabled(!isEnabled)
    .onHover { hovering in
      isHovering = hovering
    }
  }
}

struct OptionsButton: View {
  var action: () -> Void
  @Environment(\.colorScheme) var colorScheme
  @State private var isHovering = false

  var body: some View {
    Button(action: action) {
      Image(systemName: "gearshape")
        .font(.system(size: 16, weight: .medium))
        .foregroundStyle(colorScheme == .dark ? .white : Color(red: 48/255, green: 65/255, blue: 95/255))
        .frame(width: 34, height: 34)
        .background(
          colorScheme == .dark 
            ? (isHovering ? Color.white.opacity(0.15) : Color.white.opacity(0.08)) 
            : (isHovering ? Color(red: 220/255, green: 228/255, blue: 242/255) : Color(red: 238/255, green: 243/255, blue: 251/255))
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
    .buttonStyle(.plain)
    .onHover { hovering in
      isHovering = hovering
    }
  }
}


struct CardDetailView: View {
  let card: ServerCard
  @ObservedObject var runner: VocaRunner
  var onBack: () -> Void
  @Environment(\.colorScheme) var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Button(action: onBack) {
          HStack(spacing: 4) {
            Image(systemName: "chevron.left")
              .font(.system(size: 11, weight: .bold))
            Text("Back")
              .font(.system(size: 12, weight: .bold))
          }
          .foregroundStyle(Theme.accent)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background(colorScheme == .dark ? Color.white.opacity(0.08) : Color(red: 238/255, green: 243/255, blue: 251/255))
          .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        
        Spacer()
        
        if let topic = card.topic, !topic.isEmpty {
          Text(topic)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.secondary.opacity(0.1))
            .clipShape(Capsule())
        }
      }
      
      VStack(alignment: .leading, spacing: 4) {
        HStack(alignment: .center, spacing: 8) {
          Text(card.word)
            .font(.system(size: 16, weight: .bold))
          
          if let pos = card.partOfSpeech, !pos.isEmpty {
            Text(pos)
              .font(.system(size: 10, weight: .medium))
              .foregroundStyle(Theme.accent)
              .padding(.horizontal, 4)
              .padding(.vertical, 1)
              .background(Theme.accent.opacity(0.1))
              .clipShape(RoundedRectangle(cornerRadius: 4))
          }
          
          Button(action: {
            runner.playPronunciation(for: card)
          }) {
            if runner.isPlayingAudio {
              ProgressView()
                .controlSize(.mini)
                .frame(width: 14, height: 14)
            } else {
              Image(systemName: "speaker.wave.2.fill")
                .font(.system(size: 12))
                .foregroundStyle(Theme.accent)
            }
          }
          .buttonStyle(.plain)
        }
        
        if let pron = card.pronunciation, !pron.isEmpty {
          Text(pron)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(.secondary)
        }
      }
      
      Divider()
        .opacity(0.4)
      
      VStack(alignment: .leading, spacing: 10) {
        if let en = card.meaningEn, !en.isEmpty {
          VStack(alignment: .leading, spacing: 2) {
            Text("ENGLISH")
              .font(.system(size: 9, weight: .bold))
              .foregroundStyle(.secondary)
            Text(en)
              .font(.system(size: 12))
              .lineLimit(nil)
          }
        }
        
        if let vi = card.meaningVi, !vi.isEmpty {
          VStack(alignment: .leading, spacing: 2) {
            Text("VIETNAMESE")
              .font(.system(size: 9, weight: .bold))
              .foregroundStyle(.secondary)
            Text(vi)
              .font(.system(size: 12))
              .lineLimit(nil)
          }
        }
      }
    }
    .padding(12)
    .background(colorScheme == .dark ? Color(red: 30/255, green: 41/255, blue: 59/255) : Color.white)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .overlay(
      RoundedRectangle(cornerRadius: 8)
        .stroke(colorScheme == .dark ? Color.secondary.opacity(0.2) : Color(red: 217/255, green: 224/255, blue: 236/255).opacity(0.9), lineWidth: 1)
    )
  }
}

struct CreatePage: View {
  @ObservedObject var runner: VocaRunner
  @FocusState private var inputFocused: Bool
  @State private var currentPage = 0
  @Environment(\.colorScheme) var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      // Header
      HStack {
        HStack(spacing: 8) {
          BrandMark()
          Text("Voca Dictionary")
            .font(.system(size: 15, weight: .bold))
        }
        
        Spacer()
        
        HStack(spacing: 6) {
          // Status indicator of local or remote server
          HStack(spacing: 4) {
            Circle()
              .fill(runner.allCards.isEmpty ? Color.orange : Color.green)
              .frame(width: 6, height: 6)
            Text("\(runner.allCards.count) cards")
              .font(.system(size: 10, weight: .semibold))
              .foregroundStyle(.secondary)
          }
          .padding(.horizontal, 6)
          .padding(.vertical, 3)
          .background(colorScheme == .dark ? Color.white.opacity(0.06) : Color(red: 238/255, green: 243/255, blue: 251/255))
          .clipShape(Capsule())
          
          OptionsButton {
            withAnimation(.easeInOut(duration: 0.2)) {
              runner.showSettingsPage()
            }
          }
        }
      }
      
      if let selectedCard = runner.selectedSearchCard {
        CardDetailView(card: selectedCard, runner: runner, onBack: {
          runner.selectedSearchCard = nil
        })
        .transition(.asymmetric(insertion: .move(edge: .trailing), removal: .move(edge: .leading)))
      } else if runner.hasStartedJob {
        // While a card is being created, show the progress and results
        VStack(spacing: 12) {
          ProgressPanel(runner: runner)
          ResultPanel(runner: runner)
          
          if !runner.isRunning {
            Button(action: {
              runner.resetVisibleStateForOpen()
            }) {
              Text("Back to Search")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.accent)
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .background(colorScheme == .dark ? Color.white.opacity(0.08) : Color(red: 238/255, green: 243/255, blue: 251/255))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
          }
        }
      } else {
        // Main Search & List view
        VStack(spacing: 12) {
          // Search Input Bar
          HStack {
            Image(systemName: "magnifyingglass")
              .font(.system(size: 14))
              .foregroundStyle(.secondary)
              .padding(.leading, 10)
            
            TextField("Search or add word...", text: $runner.input)
              .textFieldStyle(.plain)
              .focused($inputFocused)
              .font(.system(size: 13))
              .frame(height: 36)
              .onSubmit {
                let query = runner.input.trimmingCharacters(in: .whitespacesAndNewlines)
                if let exactCard = runner.allCards.first(where: { $0.word.lowercased() == query.lowercased() }) {
                  withAnimation {
                    runner.selectedSearchCard = exactCard
                  }
                } else if runner.canRun {
                  runner.run()
                }
              }
            
            HStack(spacing: 8) {
              if !runner.input.isEmpty {
                Button(action: {
                  runner.input = ""
                }) {
                  Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                
                let query = runner.input.trimmingCharacters(in: .whitespacesAndNewlines)
                let exactMatch = runner.allCards.contains { $0.word.lowercased() == query.lowercased() }
                
                if !exactMatch {
                  Button(action: {
                    runner.run()
                  }) {
                    Image(systemName: "plus.circle.fill")
                      .font(.system(size: 15, weight: .bold))
                      .foregroundStyle(Theme.accent)
                      .help("Create card for \"\(query)\"")
                  }
                  .buttonStyle(.plain)
                }
              }
              
              Button(action: {
                if let clipboardString = NSPasteboard.general.string(forType: .string) {
                  runner.input = clipboardString.trimmingCharacters(in: .whitespacesAndNewlines)
                }
              }) {
                Image(systemName: "doc.on.clipboard")
                  .font(.system(size: 13))
                  .foregroundStyle(Theme.accent)
                  .help("Paste from clipboard")
              }
              .buttonStyle(.plain)
            }
            .padding(.trailing, 10)
          }
          .background(colorScheme == .dark ? Color(red: 30/255, green: 41/255, blue: 59/255) : Color.white)
          .clipShape(RoundedRectangle(cornerRadius: 8))
          .overlay(
            RoundedRectangle(cornerRadius: 8)
              .stroke(inputFocused ? Theme.accent : (colorScheme == .dark ? Theme.accent.opacity(0.15) : Color(red: 229/255, green: 231/255, blue: 235/255)), lineWidth: 1)
          )
          
          if runner.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text("Enter a word to search or create a card.")
              .font(.system(size: 11))
              .foregroundStyle(.secondary)
              .frame(maxWidth: .infinity, alignment: .center)
              .padding(.top, 14)
          } else {
            // List View: search results
            VStack(alignment: .leading, spacing: 8) {
              let query = runner.input.trimmingCharacters(in: .whitespacesAndNewlines)
              let exactMatch = runner.allCards.contains { $0.word.lowercased() == query.lowercased() }
              
              if runner.searchResults.isEmpty {
                if !exactMatch {
                  VStack(spacing: 8) {
                    Spacer(minLength: 0)
                    Image(systemName: "sparkles")
                      .font(.system(size: 24))
                      .foregroundStyle(Theme.accent.opacity(0.6))
                    Text("Press Enter or click + to create card")
                      .font(.system(size: 12))
                      .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                  }
                  .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                  VStack(spacing: 8) {
                    Spacer(minLength: 0)
                    Text("No results containing query")
                      .font(.system(size: 12))
                      .foregroundStyle(.secondary)
                      .frame(maxWidth: .infinity)
                    Spacer(minLength: 0)
                  }
                  .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
              } else {
                VStack(alignment: .leading, spacing: 6) {
                  Text("Matching Cards")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 2)
                  
                  let itemsPerPage = 4
                  let totalItems = runner.searchResults.count
                  let totalPages = max(1, Int(ceil(Double(totalItems) / Double(itemsPerPage))))
                  
                  let startIndex = currentPage * itemsPerPage
                  let endIndex = min(startIndex + itemsPerPage, totalItems)
                  let pageItems = Array(runner.searchResults[startIndex..<endIndex])
                  
                  VStack(spacing: 6) {
                    ForEach(pageItems) { card in
                      Button(action: {
                        withAnimation {
                          runner.selectedSearchCard = card
                        }
                      }) {
                        HStack {
                          VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                              Text(card.word)
                                .font(.system(size: 13, weight: .bold))
                              if let pos = card.partOfSpeech, !pos.isEmpty {
                                Text(pos)
                                  .font(.system(size: 9))
                                  .foregroundStyle(Theme.accent)
                                  .padding(.horizontal, 4)
                                  .padding(.vertical, 1)
                                  .background(Theme.accent.opacity(0.08))
                                  .clipShape(RoundedRectangle(cornerRadius: 3))
                              }
                            }
                            
                            if let meaning = card.meaningVi ?? card.meaningEn {
                              Text(meaning)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                            }
                          }
                          
                          Spacer()
                          
                          Image(systemName: "chevron.right")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                        }
                        .padding(8)
                        .background(colorScheme == .dark ? Color(red: 20/255, green: 24/255, blue: 41/255) : Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                          RoundedRectangle(cornerRadius: 6)
                            .stroke(colorScheme == .dark ? Theme.accent.opacity(0.15) : Color(red: 229/255, green: 231/255, blue: 235/255), lineWidth: 1)
                        )
                      }
                      .buttonStyle(.plain)
                    }
                  }
                  
                  Spacer(minLength: 0)
                  
                  if totalPages > 1 {
                    HStack {
                      Button(action: {
                        if currentPage > 0 {
                          currentPage -= 1
                        }
                      }) {
                        HStack(spacing: 4) {
                          Image(systemName: "chevron.left")
                            .font(.system(size: 10, weight: .bold))
                          Text("Prev")
                            .font(.system(size: 10, weight: .bold))
                        }
                        .foregroundStyle(currentPage > 0 ? Theme.accent : .secondary.opacity(0.4))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(colorScheme == .dark ? Color.white.opacity(0.06) : Color(red: 238/255, green: 243/255, blue: 251/255))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                      }
                      .buttonStyle(.plain)
                      .disabled(currentPage == 0)
                      
                      Spacer()
                      
                      Text("Page \(currentPage + 1) of \(totalPages)")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.secondary)
                      
                      Spacer()
                      
                      Button(action: {
                        if currentPage < totalPages - 1 {
                          currentPage += 1
                        }
                      }) {
                        HStack(spacing: 4) {
                          Text("Next")
                            .font(.system(size: 10, weight: .bold))
                          Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .bold))
                        }
                        .foregroundStyle(currentPage < totalPages - 1 ? Theme.accent : .secondary.opacity(0.4))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(colorScheme == .dark ? Color.white.opacity(0.06) : Color(red: 238/255, green: 243/255, blue: 251/255))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                      }
                      .buttonStyle(.plain)
                      .disabled(currentPage >= totalPages - 1)
                    }
                    .padding(.top, 4)
                  }
                }
              }
            }
            .frame(height: 250)
          }
        }
      }
    }
    .padding(14)
    .onAppear {
      inputFocused = true
    }
    .onReceive(NotificationCenter.default.publisher(for: .focusVocaInput)) { _ in
      inputFocused = true
    }
    .onChange(of: runner.input) { _ in
      currentPage = 0
    }
  }
}

struct SettingsPage: View {
  @ObservedObject var runner: VocaRunner
  @Environment(\.colorScheme) var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      // Header
      HStack {
        HStack(spacing: 8) {
          Image(systemName: "gearshape.fill")
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(Theme.accent)
          Text("Settings")
            .font(.system(size: 16, weight: .bold))
        }
        Spacer()
        Button {
          withAnimation(.easeInOut(duration: 0.2)) {
            runner.showCreatePage()
          }
        } label: {
          HStack(spacing: 4) {
            Image(systemName: "chevron.left")
              .font(.system(size: 11, weight: .bold))
            Text("Back")
              .font(.system(size: 12, weight: .bold))
          }
          .foregroundStyle(Theme.accent)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background(colorScheme == .dark ? Color.white.opacity(0.08) : Color(red: 238/255, green: 243/255, blue: 251/255))
          .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
      }
      
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          // API Card
          SettingsCard(title: "API Connection", icon: "key.fill") {
            VStack(alignment: .leading, spacing: 8) {
              Text("API Key")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
              SecureField("sk-...", text: $runner.apiKey)
                .textFieldStyle(.roundedBorder)
              
              Text("Base URL")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
              TextField("http://localhost:20128/v1", text: $runner.baseURL)
                .textFieldStyle(.roundedBorder)
              
              Text("Model")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
              TextField("cx/gpt-5.5", text: $runner.model)
                .textFieldStyle(.roundedBorder)
              
              HStack(spacing: 8) {
                Button {
                  runner.testConnection()
                } label: {
                  Text("Test Connection")
                    .font(.system(size: 11, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                
                Button {
                  runner.saveSetup()
                } label: {
                  Text("Save Config")
                    .font(.system(size: 11, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
              }
              .padding(.top, 4)
              
              if !runner.connectionTestStatus.isEmpty {
                Text(runner.connectionTestStatus)
                  .font(.system(size: 11, weight: .semibold))
                  .foregroundStyle(runner.connectionTestStatus.contains("failed") || runner.connectionTestStatus.contains("Failed") ? Color.red : (runner.connectionTestStatus.contains("OK") ? Color.green : Color.secondary))
                  .padding(.top, 2)
              }
              
              if !runner.saveStatus.isEmpty {
                Text(runner.saveStatus)
                  .font(.system(size: 11, weight: .semibold))
                  .foregroundStyle(runner.saveStatus.contains("failed") || runner.saveStatus.contains("Failed") ? Color.red : (runner.saveStatus.contains("Saved") ? Color.green : Color.secondary))
                  .padding(.top, 2)
              }
            }
          }
          
          // API Bridge Card
          SettingsCard(title: "Voca API Bridge", icon: "bolt.horizontal.fill") {
            VStack(alignment: .leading, spacing: 8) {
              HStack {
                Text("Bridge Status")
                  .font(.system(size: 11, weight: .bold))
                  .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
                Spacer()
                HStack(spacing: 4) {
                  Circle()
                    .fill(runner.runLocalBridge ? (runner.localAPIProcessActive ? Color.green : Color.red) : Color.blue)
                    .frame(width: 6, height: 6)
                  Text(runner.runLocalBridge ? (runner.localAPIProcessActive ? "Active (\(runner.vocaApiBindAddress):\(runner.vocaApiPort))" : "Stopped") : "Remote Enabled")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(runner.runLocalBridge ? (runner.localAPIProcessActive ? .green : .red) : .blue)
                }
              }
              
              Toggle("Run Local Bridge Server", isOn: $runner.runLocalBridge)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
                .toggleStyle(.checkbox)
                .padding(.vertical, 4)

              Text("API Token")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
              TextField("voca_...", text: $runner.vocaApiToken)
                .textFieldStyle(.roundedBorder)

              if runner.runLocalBridge {
                Text("Bind Address")
                  .font(.system(size: 11, weight: .bold))
                  .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
                TextField("127.0.0.1 or 0.0.0.0", text: $runner.vocaApiBindAddress)
                  .textFieldStyle(.roundedBorder)

                Text("API Port")
                  .font(.system(size: 11, weight: .bold))
                  .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
                TextField("22053", text: $runner.vocaApiPort)
                  .textFieldStyle(.roundedBorder)
                
                Text("Set Bind Address to 0.0.0.0 to allow mobile app connection over local Wi-Fi.")
                  .font(.system(size: 10))
                  .foregroundStyle(.secondary)
                  .padding(.top, 2)
              } else {
                Text("Bridge API URL")
                  .font(.system(size: 11, weight: .bold))
                  .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
                TextField("https://voca-bridge.thaonv.online", text: $runner.vocaApiUrl)
                  .textFieldStyle(.roundedBorder)
              }
              
              HStack(spacing: 8) {
                Button {
                  runner.testBridgeConnection()
                } label: {
                  Text("Test Connection")
                    .font(.system(size: 11, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                
                Button {
                  runner.saveSetup()
                } label: {
                  Text("Save Config")
                    .font(.system(size: 11, weight: .bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 28)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
              }
              .padding(.top, 4)
              
              if !runner.bridgeTestStatus.isEmpty {
                Text(runner.bridgeTestStatus)
                  .font(.system(size: 11, weight: .semibold))
                  .foregroundStyle(runner.bridgeTestStatus.contains("failed") || runner.bridgeTestStatus.contains("Failed") ? Color.red : (runner.bridgeTestStatus.contains("OK") ? Color.green : Color.secondary))
                  .padding(.top, 2)
              }
              
              if !runner.saveStatus.isEmpty {
                Text(runner.saveStatus)
                  .font(.system(size: 11, weight: .semibold))
                  .foregroundStyle(runner.saveStatus.contains("failed") || runner.saveStatus.contains("Failed") ? Color.red : (runner.saveStatus.contains("Saved") ? Color.green : Color.secondary))
                  .padding(.top, 2)
              }
            }
          }
          
          // Behavior Card
          SettingsCard(title: "App Behavior", icon: "slider.horizontal.3") {
            VStack(alignment: .leading, spacing: 8) {
              Toggle("Launch at login", isOn: Binding(
                get: { runner.launchAtLogin },
                set: { runner.updateLaunchAtLogin($0) }
              ))
              .toggleStyle(.checkbox)
              
              Toggle("Clear input after success", isOn: $runner.clearInputAfterSuccess)
                .toggleStyle(.checkbox)
                .onChange(of: runner.clearInputAfterSuccess) { _ in runner.saveBehaviorSettings() }
              
              Toggle("Keep popover open while running", isOn: $runner.keepPopoverOpenWhileRunning)
                .toggleStyle(.checkbox)
                .onChange(of: runner.keepPopoverOpenWhileRunning) { _ in runner.saveBehaviorSettings() }
              
              Toggle("Show notification when done", isOn: $runner.showNotificationWhenDone)
                .toggleStyle(.checkbox)
                .onChange(of: runner.showNotificationWhenDone) { _ in runner.saveBehaviorSettings() }
              
              Divider()
                .padding(.vertical, 2)
              
              HStack {
                Label("Global Shortcut", systemImage: "keyboard")
                  .font(.system(size: 11, weight: .bold))
                  .foregroundStyle(Color(red: 100/255, green: 112/255, blue: 134/255))
                Spacer()
                Button {
                  runner.startShortcutRecording()
                } label: {
                  Text(runner.isRecordingShortcut ? "Press keys..." : runner.shortcut.label)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(runner.isRecordingShortcut ? .white : Theme.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(runner.isRecordingShortcut ? Color.red : Theme.accent.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
              }
            }
          }
          
          // Paths Card
          SettingsCard(title: "Workspace Paths", icon: "folder.fill") {
            VStack(alignment: .leading, spacing: 8) {
              PathRow(title: "Dictionary Repo", value: runner.repoPath)
              PathRow(title: "Output Folder", value: URL(fileURLWithPath: runner.repoPath).deletingLastPathComponent().appendingPathComponent("output/vocabulary_cards").path)
              
              Button {
                runner.openOutputFolder()
              } label: {
                Label("Open Output Folder", systemImage: "arrow.right.doc.on.clipboard")
                  .font(.system(size: 11, weight: .bold))
                  .frame(maxWidth: .infinity)
                  .frame(height: 28)
              }
              .buttonStyle(.bordered)
              .controlSize(.small)
            }
          }
          
          Button(role: .destructive) {
            runner.quit()
          } label: {
            Label("Quit Voca App", systemImage: "power")
              .font(.system(size: 12, weight: .bold))
              .foregroundStyle(.white)
              .frame(maxWidth: .infinity)
              .frame(height: 34)
              .background(Color.red.opacity(0.85))
              .clipShape(RoundedRectangle(cornerRadius: 8))
          }
          .buttonStyle(.plain)
          .padding(.top, 4)
        }
        .padding(.horizontal, 2)
      }
      .frame(height: 300)
    }
    .padding(16)
  }
}

struct HistoryPage: View {
  @ObservedObject var runner: VocaRunner
  @Environment(\.colorScheme) var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      // Header
      HStack {
        HStack(spacing: 8) {
          Image(systemName: "clock.fill")
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(Theme.accent)
          Text("History")
            .font(.system(size: 16, weight: .bold))
        }
        Spacer()
        Button {
          withAnimation(.easeInOut(duration: 0.2)) {
            runner.showCreatePage()
          }
        } label: {
          HStack(spacing: 4) {
            Image(systemName: "chevron.left")
              .font(.system(size: 11, weight: .bold))
            Text("Back")
              .font(.system(size: 12, weight: .bold))
          }
          .foregroundStyle(Theme.accent)
          .padding(.horizontal, 8)
          .padding(.vertical, 4)
          .background(colorScheme == .dark ? Color.white.opacity(0.08) : Color(red: 238/255, green: 243/255, blue: 251/255))
          .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
      }
      
      if runner.recentCards.isEmpty {
        VStack(spacing: 12) {
          Spacer()
          Image(systemName: "clock.badge.exclamationmark")
            .font(.system(size: 32))
            .foregroundStyle(.secondary)
          Text("No cards created yet")
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(.secondary)
          Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ScrollView {
          VStack(spacing: 10) {
            ForEach(runner.recentCards) { card in
              RecentCardRow(card: card, runner: runner)
            }
          }
          .padding(.vertical, 2)
        }
      }
    }
    .padding(16)
  }
}

struct RecentCardRow: View {
  let card: VocaRunner.RecentCard
  @ObservedObject var runner: VocaRunner
  @Environment(\.colorScheme) var colorScheme

  var body: some View {
    HStack(spacing: 10) {
      Image(systemName: "doc.richtext")
        .font(.system(size: 16))
        .foregroundStyle(Theme.accent)
        .padding(8)
        .background(Theme.accent.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
      
      VStack(alignment: .leading, spacing: 2) {
        Text(card.word)
          .font(.system(size: 13, weight: .bold))
          .lineLimit(1)
        Text(card.file)
          .font(.system(size: 10))
          .foregroundStyle(.secondary)
          .lineLimit(1)
          .truncationMode(.middle)
      }
      
      Spacer()
      
      HStack(spacing: 4) {
        Button {
          open(file: card.file)
        } label: {
          Image(systemName: "eye")
            .font(.system(size: 12))
            .foregroundStyle(colorScheme == .dark ? .white : Color(red: 48/255, green: 65/255, blue: 95/255))
            .frame(width: 28, height: 28)
            .background(colorScheme == .dark ? Color.white.opacity(0.1) : Color(red: 238/255, green: 243/255, blue: 251/255))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        
        Button {
          reveal(file: card.file)
        } label: {
          Image(systemName: "folder")
            .font(.system(size: 12))
            .foregroundStyle(colorScheme == .dark ? .white : Color(red: 48/255, green: 65/255, blue: 95/255))
            .frame(width: 28, height: 28)
            .background(colorScheme == .dark ? Color.white.opacity(0.1) : Color(red: 238/255, green: 243/255, blue: 251/255))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
      }
    }
    .padding(8)
    .background(colorScheme == .dark ? Color(red: 30/255, green: 41/255, blue: 59/255) : Color.white)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .overlay(
      RoundedRectangle(cornerRadius: 8)
        .stroke(colorScheme == .dark ? Color.secondary.opacity(0.15) : Color(red: 217/255, green: 224/255, blue: 236/255).opacity(0.6), lineWidth: 1)
    )
  }

  private func outputURL(file: String) -> URL? {
    let dir = runner.lastOutputDir ?? URL(fileURLWithPath: runner.repoPath).deletingLastPathComponent().appendingPathComponent("output/vocabulary_cards").path
    return URL(fileURLWithPath: dir).appendingPathComponent(file)
  }

  private func open(file: String) {
    guard let url = outputURL(file: file) else { return }
    NSWorkspace.shared.open(url)
  }

  private func reveal(file: String) {
    guard let url = outputURL(file: file) else { return }
    NSWorkspace.shared.activateFileViewerSelecting([url])
  }
}

struct SettingsCard<Content: View>: View {
  let title: String
  let icon: String
  let content: Content

  init(title: String, icon: String, @ViewBuilder content: () -> Content) {
    self.title = title
    self.icon = icon
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Label {
        Text(title)
          .font(.system(size: 13, weight: .bold))
      } icon: {
        Image(systemName: icon)
          .font(.system(size: 12))
          .foregroundStyle(Theme.accent)
      }
      .padding(.bottom, 2)
      
      content
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(nsColor: .controlBackgroundColor))
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .overlay(
      RoundedRectangle(cornerRadius: 12)
        .stroke(Color.secondary.opacity(0.1), lineWidth: 1)
    )
  }
}

struct PathRow: View {
  let title: String
  let value: String

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title)
        .font(.caption)
        .foregroundStyle(.secondary)
      Text(value)
        .font(.caption)
        .lineLimit(1)
        .truncationMode(.middle)
    }
  }
}

struct ShortcutBadge: View {
  let label: String

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "keyboard")
        .font(.system(size: 10))
      Text(label)
        .font(.system(size: 10, weight: .bold))
    }
    .foregroundStyle(Theme.accent)
    .padding(.horizontal, 8)
    .padding(.vertical, 8)
    .background(Theme.accent.opacity(0.15))
    .clipShape(RoundedRectangle(cornerRadius: 8))
  }
}

struct ProgressPanel: View {
  @ObservedObject var runner: VocaRunner
  @Environment(\.colorScheme) var colorScheme

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Image(systemName: "sparkles")
          .foregroundStyle(Theme.accent)
        Text(runner.isRunning ? "Creating Voca Card..." : "Card Creation Finished")
          .font(.system(size: 13, weight: .bold))
        Spacer()
        if runner.isRunning {
          ProgressView()
            .controlSize(.small)
        }
      }
      .padding(.bottom, 2)
      
      VStack(spacing: 6) {
        ForEach(VocaRunner.JobStage.allCases, id: \.self) { stage in
          HStack(spacing: 8) {
            StageIcon(stage: stage, runner: runner)
            
            Text(stage.rawValue)
              .font(.system(size: 12, weight: runner.currentStage == stage ? .semibold : .regular))
              .foregroundStyle(runner.currentStage == stage ? Color.primary : (runner.completedStages.contains(stage) || runner.currentStage == .complete ? Color.primary.opacity(0.8) : Color.secondary))
            
            Spacer()
            
            if runner.completedStages.contains(stage) || runner.currentStage == .complete {
              Text("Done")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color(red: 19/255, green: 115/255, blue: 51/255))
            } else if runner.currentStage == stage {
              Text("Running")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.accent)
            } else {
              Text("Pending")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
            }
          }
          .padding(.vertical, 4)
          .padding(.horizontal, 6)
          .background(runner.currentStage == stage ? Theme.accent.opacity(0.08) : Color.clear)
          .clipShape(RoundedRectangle(cornerRadius: 6))
        }
      }
    }
    .padding(12)
    .background(colorScheme == .dark ? Color(red: 20/255, green: 24/255, blue: 41/255) : Color.white)
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .overlay(
      RoundedRectangle(cornerRadius: 8)
        .stroke(colorScheme == .dark ? Theme.accent.opacity(0.18) : Color(red: 229/255, green: 231/255, blue: 235/255), lineWidth: 1)
    )
  }
}

struct StageIcon: View {
  let stage: VocaRunner.JobStage
  @ObservedObject var runner: VocaRunner

  var body: some View {
    if runner.completedStages.contains(stage) || runner.currentStage == .complete {
      Image(systemName: "checkmark.circle.fill")
        .font(.system(size: 13, weight: .bold))
        .foregroundStyle(Color(red: 19/255, green: 115/255, blue: 51/255))
    } else if runner.currentStage == stage {
      ProgressView()
        .controlSize(.mini)
        .frame(width: 13, height: 13)
    } else {
      Image(systemName: "circle")
        .font(.system(size: 13))
        .foregroundStyle(.secondary)
    }
  }
}

struct ResultPanel: View {
  @ObservedObject var runner: VocaRunner
  @Environment(\.colorScheme) var colorScheme

  var body: some View {
    if let latest = runner.currentResult {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 8) {
          Image(systemName: "sparkles.rectangle.stack.fill")
            .font(.system(size: 16))
            .foregroundStyle(Color(red: 19/255, green: 115/255, blue: 51/255))
          
          VStack(alignment: .leading, spacing: 1) {
            Text(latest.word)
              .font(.system(size: 14, weight: .bold))
            Text(latest.file)
              .font(.system(size: 11))
              .foregroundStyle(.secondary)
              .lineLimit(1)
              .truncationMode(.middle)
          }
          
          Spacer()
          
          Text("Synced")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(Color(red: 19/255, green: 115/255, blue: 51/255))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color(red: 19/255, green: 115/255, blue: 51/255).opacity(0.12))
            .clipShape(Capsule())
        }
        
        Divider()
          .opacity(0.5)
        
        HStack(spacing: 8) {
          Button {
            open(file: latest.file)
          } label: {
            Label("Open Card", systemImage: "eye")
              .font(.system(size: 12, weight: .bold))
              .foregroundStyle(Theme.accent)
              .frame(maxWidth: .infinity)
              .frame(height: 32)
              .background(colorScheme == .dark ? Color.white.opacity(0.08) : Color(red: 243/255, green: 244/255, blue: 246/255))
              .clipShape(RoundedRectangle(cornerRadius: 6))
          }
          .buttonStyle(.plain)
          
          Button {
            reveal(file: latest.file)
          } label: {
            Label("Show in Finder", systemImage: "folder")
              .font(.system(size: 12, weight: .bold))
              .foregroundStyle(colorScheme == .dark ? .white : Color(red: 48/255, green: 65/255, blue: 95/255))
              .frame(maxWidth: .infinity)
              .frame(height: 32)
              .background(colorScheme == .dark ? Color.white.opacity(0.08) : Color(red: 243/255, green: 244/255, blue: 246/255))
              .clipShape(RoundedRectangle(cornerRadius: 6))
          }
          .buttonStyle(.plain)
        }
      }
      .padding(12)
      .background(colorScheme == .dark ? Color(red: 20/255, green: 24/255, blue: 41/255) : Color.white)
      .clipShape(RoundedRectangle(cornerRadius: 8))
      .overlay(
        RoundedRectangle(cornerRadius: 8)
          .stroke(colorScheme == .dark ? Theme.accent.opacity(0.18) : Color(red: 229/255, green: 231/255, blue: 235/255), lineWidth: 1)
      )
    }
  }

  private func outputURL(file: String) -> URL? {
    guard let outputDir = runner.lastOutputDir else { return nil }
    return URL(fileURLWithPath: outputDir).appendingPathComponent(file)
  }

  private func open(file: String) {
    guard let url = outputURL(file: file) else { return }
    NSWorkspace.shared.open(url)
  }

  private func reveal(file: String) {
    guard let url = outputURL(file: file) else { return }
    NSWorkspace.shared.activateFileViewerSelecting([url])
  }
}
