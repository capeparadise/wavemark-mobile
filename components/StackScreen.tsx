import { useHeaderHeight } from '@react-navigation/elements';
import React, { useMemo } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';
import Screen from './Screen';

type Props = React.ComponentProps<typeof Screen> & {
  edges?: Edge[];
};

export default function StackScreen({ style, edges, ...rest }: Props) {
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();

  const paddingTop = useMemo(() => {
    const flattened = StyleSheet.flatten(style) as ViewStyle | undefined;
    const userPaddingTop = typeof flattened?.paddingTop === 'number' ? flattened?.paddingTop : 4;
    const usesTopInset = edges ? edges.includes('top') : true;
    const safeTop = usesTopInset ? insets.top : 0;
    const headerOffset = Math.max(0, headerHeight - safeTop);
    return userPaddingTop + headerOffset;
  }, [edges, headerHeight, insets.top, style]);

  return (
    <Screen
      {...rest}
      edges={edges}
      style={[style, { paddingTop }]}
    />
  );
}

