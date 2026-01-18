// app/artist/[id]/discography.tsx
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    Text,
    View,
} from "react-native";
import Screen from "../../../components/Screen";
import {
    AppleAlbum,
    AppleTrack,
    getArtistAlbums,
    getArtistTracks,
} from "../../../lib/apple";
import { formatDate } from "../../../lib/date";
import type { ThemeColors } from "../../../theme/themes";
import { useTheme } from "../../../theme/useTheme";

type Params = { id?: string; name?: string; tab?: "tracks" | "albums" | "eps" };

export default function DiscographyScreen() {
  const { id, name, tab } = useLocalSearchParams<Params>();
  const { colors } = useTheme();
    const [albums, setAlbums] = useState<AppleAlbum[]>([]);
  const [tracks, setTracks] = useState<AppleTrack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!id) return;
      try {
        const artistNum = Number(id);
        if (Number.isNaN(artistNum)) return;
        const [albumsRes, tracksRes] = await Promise.all([
          getArtistAlbums(artistNum),
          getArtistTracks(artistNum),
        ]);
        if (!mounted) return;
        setAlbums(albumsRes);
        setTracks(tracksRes);
      } catch (e) {
        console.error(e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  const albumsOnly = useMemo(
    () => albums.filter((a) => !/\bEP\b/i.test(a.collectionName)),
    [albums]
  );
  const epsOnly = useMemo(
    () => albums.filter((a) => /\bEP\b/i.test(a.collectionName)),
    [albums]
  );

  const order = tab === "tracks"
    ? ["tracks", "albums", "eps"]
    : tab === "albums"
    ? ["albums", "eps", "tracks"]
    : tab === "eps"
    ? ["eps", "albums", "tracks"]
    : ["tracks", "albums", "eps"];

  return (
    <Screen edges={["left", "right"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: colors.text.secondary }}>
          {name}'s discography
        </Text>

        {loading ? (
          <View style={{ padding: 24, alignItems: "center" }}>
            <ActivityIndicator color={colors.text.muted} />
          </View>
        ) : (
          order.map((section) => {
            if (section === "tracks")
              return (
                <Section key="tracks" title="Tracks (recent)" colors={colors}>
                  {tracks.map((t) => (
                      <Row
                        key={t.trackId}
                        image={t.artworkUrl}
                        title={t.trackName}
                        subtitle={
                          t.collectionName
                            ? `${t.collectionName}${
                                t.releaseDate ? ` • ${formatDate(t.releaseDate)}` : ""
                              }`
                            : (t.releaseDate ? formatDate(t.releaseDate) : "")
                        }
                        colors={colors}
                      />
                    ))}
                </Section>
              );
            if (section === "albums")
              return (
                <Section key="albums" title="Albums" colors={colors}>
                  {albumsOnly.map((a) => (
                    <Row
                      key={a.collectionId}
                      image={a.artworkUrl}
                      title={a.collectionName}
                      subtitle={a.releaseDate ? formatDate(a.releaseDate) : ""}
                      colors={colors}
                    />
                  ))}
                </Section>
              );
            return (
              <Section key="eps" title="EPs" colors={colors}>
                {epsOnly.map((a) => (
                  <Row
                    key={a.collectionId}
                    image={a.artworkUrl}
                    title={a.collectionName}
                    subtitle={a.releaseDate ? formatDate(a.releaseDate) : ""}
                    colors={colors}
                  />
                ))}
              </Section>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

/** UI helpers */
function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ThemeColors;
}) {
  return (
      <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text.secondary }}>{title}</Text>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => ({ marginLeft: "auto", paddingHorizontal: 10, paddingVertical: 6, opacity: pressed ? 0.85 : 1 })}
        >
          <Text style={{ color: colors.accent.primary, fontWeight: "800" }}>Back</Text>
        </Pressable>
      </View>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

function Row({
  image,
  title,
  subtitle,
  colors,
}: {
  image?: string | null;
  title: string;
  subtitle?: string;
  colors: ThemeColors;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        borderWidth: 1,
        borderColor: colors.border.subtle,
        borderRadius: 12,
        padding: 10,
        alignItems: "center",
        backgroundColor: colors.bg.secondary,
      }}
    >
      {image ? (
        <Image
          source={{ uri: image }}
          style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: colors.bg.muted }}
        />
      ) : (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 8,
            backgroundColor: colors.bg.muted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: colors.text.muted }}>🎵</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "600", color: colors.text.secondary }}>{title}</Text>
        {!!subtitle && <Text style={{ color: colors.text.muted }}>{subtitle}</Text>}
      </View>
    </View>
  );
}
