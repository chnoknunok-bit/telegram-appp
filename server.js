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
        return JSON.parse(params.get("user") || "{}");
    } catch {
        return null;
    }
}

// Telegram API
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

        // Сопровождение — до 3 сотрудников.
        // Остальные товары — 1 сотрудник.
        const isEscort = product
            .toLowerCase()
            .includes("сопровождение");

        orders.set(orderId, {
            product,
            gameId,

            userId: user.id,

            username:
                user.username || "без username",

            isEscort,

            status: "waiting",

            employees: []
        });

        const text =
`🟡 ЗАКАЗ В ОЖИДАНИИ

📦 Товар:
${product}

🎮 Игровой ID:
${gameId}

👤 Telegram:
${user.username
    ? "@" + user.username
    : "без username"}

🆔 Telegram ID:
${user.id}

${isEscort
    ? "👥 Места сотрудников: 0/3"
    : "👤 Сотрудник: 0/1"}`;

        const result = await telegram("sendMessage", {
            chat_id: STAFF_CHAT_ID,

            text,

            reply_markup: {
                inline_keyboard: [[
                    {
                        text: "✅ ВЗЯТЬ ЗАКАЗ",
                        callback_data:
                            `claim:${orderId}`
                    }]]
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

// Telegram бот
async function startBot() {
    await telegram("deleteWebhook", {});

    let offset = 0;

    console.log("Telegram бот запущен");

    while (true) {
        try {
            const result = await telegram(
                "getUpdates",
                {
                    offset,
                    timeout: 30
                }
            );

            if (!result.ok) {
                await new Promise(resolve =>
                    setTimeout(resolve, 3000)
                );

                continue;
            }

            for (const update of result.result) {
                offset = update.update_id + 1;

                // Нажатие inline-кнопки
                if (update.callback_query) {
                    await handleCallback(
                        update.callback_query
                    );
                }

                // Команда /id
                if (
                    update.message &&
                    update.message.text === "/id"
                ) {
                    await telegram(
                        "sendMessage",
                        {
                            chat_id:
                                update.message.chat.id,

                            text:
`🆔 ID этого чата:

${update.message.chat.id}`
                        }
                    );
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

// Обработка кнопок
async function handleCallback(callback) {
    const data = callback.data || "";

    // Взять заказ
    if (data.startsWith("claim:")) {
        await handleClaim(callback);
        return;
    }

    // Выполнить заказ
    if (data.startsWith("complete:")) {
        await handleComplete(callback);
        return;
    }
}

// Принятие заказа
async function handleClaim(callback) {
    const orderId = callback.data.substring(6);

    const order = orders.get(orderId);

    if (!order) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id: callback.id,

                text: "Заказ не найден",

                show_alert: true
            }
        );

        return;
    }

    // Заказ уже выполнен
    if (order.status === "completed") {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id: callback.id,

                text: "Этот заказ уже выполнен!",

                show_alert: true
            }
        );

        return;
    }

    const employee = callback.from;

    const employeeName =
        employee.username
            ? "@" + employee.username
            : employee.first_name ||
              "Сотрудник";

    // Максимум сотрудников
    const maxEmployees =
        order.isEscort ? 3 : 1;

    // Все места уже заняты
    if (
        order.employees.length >=
        maxEmployees
    ) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id: callback.id,

                text: order.isEscort
                    ? "Все 3 места уже заняты!"
                    : "Этот заказ уже взял другой сотрудник!",

                show_alert: true
            }
        );

        return;
    }

    // Проверяем, не взял ли этот сотрудник заказ
    const alreadyClaimed =
        order.employees.some(
            e => e.id === employee.id
        );if (alreadyClaimed) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id: callback.id,

                text:
                    "Вы уже приняли этот заказ!",

                show_alert: true
            }
        );

        return;
    }

    // Добавляем сотрудника
    order.employees.push({
        id: employee.id,
        name: employeeName
    });

    order.status = "accepted";

    const count =
        order.employees.length;

    // Уведомление нажатия
    await telegram(
        "answerCallbackQuery",
        {
            callback_query_id: callback.id,

            text:
                "Заказ закреплён за вами ✅"
        }
    );

    // Список сотрудников
    const employeesText =
        order.employees
            .map(
                (employee, index) =>
                    `${index + 1}. ${employee.name}`
            )
            .join("\n");

    // Проверяем, можно ли выполнять заказ
    const readyToComplete =
        order.isEscort
            ? count >= 3
            : count >= 1;

    let buttons;

    if (readyToComplete) {

        buttons = [
            [
                {
                    text:
                        "🔵 ЗАКАЗ ВЫПОЛНЕН",

                    callback_data:
                        `complete:${orderId}`
                }
            ]
        ];

    } else {

        buttons = [
            [
                {
                    text:
                        "✅ ВЗЯТЬ ЗАКАЗ",

                    callback_data:
                        `claim:${orderId}`
                }
            ]
        ];
    }

    // Обновляем сообщение сотрудников
    await telegram(
        "editMessageText",
        {
            chat_id:
                callback.message.chat.id,

            message_id:
                callback.message.message_id,

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

${
    order.isEscort
        ? `👥 Места: ${count}/3`
        : "👤 Сотрудник: 1/1"
}

${
    readyToComplete
        ? "🔵 Готов к выполнению"
        : "🟢 Ожидает сотрудников"
}`,

            reply_markup: {
                inline_keyboard:
                    buttons
            }
        }
    );

    // Уведомляем клиента
    await telegram(
        "sendMessage",
        {
            chat_id:
                order.userId,

            text:
`✅ Ваша заявка принята!

📦 Товар:
${order.product}

👨‍💼 Сотрудник:
${employeeName}

${
    order.isEscort
        ? `👥 Принято сотрудников: ${count}/3`
        : "🟢 Сотрудник уже взял ваш заказ."
}

Ожидайте дальнейшего сообщения.`
        }
    );
}

// Выполнение заказа
async function handleComplete(callback) {
    const orderId =
        callback.data.substring(9);

    const order = orders.get(orderId);

    if (!order) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callback.id,

                text:
                    "Заказ не найден",

                show_alert: true
            }
        );

        return;
    }

    // Уже выполнен
    if (order.status === "completed") {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callback.id,

                text:
                    "Заказ уже выполнен!",

                show_alert: true
            }
        );

        return;
    }

    // Проверяем количество сотрудников
    const requiredEmployees =
        order.isEscort ? 3 : 1;

    if (
        order.employees.length <
        requiredEmployees
    ) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callback.id,

                text:order.isEscort
                        ? "Нужно набрать 3 сотрудников!"
                        : "Сначала нужно принять заказ!",

                show_alert: true
            }
        );

        return;
    }

    // Проверяем, что кнопку нажал сотрудник,
    // который участвует в заказе
    const employeeId =
        callback.from.id;

    const isEmployee =
        order.employees.some(
            e => e.id === employeeId
        );

    if (!isEmployee) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callback.id,

                text:
                    "Вы не участвуете в этом заказе!",

                show_alert: true
            }
        );

        return;
    }

    // Меняем статус
    order.status = "completed";

    const employee =
        callback.from;

    const employeeName =
        employee.username
            ? "@" + employee.username
            : employee.first_name ||
              "Сотрудник";

    const employeesText =
        order.employees
            .map(
                (employee, index) =>
                    `${index + 1}. ${employee.name}`
            )
            .join("\n");

    // Ответ на кнопку
    await telegram(
        "answerCallbackQuery",
        {
            callback_query_id:
                callback.id,

            text:
                "Заказ выполнен ✅"
        }
    );

    // Меняем сообщение в чате сотрудников
    await telegram(
        "editMessageText",
        {
            chat_id:
                callback.message.chat.id,

            message_id:
                callback.message.message_id,

            text:
`🔵 ЗАКАЗ ВЫПОЛНЕН

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

🔵 Статус: выполнен

👨‍💼 Завершил:
${employeeName}`
        }
    );

    // Сообщение клиенту
    await telegram(
        "sendMessage",
        {
            chat_id:
                order.userId,

            text:
`🔵 Ваш заказ выполнен!

📦 Товар:
${order.product}

🎮 Игровой ID:
${order.gameId}

Спасибо за заказ! ❤️`
        }
    );
}

// Запуск сервера
const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {
        console.log(
            `Server started on port ${PORT}`
        );
    }
);

// Запуск бота
startBot();
