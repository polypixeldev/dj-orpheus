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
  socketMode: true,
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

app.command("/song", async ({ ack, body, client, respond }) => {
  await ack();

  const songQuery = body.text;

  const trackRes = await spotify.searchTracks(`track:${songQuery}`, {
    limit: 1,
  });
  const song = trackRes.body.tracks?.items[0];

  if (!song) {
    await respond(`No songs found for "${songQuery}"!`);
    return;
  }

  const songlinkRes = await fetch(
    `https://api.song.link/v1-alpha.1/links?songIfSingle=true&platform=spotify&type=song&id=${song.id}`
  ).then((r) => r.json());

  const artist = song.artists.map((a) => a.name).join(", ");

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
        fallback: `${song.name} by ${artist}`,
        title: `<@${body.user_id}> shared ${song.name} by ${artist}!`,
        text: linkText,
        mrkdwn_in: ["text"],
      },
    ],
  });
});

(async () => {
  await app.start();

  console.log("⚡️ Bolt app is running!");
})();
