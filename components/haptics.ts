// Tiny safe haptics wrapper
import * as ExpoHaptics from 'expo-haptics';

export const H = {
  success: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Success).catch(() => {}),
  error: () => ExpoHaptics.notificationAsync(ExpoHaptics.NotificationFeedbackType.Error).catch(() => {}),
  tap: () => ExpoHaptics.impactAsync(ExpoHaptics.ImpactFeedbackStyle.Light).catch(() => {}),
};
