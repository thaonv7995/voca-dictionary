import { Platform } from "react-native";
import { requireNativeModule } from "expo";

let VocaNative: any = null;
if (Platform.OS === "ios") {
  try {
    VocaNative = requireNativeModule("VocaNative");
  } catch (e) {
    console.warn("VocaNative module not available:", e);
  }
}

export function saveSharedSetting(key: string, value: string): void {
  if (Platform.OS === "ios" && VocaNative) {
    try {
      VocaNative.saveSharedSetting(key, value);
    } catch (e) {
      console.warn("Failed to call saveSharedSetting:", e);
    }
  }
}

export function readSharedSetting(key: string): string | null {
  if (Platform.OS === "ios" && VocaNative) {
    try {
      return VocaNative.readSharedSetting(key);
    } catch (e) {
      console.warn("Failed to call readSharedSetting:", e);
    }
  }
  return null;
}

export function clearSharedSetting(key: string): void {
  if (Platform.OS === "ios" && VocaNative) {
    try {
      VocaNative.clearSharedSetting(key);
    } catch (e) {
      console.warn("Failed to call clearSharedSetting:", e);
    }
  }
}

export function speak(text: string): void {
  if (Platform.OS === "ios" && VocaNative) {
    try {
      VocaNative.speak(text);
    } catch (e) {
      console.warn("Failed to call speak:", e);
    }
  }
}

export function indexSearchableItems(items: Array<{ id: string; word: string; pronunciation: string; meaningVi: string; meaningEn: string }>): void {
  if (Platform.OS === "ios" && VocaNative) {
    try {
      VocaNative.indexSearchableItems(items);
    } catch (e) {
      console.warn("Failed to call indexSearchableItems:", e);
    }
  }
}

export function deleteSearchableItems(ids: string[]): void {
  if (Platform.OS === "ios" && VocaNative) {
    try {
      VocaNative.deleteSearchableItems(ids);
    } catch (e) {
      console.warn("Failed to call deleteSearchableItems:", e);
    }
  }
}

export function clearAllSearchableItems(): void {
  if (Platform.OS === "ios" && VocaNative) {
    try {
      VocaNative.clearAllSearchableItems();
    } catch (e) {
      console.warn("Failed to call clearAllSearchableItems:", e);
    }
  }
}

export function getAppGroupDirectory(): string | null {
  if (Platform.OS === "ios" && VocaNative) {
    try {
      return VocaNative.getAppGroupDirectory();
    } catch (e) {
      console.warn("Failed to call getAppGroupDirectory:", e);
    }
  }
  return null;
}
