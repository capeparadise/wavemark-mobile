// app/artist/[id]/discography.tsx
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Image,
    SafeAreaView,
    ScrollView,
    Text,
    View,
} from "react-native";
import {
    AppleAlbum,
    AppleTrack,
    getArtistAlbums,
    getArtistTracks,
} from "../../../lib/apple";
import { formatDate } from "../../../lib/date";

type Params = { id?: string; name?: string; tab?: "tracks" | "albums" | "eps" };

export default function DiscographyScreen() {
  const { id, name, tab } = useLocalSearchParams<Params>();
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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 18 }}>
        <Text style={{ fontSize: 24, fontWeight: "700" }}>
          {name}'s discography
        </Text>

        {loading ? (
          <View style={{ padding: 24, alignItems: "center" }}>
            <ActivityIndicator />
          </View>
        ) : (
          order.map((section) => {
            if (section === "tracks")
              return (
                <Section key="tracks" title="Tracks (recent)">
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
                      />
                    ))}
                </Section>
              );
            if (section === "albums")
              return (
                <Section key="albums" title="Albums">
                  {albumsOnly.map((a) => (
                    <Row
                      key={a.collectionId}
                      image={a.artworkUrl}
                      title={a.collectionName}
                      subtitle={a.releaseDate ? formatDate(a.releaseDate) : ""}
                    />
                  ))}
                </Section>
              );
            return (
              <Section key="eps" title="EPs">
                {epsOnly.map((a) => (
                  <Row
                    key={a.collectionId}
                    image={a.artworkUrl}
                    title={a.collectionName}
                    subtitle={a.releaseDate ? formatDate(a.releaseDate) : ""}
                  />
                ))}
              </Section>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** UI helpers */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "700" }}>{title}</Text>
        <Text
          onPress={() => router.back()}
          style={{ marginLeft: "auto", color: "#2f6" }}
        >
          Back
        </Text>
      </View>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

function Row({
  image,
  title,
  subtitle,
}: {
  image?: string | null;
  title: string;
  subtitle?: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 12,
        borderWidth: 1,
        borderColor: "#eee",
        borderRadius: 12,
        padding: 10,
        alignItems: "center",
      }}
    >
      {image ? (
        <Image
          source={{ uri: image }}
          style={{ width: 56, height: 56, borderRadius: 8 }}
        />
      ) : (
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 8,
            backgroundColor: "#f2f2f2",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text>🎵</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "600" }}>{title}</Text>
        {!!subtitle && <Text style={{ opacity: 0.7 }}>{subtitle}</Text>}
      </View>
    </View>
  );
}
