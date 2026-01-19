// ==========================================
// server.js - 投函センサーサーバー (完成版)
// ==========================================
require("dotenv").config();

// 環境変数チェック
const LINE_TOKEN = process.env.LINE_TOKEN;
const USER_ID = process.env.LINE_USER_ID; // ※今回はBroadcastを使うため、テスト送信以外では未使用
if (!LINE_TOKEN) console.error("Error: LINE_TOKEN is missing in .env");

const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

// ------------------------------------------------------
// 状態変数 (メモリ保存)
// ------------------------------------------------------
let currentCount = 0;       // 投函数
let lastReceivedTime = "-"; // 最終更新時刻
let currentBattery = 100;   // バッテリー残量
let resetCommand = false;   // M5へのリセット命令フラグ
let history = [];           // 履歴ログ配列

// ------------------------------------------------------
// 1. Webブラウザ用: 履歴ログ表示ページ (GET /)
// ------------------------------------------------------
app.get("/", (req, res) => {
  const tableRows = history.map(item => `
    <tr>
      <td>${item.time}</td>
      <td>
        <span class="badge ${item.type === 'リセット' ? 'reset' : 'post'}">${item.type}</span>
      </td>
      <td>${item.count}回</td>
      <td>${item.bat}%</td>
    </tr>
  `).join("");

  const html = `
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>投函センサーログ</title>
      <style>
        body { font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f4f4f4; }
        .card { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .count-display { font-size: 3em; font-weight: bold; color: #007bff; text-align: center; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.9em; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #eee; }
        .badge { padding: 4px 8px; border-radius: 4px; color: white; font-size: 0.8em; }
        .post { background-color: #28a745; } .reset { background-color: #dc3545; }
      </style>
      <meta http-equiv="refresh" content="5"> 
    </head>
    <body>
      <h1>📮 投函モニター</h1>
      <div class="card">
        <div style="text-align:center;">現在の投函数</div>
        <div class="count-display">${currentCount}</div>
        <div style="text-align:center; color:#666;">最終: ${lastReceivedTime} | 電池: ${currentBattery}%</div>
      </div>
      <div class="card">
        <h3>📜 履歴ログ (最新50件)</h3>
        <table>
          <thead><tr><th>時刻</th><th>イベント</th><th>回数</th><th>電池</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

// ------------------------------------------------------
// 2. M5Stick用: リセット確認 (GET /check-reset)
// ------------------------------------------------------
app.get("/check-reset", (req, res) => {
  res.json({ reset: resetCommand });
  if (resetCommand) resetCommand = false; // 一度伝えたらフラグを下ろす
});

// ------------------------------------------------------
// 3. M5Stick用: 投函・データ報告 (POST /report-post)
// ------------------------------------------------------
app.post("/report-post", async (req, res) => {
  try {
    const newCount = req.body.count;
    const newBattery = req.body.battery;

    if (newCount !== undefined) currentCount = newCount;
    if (newBattery !== undefined) currentBattery = newBattery;
    
    // 時刻取得
    const now = new Date();
    lastReceivedTime = now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
    console.log(`Report: Count=${currentCount}, Bat=${currentBattery}%`);

    // 履歴に追加
    const logType = (currentCount === 0) ? "リセット" : "投函";
    history.unshift({ time: lastReceivedTime, type: logType, count: currentCount, bat: currentBattery });
    if (history.length > 50) history.pop();

    // LINE送信準備
    let msgObject;

    if (currentCount === 0) {
      // リセット時はシンプルにテキストで
      msgObject = { type: "text", text: `🔄 カウントをリセットしました (現在0回)` };
    } else {
      // 投函時は「Flex Message」でリッチに送信
      
      // バッテリーアイコン判定
      let batColor = "#999999";
      let batText = "正常";
      if (currentBattery < 20) { batColor = "#FF0000"; batText = "要充電 💀"; }
      else if (currentBattery < 50) { batColor = "#FFA500"; batText = "低下"; }

      msgObject = {
        type: "flex",
        altText: "📮 投函がありました！",
        contents: {
          type: "bubble",
          header: {
            type: "box",
            layout: "vertical",
            contents: [{ type: "text", text: "📮 POST SENSOR", weight: "bold", color: "#FFFFFF" }],
            backgroundColor: "#00B900"
          },
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: "投函を検知しました", weight: "bold", size: "lg", margin: "md" },
              { type: "separator", margin: "lg" },
              {
                type: "box", layout: "baseline", margin: "md",
                contents: [
                  { type: "text", text: "回数", color: "#aaaaaa", size: "sm", flex: 2 },
                  { type: "text", text: `${currentCount} 回`, weight: "bold", color: "#333333", size: "xl", flex: 4 }
                ]
              },
              {
                type: "box", layout: "baseline", margin: "sm",
                contents: [
                  { type: "text", text: "時刻", color: "#aaaaaa", size: "sm", flex: 2 },
                  { type: "text", text: lastReceivedTime, color: "#666666", size: "sm", flex: 4 }
                ]
              },
              {
                type: "box", layout: "baseline", margin: "sm",
                contents: [
                  { type: "text", text: "電池", color: "#aaaaaa", size: "sm", flex: 2 },
                  { type: "text", text: `${currentBattery}% (${batText})`, color: batColor, size: "sm", weight: "bold", flex: 4 }
                ]
              }
            ]
          }
        }
      };
    }

    // 全員に送信 (Broadcast)
    await broadcastMessage(msgObject);
    res.json({ status: "success" });

  } catch (error) {
    console.error("Error in /report-post:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------------------------------------------
// 4. LINE Webhook: ユーザーからのメッセージ受信
// ------------------------------------------------------
app.post("/webhook", async (req, res) => {
  try {
    const events = req.body.events;
    if (!events || !Array.isArray(events)) return res.sendStatus(200);

    for (const event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text.trim();

        if (text === "状況" || text === "確認") {
          // シンプルな状況返信
          await replyMessage(event.replyToken, {
            type: "text",
            text: `現在の投函数: ${currentCount}回\n電池残量: ${currentBattery}%\n最終検知: ${lastReceivedTime}\n\n詳細ログ: https://${req.get('host')}`
          });

        } else if (text === "履歴" || text === "グラフ") {
          // テキストグラフ生成
          const logs = history.slice(0, 8); // 最新8件
          let graph = "📊 直近のログ\n\n";
          logs.forEach(log => {
             const bar = "■".repeat(Math.min(log.count, 10)); // 最大10個まで
             const t = log.time.split(" ")[1] || log.time;
             graph += `${t} ${log.type === 'リセット'?'🔄':'📮'}\n${bar} (${log.count})\n`;
          });
          if(logs.length===0) graph += "データなし";
          
          await replyMessage(event.replyToken, { type: "text", text: graph });

        } else if (text === "リセット") {
          resetCommand = true;
          currentCount = 0;
          
          // ログ記録
          const now = new Date();
          const t = now.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
          history.unshift({ time: t, type: "リセット", count: 0, bat: currentBattery });

          await replyMessage(event.replyToken, { 
            type: "text", 
            text: "リセット命令を出しました。\nM5Stickがスリープから目覚めた時に反映されます。" 
          });
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
// 共通関数: LINE API
// ------------------------------------------------------
// 友達全員に送信 (Broadcast)
async function broadcastMessage(messageObject) {
  try {
    await axios.post("https://api.line.me/v2/bot/message/broadcast",
      { messages: [messageObject] },
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` } }
    );
    console.log("Broadcast Sent");
  } catch (error) { console.log("Broadcast Error:", error.response?.data || error.message); }
}

// 返信 (Reply)
async function replyMessage(replyToken, messageObject) {
  try {
    await axios.post("https://api.line.me/v2/bot/message/reply",
      { replyToken: replyToken, messages: [messageObject] },
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` } }
    );
  } catch (error) { console.log("Reply Error:", error.response?.data || error.message); }
}

const port = process.env.PORT || 3000;
app.listen(port, () => { console.log("Server running on " + port); });
