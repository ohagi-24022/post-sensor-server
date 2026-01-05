// ====== 最重要：必ず一番上に置く ======
require("dotenv").config();

// ====== 環境変数を読み込む ======
const LINE_TOKEN = process.env.LINE_TOKEN;
const USER_ID = process.env.LINE_USER_ID;

// ====== 読み込めたか確認 ======
console.log("USER_ID =", USER_ID);
console.log("LINE_TOKEN =", LINE_TOKEN ? "OK" : "EMPTY");

const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

// ------------------------------------------------------
// サーバー側で保持するデータ（メモリ上）
// ------------------------------------------------------
let currentCount = 0;           // 現在の投函カウント
let lastReceivedTime = "なし";   // 最後に投函があった時間

// ------------------------------------------------------
// M5Stick → Server: 投函検知＆通知リクエスト
// M5側からは { "count": 5 } のようなJSONを送る想定
// ------------------------------------------------------
app.post("/report-post", async (req, res) => {
  try {
    // M5Stickから送られてきたカウント数を取得
    const newCount = req.body.count;

    // カウントが送られてきているか確認
    if (newCount !== undefined) {
      currentCount = newCount;
    }
    
    // 現在時刻を記録 (日本時間っぽく整形)
    const now = new Date();
    lastReceivedTime = now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    console.log(`Post received! Count: ${currentCount}, Time: ${lastReceivedTime}`);

    // LINEに通知を送る
    const messageText = `📮 投函がありました！\n現在のカウント: ${currentCount}回\n時刻: ${lastReceivedTime}`;
    await pushMessageToUser(messageText);

    res.json({ status: "success", message: "Notification sent to LINE" });

  } catch (error) {
    console.error("Error in /report-post:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------
// LINE Webhook 受信 (LINEアプリからメッセージが来た時)
// ------------------------------------------------------
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;

    // events が無い場合でも 200 を返して LINE から切断されないようにする
    if (!events || !Array.isArray(events)) {
      return res.sendStatus(200);
    }

    for (const event of events) {
      // テキストメッセージの場合のみ反応
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.trim();

        // 「状況」や「確認」と送ると、現在のカウントを教えてくれる
        if (text === "状況" || text === "確認" || text === "status") {
            const replyText = `現在の投函数: ${currentCount}回\n最終検知: ${lastReceivedTime}`;
            await replyMessage(event.replyToken, replyText);
        } else {
            // それ以外の場合は使い方を返信
            await replyMessage(event.replyToken, "「状況」と送ると、現在の投函数を確認できます。");
        }
      }
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    res.sendStatus(500);
  }
});

// ------------------------------------------------------
// 共通関数: LINE Push メッセージ (こちらから送る)
// ------------------------------------------------------
async function pushMessageToUser(text) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/push",
      {
        to: USER_ID,
        messages: [{ type: "text", text: text }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_TOKEN}`,
        },
      }
    );
    console.log("LINE Push Sent:", text);
  } catch (error) {
    console.log("LINE Push Error:", error.response?.data || error.message);
  }
}

// ------------------------------------------------------
// 共通関数: LINE Reply メッセージ (返信する)
// ------------------------------------------------------
async function replyMessage(replyToken, text) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken: replyToken,
        messages: [{ type: "text", text: text }],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_TOKEN}`,
        },
      }
    );
  } catch (error) {
    console.log("LINE Reply Error:", error.response?.data || error.message);
  }
}

// ------------------------------------------------------
// サーバー起動
// ------------------------------------------------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server running on port " + port);
});