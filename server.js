// server.js
require("dotenv").config();

const LINE_TOKEN = process.env.LINE_TOKEN;
const USER_ID = process.env.LINE_USER_ID;
const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

// ------------------------------------------------------
// サーバー側で保持するデータ
// ------------------------------------------------------
let currentCount = 0;
let lastReceivedTime = "なし";
let resetCommand = false; // ★追加：M5Stickへのリセット命令フラグ

// ------------------------------------------------------
// M5Stick → Server: 「リセット命令出てますか？」と聞きに来る場所 (★新規追加)
// ------------------------------------------------------
app.get("/check-reset", (req, res) => {
  // 現在のフラグの状態を返す
  res.json({ reset: resetCommand });

  // 一度伝えたらフラグを下ろす（falseに戻す）
  if (resetCommand) {
    console.log("Reset command picked up by device");
    resetCommand = false;
  }
});

// ------------------------------------------------------
// M5Stick → Server: 投函検知＆通知リクエスト
// ------------------------------------------------------
app.post("/report-post", async (req, res) => {
  try {
    const newCount = req.body.count;

    if (newCount !== undefined) {
      currentCount = newCount;
    }
    
    const now = new Date();
    lastReceivedTime = now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    console.log(`Post received! Count: ${currentCount}`);

    // ★変更：カウントが0かどうかでメッセージを変える
    let messageText = "";
    if (currentCount === 0) {
        messageText = `🔄 カウントをリセットしました。\n現在のカウント: 0回`;
    } else {
        messageText = `📮 投函がありました！\n現在のカウント: ${currentCount}回\n時刻: ${lastReceivedTime}`;
    }

    await pushMessageToUser(messageText);
    res.json({ status: "success" });

  } catch (error) {
    console.error("Error in /report-post:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------
// LINE Webhook 受信
// ------------------------------------------------------
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;
    if (!events || !Array.isArray(events)) return res.sendStatus(200);

    for (const event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.trim();

        if (text === "状況" || text === "確認" || text === "status") {
            const replyText = `現在の投函数: ${currentCount}回\n最終検知: ${lastReceivedTime}`;
            await replyMessage(event.replyToken, replyText);

        } else if (text === "リセット") {
             // ★変更：M5Stickへ命令を出すためにフラグをONにする
             resetCommand = true; 
             currentCount = 0;
             lastReceivedTime = "リセット済み";
             
             // LINEには「命令を受け付けました」と返す
             await replyMessage(event.replyToken, "リセット命令を出しました。\n数秒以内にM5Stickの画面も0になります。");
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    res.sendStatus(500);
  }
});

// （以下の共通関数などは変更なし）
async function pushMessageToUser(text) {
  try {
    await axios.post("https://api.line.me/v2/bot/message/push", 
      { to: USER_ID, messages: [{ type: "text", text: text }] },
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` } }
    );
  } catch (error) { console.log("Push Error:", error.message); }
}

async function replyMessage(replyToken, text) {
  try {
    await axios.post("https://api.line.me/v2/bot/message/reply",
      { replyToken, messages: [{ type: "text", text }] },
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` } }
    );
  } catch (error) { console.log("Reply Error:", error.message); }
}

const port = process.env.PORT || 3000;
app.listen(port, () => { console.log("Server running on " + port); });
