// ====== 最重要：必ず一番上に置く ======
require("dotenv").config();

// ====== 環境変数 ======
const LINE_TOKEN = process.env.LINE_TOKEN;
const USER_ID = process.env.LINE_USER_ID;

const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

// ------------------------------------------------------
// サーバー側で保持するデータ
// ------------------------------------------------------
let currentCount = 0;       // 現在の投函カウント
let lastReceivedTime = "-"; // 最終更新時刻
let resetCommand = false;   // M5へのリセット命令フラグ

// ★追加：履歴を保存する配列
// 中身のイメージ: [{ time: "1/6 14:00", type: "投函", count: 1 }, ...]
let history = []; 

// ------------------------------------------------------
// ★追加：Webブラウザで履歴を見るためのページ (GET /)
// ------------------------------------------------------
app.get("/", (req, res) => {
  // 履歴配列からHTMLのテーブル行（<tr>）を作る
  const tableRows = history.map(item => `
    <tr>
      <td>${item.time}</td>
      <td>
        <span class="badge ${item.type === 'リセット' ? 'reset' : 'post'}">
          ${item.type}
        </span>
      </td>
      <td>${item.count}回</td>
    </tr>
  `).join("");

  // HTML全体を組み立てる
  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>投函センサーログ</title>
      <style>
        body { font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f4f4f4; }
        h1 { text-align: center; color: #333; }
        .card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .status-box { text-align: center; }
        .count-display { font-size: 3em; font-weight: bold; color: #007bff; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #eee; }
        .badge { padding: 5px 10px; border-radius: 5px; color: white; font-size: 0.8em; }
        .post { background-color: #28a745; }   /* 緑 */
        .reset { background-color: #dc3545; }  /* 赤 */
      </style>
      <meta http-equiv="refresh" content="5"> 
    </head>
    <body>
      <h1>📮 投函モニター</h1>
      
      <div class="card status-box">
        <div>現在の投函数</div>
        <div class="count-display">${currentCount}</div>
        <div>最終更新: ${lastReceivedTime}</div>
      </div>

      <div class="card">
        <h2>📜 履歴ログ</h2>
        <table>
          <thead>
            <tr>
              <th>時刻</th>
              <th>イベント</th>
              <th>カウント</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;

  res.send(html);
});

// ------------------------------------------------------
// M5Stick → Server: リセット確認 (GET /check-reset)
// ------------------------------------------------------
app.get("/check-reset", (req, res) => {
  res.json({ reset: resetCommand });
  if (resetCommand) {
    resetCommand = false;
  }
});

// ------------------------------------------------------
// M5Stick → Server: 投函報告 (POST /report-post)
// ------------------------------------------------------
app.post("/report-post", async (req, res) => {
  try {
    const newCount = req.body.count;
    if (newCount !== undefined) {
      currentCount = newCount;
    }
    
    // 時刻取得
    const now = new Date();
    lastReceivedTime = now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

    // ★追加：履歴に追加 (先頭に追加)
    let logType = (currentCount === 0) ? "リセット" : "投函";
    history.unshift({
      time: lastReceivedTime,
      type: logType,
      count: currentCount
    });

    // 履歴が増えすぎないように最新50件だけ残す
    if (history.length > 50) history.pop();

    console.log(`Post received! Count: ${currentCount}`);

    // LINE通知作成
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
            const replyText = `現在の投函数: ${currentCount}回\n最終検知: ${lastReceivedTime}\n\n詳細ログはこちら:\nhttps://${req.get('host')}`;
            await replyMessage(event.replyToken, replyText);

        } else if (text === "リセット") {
             resetCommand = true; 
             currentCount = 0;
             
             const now = new Date();
             const timeStr = now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
             lastReceivedTime = timeStr;

             // ★追加：履歴に追加（LINEからのリセットも記録）
             history.unshift({
                time: timeStr,
                type: "リセット",
                count: 0
             });

             await replyMessage(event.replyToken, "リセット命令を出しました。");
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
// 共通関数
// ------------------------------------------------------
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
