import ExpoModulesCore
import AVFoundation
import CoreSpotlight

class TextToSpeechManager: NSObject {
  static let shared = TextToSpeechManager()
  private let synthesizer = AVSpeechSynthesizer()
  
  func speak(_ text: String) {
    DispatchQueue.main.async {
      let session = AVAudioSession.sharedInstance()
      try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
      try? session.setActive(true)
      
      if self.synthesizer.isSpeaking {
        self.synthesizer.stopSpeaking(at: .immediate)
      }
      
      let utterance = AVSpeechUtterance(string: text)
      utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
      utterance.rate = 0.48
      self.synthesizer.speak(utterance)
    }
  }
}

public class VocaNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VocaNative")

    Function("saveSharedSetting") { (key: String, value: String) in
      let defaults = UserDefaults(suiteName: "group.com.voca.dictionary.mobile")
      defaults?.set(value, forKey: key)
      defaults?.synchronize()
    }

    Function("readSharedSetting") { (key: String) -> String? in
      let defaults = UserDefaults(suiteName: "group.com.voca.dictionary.mobile")
      return defaults?.string(forKey: key)
    }

    Function("clearSharedSetting") { (key: String) in
      let defaults = UserDefaults(suiteName: "group.com.voca.dictionary.mobile")
      defaults?.removeObject(forKey: key)
      defaults?.synchronize()
    }

    Function("speak") { (text: String) in
      TextToSpeechManager.shared.speak(text)
    }

    Function("indexSearchableItems") { (items: [[String: String]]) in
      var searchableItems: [CSSearchableItem] = []
      
      for item in items {
        guard let id = item["id"], let word = item["word"] else { continue }
        
        let attributeSet = CSSearchableItemAttributeSet(itemContentType: "public.text")
        attributeSet.title = word
        attributeSet.contentDescription = item["meaningVi"] ?? item["meaningEn"] ?? ""
        
        if let pronunciation = item["pronunciation"], !pronunciation.isEmpty {
          attributeSet.keywords = [word, pronunciation]
        } else {
          attributeSet.keywords = [word]
        }
        
        let searchableItem = CSSearchableItem(
          uniqueIdentifier: id,
          domainIdentifier: "com.voca.cards",
          attributeSet: attributeSet
        )
        searchableItems.append(searchableItem)
      }
      
      CSSearchableIndex.default().indexSearchableItems(searchableItems) { error in
        if let error = error {
          print("Spotlight indexing error: \(error.localizedDescription)")
        } else {
          print("Spotlight indexing succeeded for \(searchableItems.count) items")
        }
      }
    }

    Function("deleteSearchableItems") { (ids: [String]) in
      CSSearchableIndex.default().deleteSearchableItems(withIdentifiers: ids) { error in
        if let error = error {
          print("Spotlight deletion error: \(error.localizedDescription)")
        }
      }
    }

    Function("clearAllSearchableItems") { () in
      CSSearchableIndex.default().deleteAllSearchableItems { error in
        if let error = error {
          print("Spotlight clear error: \(error.localizedDescription)")
        }
      }
    }

    Function("getAppGroupDirectory") { () -> String? in
      let fileManager = FileManager.default
      let containerURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: "group.com.voca.dictionary.mobile")
      return containerURL?.absoluteString
    }
  }
}
