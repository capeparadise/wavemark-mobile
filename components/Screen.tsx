import React from 'react';
import { View, ViewProps } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export default function Screen({ children, style, ...rest }: ViewProps) {
  useSafeAreaInsets(); // ensures provider is present
  return (
    <SafeAreaView style={{ flex: 1 }} edges={[ 'top', 'left', 'right' ]}>
      <View style={[{ flex: 1, paddingHorizontal: 16, paddingTop: 4 }, style]} {...rest}>
        {children}
      </View>
    </SafeAreaView>
  );
}
