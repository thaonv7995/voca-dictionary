import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Dimensions,
  SafeAreaView,
  Animated,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";
import { type MobileCard, patchCardLevel } from "./cards";
import { AudioIconButton, ensureCardAudio } from "./audio";
import { colors } from "./theme";

const { height: windowHeight, width: windowWidth } = Dimensions.get("window");

function FlashcardItem({
  item,
  isCurrent,
  showMeaningAlways,
}: {
  item: MobileCard;
  isCurrent: boolean;
  showMeaningAlways: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isCurrent) {
      setFlipped(false);
      flipAnim.setValue(0);
    }
  }, [isCurrent]);

  const flipCard = () => {
    if (showMeaningAlways) return;

    Animated.spring(flipAnim, {
      toValue: flipped ? 0 : 1,
      friction: 7,
      tension: 14,
      useNativeDriver: true,
    }).start();
    setFlipped(!flipped);
  };

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });
  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["180deg", "360deg"],
  });

  const frontAnimatedStyle = { transform: [{ rotateY: frontInterpolate }] };
  const backAnimatedStyle = { transform: [{ rotateY: backInterpolate }] };

  const ipaText = item.ipa || item.pronunciation;
  // take only 1 example
  const examples = item.examples && item.examples.length > 0 ? item.examples.slice(0, 1) : [];

  return (
    <View style={styles.itemContainer}>
      <Pressable style={styles.cardTouchable} onPress={flipCard}>
        <View style={styles.cardWrapper}>
          {/* FRONT */}
          <Animated.View style={[styles.cardFace, styles.cardFront, frontAnimatedStyle]}>
            <View style={styles.cardHeader}>
              <View style={styles.partOfSpeechPill}>
                <Text style={styles.partOfSpeechText} numberOfLines={1}>{item.partOfSpeech}</Text>
              </View>
            </View>
            
            <View style={styles.cardBody}>
              <Text style={styles.word} adjustsFontSizeToFit numberOfLines={1}>
                {item.word}
              </Text>
              {ipaText ? <Text style={styles.ipa}>{ipaText}</Text> : null}
              {showMeaningAlways ? (
                <Text style={styles.inlineMeaningText}>
                  {item.meaningVi || item.meaningEn || "No meaning available"}
                </Text>
              ) : null}
            </View>

            <View style={styles.examplesContainer}>
              {examples.map((ex, i) => (
                <Text key={i} style={styles.exampleText}>
                  "{ex}"
                </Text>
              ))}
              {!showMeaningAlways && (
                <Text style={styles.hintTextTap}>Tap to see meaning</Text>
              )}
            </View>
          </Animated.View>
          
          {/* BACK */}
          <Animated.View style={[styles.cardFace, styles.cardBack, backAnimatedStyle]}>
            <Ionicons name="sparkles" size={32} color={colors.accent} style={{ marginBottom: 16 }} />
            <Text style={styles.meaningHeading}>Meaning</Text>
            <Text style={styles.meaningText}>
              {item.meaningVi || item.meaningEn || "No meaning available"}
            </Text>
            <Text style={styles.hintTextTap}>Tap to hide</Text>
          </Animated.View>
        </View>
      </Pressable>
    </View>
  );
}

export function FlashcardModal({
  visible,
  cards,
  initialIndex = 0,
  onClose,
  onLevelChange,
}: {
  visible: boolean;
  cards: MobileCard[];
  initialIndex?: number;
  onClose: () => void;
  onLevelChange?: (card: MobileCard, level: MobileCard["level"]) => void;
}) {
  const [sessionCards, setSessionCards] = useState<MobileCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  
  const [autoPlay, setAutoPlay] = useState(false);
  const [showMeaningAlways, setShowMeaningAlways] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("voca.flashcard.autoplay").then(val => {
      if (val === "true") setAutoPlay(true);
    });
    AsyncStorage.getItem("voca.flashcard.showMeaning").then(val => {
      if (val === "true") setShowMeaningAlways(true);
    });
  }, []);

  const toggleAutoPlay = () => {
    const next = !autoPlay;
    setAutoPlay(next);
    AsyncStorage.setItem("voca.flashcard.autoplay", String(next)).catch(() => {});
  };

  const toggleShowMeaning = () => {
    const next = !showMeaningAlways;
    setShowMeaningAlways(next);
    AsyncStorage.setItem("voca.flashcard.showMeaning", String(next)).catch(() => {});
  };

  // Initialize and shuffle cards when modal becomes visible
  useEffect(() => {
    if (visible && cards.length > 0) {
      const shuffled = [...cards].sort(() => Math.random() - 0.5);
      setSessionCards(shuffled);
      setCurrentIndex(0);
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
      }, 100);
    } else if (!visible) {
      setSessionCards([]);
      setCurrentIndex(0);
    }
  }, [visible]);

  // Pre-load audio for the next 5 cards
  useEffect(() => {
    if (!visible || sessionCards.length === 0) return;
    const nextCards = sessionCards.slice(currentIndex + 1, currentIndex + 6);
    
    // Background preload
    void Promise.allSettled(
      nextCards.map(card => ensureCardAudio(card))
    );
  }, [currentIndex, visible, sessionCards]);

  const handleScroll = (event: any) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const index = Math.round(offsetY / windowHeight);
    if (index !== currentIndex && index >= 0 && index < sessionCards.length) {
      setCurrentIndex(index);
    }
  };

  const currentCard = sessionCards[currentIndex];

  const handleKnown = async () => {
    if (!currentCard) return;
    if (onLevelChange) {
      onLevelChange(currentCard, "known");
    }
    patchCardLevel(currentCard.id, "known").catch(() => {});
    
    // Exclude the card from the list
    if (sessionCards.length <= 1) {
      onClose();
      return;
    }

    setSessionCards((prev) => {
      const next = prev.filter((c) => c.id !== currentCard.id);
      return next;
    });

    // If we removed the last item, we must scroll back by one
    if (currentIndex >= sessionCards.length - 1) {
      const newIndex = Math.max(0, currentIndex - 1);
      setCurrentIndex(newIndex);
      // Wait a tick for the array to update before scrolling
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: newIndex, animated: true });
      }, 0);
    }
  };

  const renderItem = useCallback(({ item, index }: { item: MobileCard; index: number }) => {
    return <FlashcardItem item={item} isCurrent={index === currentIndex} showMeaningAlways={showMeaningAlways} />;
  }, [currentIndex, showMeaningAlways]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={styles.container}>
        {sessionCards.length > 0 ? (
          <FlatList
            ref={flatListRef}
            data={sessionCards}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            pagingEnabled
            showsVerticalScrollIndicator={false}
            onMomentumScrollEnd={handleScroll}
            getItemLayout={(data, index) => ({
              length: windowHeight,
              offset: windowHeight * index,
              index,
            })}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No cards available</Text>
            <Pressable style={[styles.actionBtn, { marginTop: 20 }]} onPress={onClose}>
              <Ionicons name="close" size={28} color="#FFF" />
            </Pressable>
          </View>
        )}
        
        {/* FIXED TIKTOK STYLE RIGHT ACTIONS */}
        {sessionCards.length > 0 && currentCard && (
          <View style={styles.fixedRightActions} pointerEvents="box-none">
            <View style={styles.actionItem}>
              <View style={styles.actionBtnAudio}>
                <AudioIconButton card={currentCard} showError={false} autoPlayTrigger={autoPlay} />
              </View>
            </View>

            <Pressable style={styles.actionItem} onPress={handleKnown}>
              <View style={styles.actionBtn}>
                <Ionicons name="checkmark-outline" size={24} color="rgba(255,255,255,0.7)" />
              </View>
            </Pressable>

            <Pressable style={styles.actionItem} onPress={onClose}>
              <View style={styles.actionBtn}>
                <Ionicons name="close-outline" size={24} color="rgba(255,255,255,0.7)" />
              </View>
            </Pressable>
          </View>
        )}

        {/* Top Progress indicator overlay */}
        {sessionCards.length > 0 && (
          <SafeAreaView style={styles.topOverlay} pointerEvents="box-none">
            <View style={styles.topBar}>
              <View style={styles.progressPill}>
                <Text style={styles.progressText}>
                  {currentIndex + 1} / {sessionCards.length}
                </Text>
              </View>
              <View style={styles.settingsGroup}>
                <Pressable style={styles.settingBtn} onPress={toggleAutoPlay}>
                  <Ionicons name={autoPlay ? "volume-high" : "volume-mute"} size={22} color={autoPlay ? colors.accentMid : "#FFF"} />
                </Pressable>
                <Pressable style={styles.settingBtn} onPress={toggleShowMeaning}>
                  <Ionicons name={showMeaningAlways ? "eye" : "eye-off"} size={22} color={showMeaningAlways ? colors.accentMid : "#FFF"} />
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  topOverlay: {
    position: "absolute",
    top: 0,
    width: "100%",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    marginTop: Platform.OS === "android" ? 20 : 10,
  },
  settingsGroup: {
    flexDirection: "row",
    gap: 12,
  },
  settingBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
  },
  progressPill: {
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  progressText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "bold",
    letterSpacing: 1,
  },
  itemContainer: {
    height: windowHeight,
    width: windowWidth,
    justifyContent: "center",
    alignItems: "center",
  },
  cardTouchable: {
    width: "80%",
    height: "68%",
  },
  cardWrapper: {
    width: "100%",
    height: "100%",
  },
  cardFace: {
    position: "absolute",
    width: "100%",
    height: "100%",
    backfaceVisibility: "hidden",
    borderRadius: 36, // extra rounded for modern look
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  cardFront: {
    backgroundColor: "#18181B", // Zinc 900
    justifyContent: "space-between",
  },
  cardBack: {
    backgroundColor: "#0F172A", // Slate 900
    justifyContent: "center",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "center",
    width: "100%",
    alignItems: "center",
  },
  partOfSpeechPill: {
    backgroundColor: "rgba(26, 122, 100, 0.2)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    flexShrink: 1,
    marginRight: 8,
  },
  partOfSpeechText: {
    color: colors.accentMid,
    fontWeight: "800",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    flexShrink: 1,
  },
  cardBody: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  word: {
    fontSize: 56,
    fontWeight: "600",
    color: "#F8FAFC",
    textAlign: "center",
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  ipa: {
    fontSize: 20,
    color: "#94A3B8", // Slate 400
    fontStyle: "italic",
    letterSpacing: 0.5,
  },
  examplesContainer: {
    width: "100%",
    alignItems: "center",
    paddingTop: 20,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    minHeight: 100,
    justifyContent: "center",
  },
  exampleText: {
    fontSize: 16,
    color: "#CBD5E1",
    textAlign: "center",
    fontStyle: "italic",
    marginBottom: 8,
    lineHeight: 24,
  },
  inlineMeaningText: {
    fontSize: 24,
    color: "#FDE047", // Soft vibrant yellow to make it pop and extremely readable
    fontFamily: Platform.OS === "ios" ? "AvenirNext-DemiBold" : "sans-serif-medium",
    fontWeight: "600",
    textAlign: "center",
    marginTop: 16,
  },
  hintTextTap: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
    marginTop: 10,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  meaningHeading: {
    fontSize: 14,
    color: "#94A3B8",
    textTransform: "uppercase",
    marginBottom: 20,
    fontWeight: "800",
    letterSpacing: 2,
  },
  meaningText: {
    fontSize: 32,
    color: "#F8FAFC",
    textAlign: "center",
    fontWeight: "700",
    lineHeight: 44,
  },
  fixedRightActions: {
    position: "absolute",
    right: 16,
    bottom: 40,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 16,
    zIndex: 100,
  },
  actionItem: {
    alignItems: "center",
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  actionBtnAudio: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    transform: [{ scale: 1.05 }],
  },
  actionLabel: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 18,
    color: "#FFF",
    fontWeight: "600",
  },
});
