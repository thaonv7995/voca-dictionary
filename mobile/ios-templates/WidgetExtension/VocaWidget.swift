import WidgetKit
import SwiftUI
import AppIntents



struct WidgetCard: Codable {
    let id: String
    let word: String
    let pronunciation: String?
    let partOfSpeech: String?
    let meaningEn: String?
    let meaningVi: String?
}

struct WidgetSnapshot: Codable {
    let cards: [WidgetCard]
}

@available(iOS 17.0, *)
struct RandomCardIntent: AppIntent {
    static var title: LocalizedStringResource = "Random Card"
    static var description = IntentDescription("Show a random vocabulary card in the widget.")
    
    func perform() async throws -> some IntentResult {
        let defaults = UserDefaults(suiteName: "group.com.voca.dictionary.mobile")
        let cards = loadSharedCards()
        if !cards.isEmpty {
            let currentIndex = defaults?.integer(forKey: "voca.widget.currentCardIndex") ?? 0
            var nextIndex = currentIndex
            if cards.count > 1 {
                // Keep generating a random index until it changes to avoid showing the same card
                while nextIndex == currentIndex {
                    nextIndex = Int.random(in: 0..<cards.count)
                }
            } else {
                nextIndex = 0
            }
            defaults?.set(nextIndex, forKey: "voca.widget.currentCardIndex")
            defaults?.synchronize()
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

func loadSharedCards() -> [WidgetCard] {
    let fileManager = FileManager.default
    guard let containerURL = fileManager.containerURL(forSecurityApplicationGroupIdentifier: "group.com.voca.dictionary.mobile") else {
        return []
    }
    let fileURL = containerURL.appendingPathComponent("cards.json")
    
    guard let data = try? Data(contentsOf: fileURL) else {
        return []
    }
    
    do {
        let snapshot = try JSONDecoder().decode(WidgetSnapshot.self, from: data)
        return snapshot.cards
    } catch {
        return [
            WidgetCard(
                id: "error",
                word: "JSON Decode Error",
                pronunciation: nil,
                partOfSpeech: "error",
                meaningEn: String(describing: error),
                meaningVi: error.localizedDescription
            )
        ]
    }
}

struct VocaEntry: TimelineEntry {
    let date: Date
    let card: WidgetCard?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> VocaEntry {
        VocaEntry(date: Date(), card: WidgetCard(id: "1", word: "vocabulary", pronunciation: "vəˈkæbjəleri", partOfSpeech: "noun", meaningEn: "A body of words used in a particular language.", meaningVi: "Từ vựng"))
    }

    func getSnapshot(in context: Context, completion: @escaping (VocaEntry) -> ()) {
        let cards = loadSharedCards()
        let card = cards.first ?? WidgetCard(id: "1", word: "vocabulary", pronunciation: "vəˈkæbjəleri", partOfSpeech: "noun", meaningEn: "A body of words used in a particular language.", meaningVi: "Từ vựng")
        let entry = VocaEntry(date: Date(), card: card)
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        var entries: [VocaEntry] = []
        let cards = loadSharedCards()
        
        let defaults = UserDefaults(suiteName: "group.com.voca.dictionary.mobile")
        let currentIndex = defaults?.integer(forKey: "voca.widget.currentCardIndex") ?? 0
        
        let card: WidgetCard?
        if cards.isEmpty {
            card = nil
        } else {
            let index = currentIndex < cards.count ? currentIndex : 0
            card = cards[index]
        }
        
        let entry = VocaEntry(date: Date(), card: card)
        entries.append(entry)
        
        let nextUpdate = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
        let timeline = Timeline(entries: entries, policy: .after(nextUpdate))
        completion(timeline)
    }
}

struct VocaWidgetEntryView : View {
    var entry: Provider.Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        if let card = entry.card {
            Group {
                switch family {
                case .systemSmall:
                    SmallWidgetView(card: card)
                case .systemMedium:
                    MediumWidgetView(card: card)
                case .accessoryCircular:
                    AccessoryCircularWidgetView(card: card)
                case .accessoryRectangular:
                    AccessoryRectangularWidgetView(card: card)
                case .accessoryInline:
                    AccessoryInlineWidgetView(card: card)
                default:
                    MediumWidgetView(card: card)
                }
            }
            .widgetURL(URL(string: "voca-mobile://cards/\(card.id)"))
        } else {
            EmptyWidgetView()
        }
    }
}

struct SmallWidgetView: View {
    let card: WidgetCard
    
    var body: some View {
        ZStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Voca")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundColor(Color(hex: "0e5648"))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color(hex: "e8f4f1"))
                        .cornerRadius(4)
                    Spacer()
                }
                
                Text(card.word)
                    .font(.system(.subheadline, design: .rounded))
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
                    .lineLimit(1)
                
                if let pos = card.partOfSpeech, !pos.isEmpty {
                    Text(pos)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                if let meaningVi = card.meaningVi, !meaningVi.isEmpty {
                    Text(meaningVi)
                        .font(.system(size: 12))
                        .foregroundColor(.primary)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.trailing, 20)
            .padding(.bottom, 12)
            
            if #available(iOS 17.0, *) {
                // Shuffle Button at bottom-right
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Button(intent: RandomCardIntent()) {
                            Image(systemName: "shuffle.circle.fill")
                                .font(.system(size: 18))
                                .foregroundColor(Color(hex: "0e5648"))
                                .padding(8)
                        }
                        .buttonStyle(.plain)
                        .padding(.bottom, -8)
                        .padding(.trailing, -8)
                    }
                }
            } else {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Image(systemName: "shuffle.circle.fill")
                            .font(.system(size: 18))
                            .foregroundColor(Color(hex: "0e5648"))
                            .padding(.bottom, 4)
                            .padding(.trailing, 4)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

struct MediumWidgetView: View {
    let card: WidgetCard
    
    var body: some View {
        ZStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(card.word)
                        .font(.system(.title3, design: .rounded))
                        .fontWeight(.bold)
                        .foregroundColor(.primary)
                    
                    if let pos = card.partOfSpeech, !pos.isEmpty {
                        Text(pos)
                            .font(.system(size: 10, weight: .bold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color(hex: "e8f4f1"))
                            .foregroundColor(Color(hex: "0e5648"))
                            .cornerRadius(4)
                    }
                    
                    Spacer()
                }
                
                if let pron = card.pronunciation, !pron.isEmpty {
                    Text("/\(pron)/")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                if let meaningVi = card.meaningVi, !meaningVi.isEmpty {
                    Text(meaningVi)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.primary)
                        .lineLimit(1)
                }
                
                if let meaningEn = card.meaningEn, !meaningEn.isEmpty {
                    Text(meaningEn)
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.trailing, 24)
            .padding(.bottom, 12)
            
            if #available(iOS 17.0, *) {
                // Shuffle Button at bottom-right
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Button(intent: RandomCardIntent()) {
                            Image(systemName: "shuffle.circle.fill")
                                .font(.system(size: 22))
                                .foregroundColor(Color(hex: "0e5648"))
                                .padding(8)
                        }
                        .buttonStyle(.plain)
                        .padding(.bottom, -8)
                        .padding(.trailing, -8)
                    }
                }
            } else {
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        Image(systemName: "shuffle.circle.fill")
                            .font(.system(size: 22))
                            .foregroundColor(Color(hex: "0e5648"))
                            .padding(.bottom, 4)
                            .padding(.trailing, 4)
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

struct AccessoryCircularWidgetView: View {
    let card: WidgetCard
    
    var body: some View {
        VStack(spacing: 2) {
            Image(systemName: "book.pages")
                .font(.system(size: 14))
            Text(card.word.prefix(3).uppercased())
                .font(.system(size: 8, weight: .bold, design: .rounded))
        }
    }
}

struct AccessoryRectangularWidgetView: View {
    let card: WidgetCard
    
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(card.word)
                .font(.system(.headline, design: .rounded))
                .fontWeight(.bold)
                .lineLimit(1)
            
            if let pron = card.pronunciation, !pron.isEmpty {
                Text("/\(pron)/")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            
            if let meaningVi = card.meaningVi, !meaningVi.isEmpty {
                Text(meaningVi)
                    .font(.system(.caption))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct AccessoryInlineWidgetView: View {
    let card: WidgetCard
    
    var body: some View {
        Text("Voca: \(card.word)")
    }
}

struct EmptyWidgetView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("Voca Dictionary")
                .font(.system(.headline, design: .rounded))
                .foregroundColor(Color(hex: "0e5648"))
            Text("Hãy mở ứng dụng chính và đồng bộ danh sách từ vựng.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

@main
struct VocaWidget: Widget {
    let kind: String = "VocaWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOS 17.0, *) {
                VocaWidgetEntryView(entry: entry)
                    .containerBackground(.background, for: .widget)
            } else {
                VocaWidgetEntryView(entry: entry)
                    .padding()
                    .background(Color(.systemBackground))
            }
        }
        .configurationDisplayName("Voca Card")
        .description("Xem và ôn tập từ vựng Voca Dictionary của bạn.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

private extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3:
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (1, 1, 1, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
