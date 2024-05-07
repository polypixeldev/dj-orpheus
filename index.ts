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
  spotify.clientCredentialsGrant().then(
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

async function processRequest(
  type: "track" | "album",
  ctx: Slack.SlackCommandMiddlewareArgs & Slack.AllMiddlewareArgs
) {
  const { body, respond } = ctx;

  const itemQuery = body.text;

  const itemRes = await (type === "track"
    ? spotify.searchTracks
    : spotify.searchAlbums
  ).bind(spotify)(itemQuery, {
    limit: 1,
  });
  const item =
    type === "track"
      ? itemRes.body.tracks?.items[0]
      : itemRes.body.albums?.items[0];

  if (!item) {
    await respond(`No ${type}s found for "${itemQuery}"!`);
    return;
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

  await app.client.chat.postMessage({
    channel: body.channel_id,
    text: "",
    attachments: [
      {
        color: "#007A5A",
        fallback: `${item.name} by ${artist}`,
        title: `<@${body.user_id}> shared the ${
          type === "track" ? "song" : "album"
        } "${item.name}" by ${artist}!`,
        text: linkText,
        mrkdwn_in: ["text"],
      },
    ],
  });
}

app.command("/song", async (ctx) => {
  await ctx.ack();

  await processRequest("track", ctx);
});

app.command("/album", async (ctx) => {
  await ctx.ack();

  await processRequest("album", ctx);
});

app.command("/artist", async (ctx) => {
  await ctx.ack();

  const { body, respond } = ctx;

  const artistQuery = body.text;

  const artistRes = await spotify.searchArtists(artistQuery, {
    limit: 1,
  });
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

(async () => {
  await app.start(process.env.PORT ?? 3000);

  console.log("⚡️ Bolt app is running!");
})();
