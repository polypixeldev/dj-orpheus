import Slack from "@slack/bolt";
import Spotify from "spotify-web-api-node";
import "dotenv/config";

const PLATFORM_MAPPINGS = {
  spotify: "Spotify",
  appleMusic: "Apple Music",
  youtubeMusic: "YouTube Music",
  tidal: "Tidal",
} as { [key: string]: string };

const app = new Slack.App({
  appToken: process.env.SLACK_APP_TOKEN,
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

const spotify = new Spotify({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

function getAccessToken() {
  return spotify.clientCredentialsGrant().then(
    (data) => {
      console.log(
        `Acquired Spotify access token, expiring in ${data.body.expires_in} seconds.`
      );

      spotify.setAccessToken(data.body.access_token);

      setTimeout(getAccessToken, data.body.expires_in * 1000);
    },
    (err) => {
      console.log("Something went wrong when retrieving an access token", err);
    }
  );
}

getAccessToken();

async function processAttachment(type: "track" | "album", user: string, spotifyId?: string, query?: string) {
  let item;
  if (spotifyId) {
    if (type === "track") {
      item = (await spotify.getTrack(spotifyId)).body;
    } else {
      item = (await spotify.getAlbum(spotifyId)).body;
    }
  } else if (query) {
    let itemRes;
    try {
      itemRes = await (type === "track"
        ? spotify.searchTracks
        : spotify.searchAlbums
      ).bind(spotify)(query, {
        limit: 1,
      });
    } catch (e) {
      if ((e as any).statusCode == 401) {
        await getAccessToken()
  
        itemRes = await (type === "track"
          ? spotify.searchTracks
          : spotify.searchAlbums
        ).bind(spotify)(query, {
          limit: 1,
        });
      } else {
        throw e
      }
    }
  
    item =
      type === "track"
        ? itemRes.body.tracks?.items[0]
        : itemRes.body.albums?.items[0];
  }

  if (!item) {
    throw Error(`No ${type}s found for "${query}"!`);
  }

  const songlinkRes = await fetch(
    `https://api.song.link/v1-alpha.1/links?songIfSingle=true&platform=spotify&type=${
      type === "track" ? "song" : "album"
    }&id=${item.id}`
  ).then((r) => r.json());

  const artist = item.artists.map((a) => a.name).join(", ");

  let linkText = "";

  for (const platform in songlinkRes.linksByPlatform) {
    if (!(platform in PLATFORM_MAPPINGS)) continue;

    const platformLink = songlinkRes.linksByPlatform[platform];
    linkText += `<${platformLink.url}|${PLATFORM_MAPPINGS[platform]}>\t`;
  }

  return [
    {
      color: "#007A5A",
      fallback: `${item.name} by ${artist}`,
      title: `<@${user}> shared the ${
        type === "track" ? "song" : "album"
      } "${item.name}" by ${artist}!`,
      text: linkText,
      mrkdwn_in: ["text" as const],
    },
  ]
}

async function processRequest(
  type: "track" | "album",
  ctx: (Slack.SlackCommandMiddlewareArgs | Slack.SlackEventMiddlewareArgs) & Slack.AllMiddlewareArgs,
  spotifyId?: string
) {
  const { body } = ctx;

  const itemQuery = body.text;

  let attachments;
  try {
    attachments = await processAttachment(type, body.user_id, spotifyId, itemQuery);
  } catch (e) {
    if ("respond" in ctx) {
      await ctx.respond(e as any as string);
    }
  }

  await app.client.chat.postMessage({
    channel: body.channel_id,
    text: "",
    attachments,
  });
}

app.command("/song", async (ctx) => {
  console.log("acking /song")
  await ctx.ack();

  await processRequest("track", ctx);
});

app.command("/album", async (ctx) => {
  console.log("acking /album")
  await ctx.ack();

  await processRequest("album", ctx);
});

app.command("/artist", async (ctx) => {
  console.log("acking /artist")
  await ctx.ack();

  const { body, respond } = ctx;

  const artistQuery = body.text;

  let artistRes;
  try {
    artistRes = await spotify.searchArtists(artistQuery, {
      limit: 1,
    });
  } catch (e) {
    if ((e as any).statusCode == 401) {
      await getAccessToken()

      artistRes = await spotify.searchArtists(artistQuery, {
        limit: 1,
      });
    } else {
      throw e
    }
  }

  const artist = artistRes.body.artists?.items[0];

  if (!artist) {
    await respond(`No artists found for "${artistQuery}"!`);
    return;
  }

  const linkText = `<${artist.external_urls.spotify}|Spotify>`;

  await app.client.chat.postMessage({
    channel: body.channel_id,
    text: "",
    attachments: [
      {
        color: "#007A5A",
        fallback: `Artist ${artist.name}`,
        title: `<@${body.user_id}> shared the artist "${artist.name}"!`,
        text: linkText,
        mrkdwn_in: ["text"],
      },
    ],
  });
});

app.event("link_shared", async (ctx) => {
  console.log("link found :0")
  for (const link of ctx.event.links) {
    const typeMatch = link.url.match(/open\.spotify\.com\/(track|album)/);
    const type = typeMatch?.[1];
    if (type) {
      const songIdRes = link.url.match(/(?<=open\.spotify.com\/(track|album)\/)((\w|\d)+)/) ?? [];
      const songId = songIdRes[0];

      if (songId) {
        const attachments = await processAttachment(type as "track" | "album", ctx.event.user, songId);

        ctx.client.chat.unfurl({
          channel: ctx.event.channel,
          unfurl_id: ctx.event.unfurl_id!,
          source: ctx.event.source as "composer" | "conversations_history",
          unfurls: {
            [link.url]: attachments[0]
          }
        })
      }
    }
  }
});

(async () => {
  await app.start(process.env.PORT ?? 3000);

  console.log(`⚡️ Bolt app is running on port ${process.env.PORT}!`);
})();
