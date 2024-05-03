import Slack from "@slack/bolt";
import "dotenv/config";

const app = new Slack.App({
  appToken: process.env.SLACK_APP_TOKEN,
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
});

(async () => {
  await app.start();

  console.log("⚡️ Bolt app is running!");
})();
