import AsyncStorage from "@react-native-async-storage/async-storage";

/** Set after a successful /v1/cards fetch (including 304 not_modified). Means local cache should defer to API when online. */
const cloudSyncTrustKey = "voca.cards.syncedWithCloudAt";

export async function markCardsCloudSyncTrust(): Promise<void> {
  await AsyncStorage.setItem(cloudSyncTrustKey, new Date().toISOString());
}

export async function hasCardsCloudSyncTrust(): Promise<boolean> {
  const v = await AsyncStorage.getItem(cloudSyncTrustKey);
  return Boolean(v?.length);
}

/** Call when switching API base URL (different cloud). */
export async function clearCardsCloudSyncTrust(): Promise<void> {
  await AsyncStorage.removeItem(cloudSyncTrustKey);
}
