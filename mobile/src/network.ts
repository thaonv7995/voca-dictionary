import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

export type NetworkState = {
  online: boolean;
  checked: boolean;
  label: string;
};

export function useNetworkState(): NetworkState {
  const [state, setState] = useState<NetworkState>({ online: true, checked: false, label: "Checking network" });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((network) => {
      const online = Boolean(network.isConnected && network.isInternetReachable !== false);
      setState({
        online,
        checked: true,
        label: online ? network.type || "Online" : "Offline",
      });
    });
    return unsubscribe;
  }, []);

  return state;
}
