import { Alert, Platform, ToastAndroid } from 'react-native';

export function toast(msg: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  } else {
    // Minimal iOS fallback — non-blocking would need a lib; this is fine for now.
    Alert.alert('', msg);
  }
}
