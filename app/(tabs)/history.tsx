/* ========================================================================
   File: app/(tabs)/history.tsx
   PURPOSE: Show all listened items (done_at != null), newest first.
   ======================================================================== */
import React from 'react';
import { Text, View } from 'react-native';

// Archived: original history screen moved to app/_archive/history.tsx
export default function ArchivedHistory() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#666' }}>This history screen is archived; see /app/_archive/history.tsx</Text>
    </View>
  );
}
