const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID;

const orders = new Map();

function checkTelegramData(initData) {
    if (!initData || !BOT_TOKEN) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    params.delete("hash");

    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");

    const secretKey = crypto
        .createHmac("sha256", "WebAppData")
        .update(BOT_TOKEN)
        .digest();

    const calculatedHash = crypto
        .createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

    if (calculatedHash !== hash) return null;

    const user = JSON.parse(params.get("user") || "{}");
    return user;
}

async function telegram(method, data) {
    const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        }
    );

    return response.json();
}

app.get("/", (req, res) => {
    res.send("СК МЕТРОШОП сервер работает ✅");
});

app.post("/order", async (req, res) => {
    try {
        const { product, gameId, initData } = req.body;

        if (!product || !gameId || !initData) {
            return res.status(400).json({
                ok: false,
                error: "Не хватает данных"
            });
        }

        const user = checkTelegramData(initData);

        if (!user) {
            return res.status(403).json({
                ok: false,
                error: "Telegram авторизация не прошла"
            });
        }

        const orderId = Date.now().toString();

        orders.set(orderId, {
            product,
            gameId,
            userId: user.id,
            username: user.username || "без username",
            claimed: false
        });

        const text =
`🆕 НОВАЯ ЗАЯВКА

📦 Товар:
${product}

🎮 Игровой ID:
${gameId}

👤 Telegram:
${user.username ? "@" + user.username : "без username"}

🆔 Telegram ID:
${user.id}

🟡 Статус: ожидает сотрудника`;

        const result = await telegram("sendMessage", {
            chat_id: STAFF_CHAT_ID,
            text,
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: "✅ ВЗЯТЬ ЗАКАЗ",
                        callback_data: `claim:${orderId}`
                    }
                ]]
            }
        });

        if (!result.ok) {
            console.log(result);
            return res.status(500).json({
                ok: false,
                error: "Не удалось отправить заявку"
            });
        }

        res.json({
            ok: true
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            ok: false,
            error: "Ошибка сервера"
        });
    }
});

async function startBot() {
    await telegram("deleteWebhook", {});

    let offset = 0;

    console.log("Telegram бот запущен");

    while (true) {
        try {
            const result = await telegram("getUpdates", {
                offset,
                timeout: 30
            });

            if (!result.ok) continue;

            for (const update of result.result) {
                offset = update.update_id + 1;

                if (update.callback_query) {
                    await handleClaim(update.callback_query);
                }

                if (update.message && update.message.text === "/id") {
                    await telegram("sendMessage", {
                        chat_id: update.message.chat.id,
                        text: `🆔 ID этого чата:\n${update.message.chat
                                                   .id}`
                    });
                }
            }
        } catch (error) {
            console.error(error);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
}

async function handleClaim(callback) {
    const data = callback.data || "";

    if (!data.startsWith("claim:")) return;

    const orderId = data.substring(6);
    const order = orders.get(orderId);

    if (!order) {
        await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "Заказ не найден",
            show_alert: true
        });
        return;
    }

    if (order.claimed) {
        await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,
            text: "Этот заказ уже взял другой сотрудник!",
            show_alert: true
        });
        return;
    }

    order.claimed = true;

    const employee = callback.from;
    const employeeName = employee.username
        ? "@" + employee.username
        : employee.first_name || "Сотрудник";

    await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "Заказ закреплён за вами ✅"
    });

    await telegram("editMessageText", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text:
`🟢 ЗАКАЗ ПРИНЯТ

📦 Товар:
${order.product}

🎮 Игровой ID:
${order.gameId}

👤 Telegram:
${order.username === "без username" ? "без username" : "@" + order.username}

👨‍💼 Принял:
${employeeName}`
    });

    await telegram("sendMessage", {
        chat_id: order.userId,
        text:
`✅ Ваша заявка принята!

📦 Товар:
${order.product}

👨‍💼 Сотрудник уже взял ваш заказ.

Ожидайте дальнейшего сообщения.`
    });
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});

startBot();
