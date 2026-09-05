const express = require("express");
const crypto = require("crypto");

const app = express();

// CORS
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID;

// Хранилище заказов
const orders = new Map();

// Проверка данных Telegram Mini App
function checkTelegramData(initData) {
    if (!initData || !BOT_TOKEN) return null;

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");

    if (!hash) return null;

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

    try {
        const user = JSON.parse(params.get("user") || "{}");
        return user;
    } catch {
        return null;
    }
}

// Запрос к Telegram API
async function telegram(method, data) {
    try {
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

        const text = await response.text();

        console.log(
            "Telegram API:",
            method,
            response.status,
            text
        );

        return JSON.parse(text);

    } catch (error) {
        console.error("ОШИБКА TELEGRAM API:", error);

        return {
            ok: false,
            error: error.message
        };
    }
}

// Проверка сервера
app.get("/", (req, res) => {
    res.send("СК МЕТРОШОП сервер работает ✅");
});

// Создание заказа
app.post("/order", async (req, res) => {
    try {
        const {
            product,
            gameId,
            initData
        } = req.body;

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

        // Сопровождение могут взять 3 сотрудника.
        // Остальные товары — только 1 сотрудник.
        const isEscort = product
            .toLowerCase()
            .includes("сопровождение");

        orders.set(orderId, {
            product,
            gameId,
            userId: user.id,
            username: user.username || "без username",

            isEscort,

            // Список сотрудников, которые приняли заказ
            employees: []
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

🟡 Статус:
ожидает сотрудника

${isEscort ? "👥 Для сопровождения доступно мест: 3" : "👤 Доступно мест: 1"}`;

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

// Запуск Telegram-бота
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

            if (!result.ok) {
                await new Promise(resolve =>
                    setTimeout(resolve, 3000)
                );

                continue;
            }

            for (const update of result.result) {
                offset = update.update_id + 1;

                // Нажатие кнопки
                if (update.callback_query) {
                    await handleClaim(
                        update.callback_query
                    );
                }

                // Команда /id
                if (
                    update.message &&
                    update.message.text === "/id"
                ) {
                    await telegram("sendMessage", {
                        chat_id: update.message.chat.id,

                        text:
`🆔 ID этого чата:

${update.message.chat.id}`
                    });
                }
            }

        } catch (error) {
            console.error(error);

            await new Promise(resolve =>
                setTimeout(resolve, 3000)
            );
        }
    }
}

// Принятие заказа сотрудником
async function handleClaim(callback) {
    const data = callback.data || "";

    if (!data.startsWith("claim:")) {
        return;
    }

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

    const employee = callback.from;

    const employeeName = employee.username
        ? "@" + employee.username
        : employee.first_name || "Сотрудник";

    // Максимальное количество сотрудников
    const maxEmployees = order.isEscort ? 3 : 1;

    // Проверяем, не занят ли уже заказ
    if (order.employees.length >= maxEmployees) {
        await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,

            text: order.isEscort
                ? "Все 3 места уже заняты!"
                : "Этот заказ уже взял другой сотрудник!",

            show_alert: true
        });

        return;
    }

    // Один сотрудник не может занять заказ дважды
    const alreadyClaimed = order.employees.some(
        e => e.id === employee.id
    );

    if (alreadyClaimed) {
        await telegram("answerCallbackQuery", {
            callback_query_id: callback.id,

            text: "Вы уже приняли этот заказ!",

            show_alert: true
        });

        return;
    }

    // Добавляем сотрудника
    order.employees.push({
        id: employee.id,
        name: employeeName
    });

    const count = order.employees.length;

    // Ответ на нажатие
    await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,

        text: "Заказ закреплён за вами ✅"
    });

    // Список сотрудников
    const employeesText = order.employees
        .map(
            (employee, index) =>
                `${index + 1}. ${employee.name}`
        )
        .join("\n");

    // Статус
    const statusText = order.isEscort
        ? `👥 Места: ${count}/3`
        :"🟢 Заказ принят";

    // Если места ещё есть — оставляем кнопку.
    // Если мест больше нет — убираем кнопку.
    let replyMarkup;

    if (count < maxEmployees) {
        replyMarkup = {
            inline_keyboard: [[
                {
                    text: "✅ ВЗЯТЬ ЗАКАЗ",
                    callback_data: `claim:${orderId}`
                }
            ]]
        };
    }

    // Обновляем сообщение в чате сотрудников
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
${
    order.username === "без username"
        ? "без username"
        : "@" + order.username
}

👨‍💼 Сотрудники:
${employeesText}

${statusText}`,

        ...(replyMarkup
            ? {
                reply_markup: replyMarkup
            }
            : {})
    });

    // Сообщаем клиенту
    await telegram("sendMessage", {
        chat_id: order.userId,

        text:
`✅ Ваша заявка принята!

📦 Товар:
${order.product}

👨‍💼 Сотрудник:
${employeeName}

${
    order.isEscort
        ? `👥 Принято сотрудников: ${count}/3`
        : "🟢 Заказ закреплён за сотрудником."
}

Ожидайте дальнейшего сообщения.`
    });
}

// Запуск сервера
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(
        `Server started on port ${PORT}`
    );
});

// Запуск бота
startBot();
