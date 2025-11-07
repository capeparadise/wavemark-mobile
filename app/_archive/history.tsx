// archived: original history tab moved to top-level /history
import React from 'react';
import { Text, View } from 'react-native';

export default function ArchivedHistory() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>This file is archived and the History screen now lives at /history</Text>
    </View>
  );
}
