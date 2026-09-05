const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json());

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
        "Access-Control-Allow-Headers",
        "Origin, X-Requested-With, Content-Type, Accept"
    );
    res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, OPTIONS"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }

    next();
});

const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID;

if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN не задан");
}

if (!STAFF_CHAT_ID) {
    console.error("❌ STAFF_CHAT_ID не задан");
}

// ==================================================
//                    ТОВАРЫ
// ==================================================

const PRODUCTS = {
    "Набор Фулл 6 + МК вк на обвесах": {
        price: 0,
        escort: false
    },

    "Набор фулл 6": {
        price: 0,
        escort: false
    },

    "Оружие МК вк": {
        price: 0,
        escort: false
    },

    "Сопровождение 7кк + вещи": {
        price: 0,
        escort: true
    },

    "Сопровождение 15кк + вещи": {
        price: 0,
        escort: true
    },

    "Сопровождение 20кк + вещи": {
        price: 0,
        escort: true
    },

    "Сопровождение 25кк + вещи": {
        price: 0,
        escort: true
    }
};

// ==================================================
//                    ХРАНИЛИЩЕ
// ==================================================

const users = new Map();
const orders = new Map();
const transactions = new Map();

let orderCounter = 1000;
let transactionCounter = 1;

// ==================================================
//                 TELEGRAM API
// ==================================================

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

    return await response.json();
}

// ==================================================
//             ПРОВЕРКА TELEGRAM INIT DATA
// ==================================================

function checkTelegramData(initData) {
    if (!initData || !BOT_TOKEN) {
        return null;
    }

    try {
        const params = new URLSearchParams(initData);
        const hash = params.get("hash");

        if (!hash) {
            return null;
        }

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

        if (calculatedHash !== hash) {
            return null;
        }

        const userRaw = params.get("user");

        if (!userRaw) {
            return null;
        }

        return JSON.parse(userRaw);

    } catch (error) {
        console.error("Ошибка проверки Telegram:", error);
        return null;
    }
}

// ==================================================
//                    ПОЛЬЗОВАТЕЛЬ
// ==================================================

function getOrCreateUser(user) {
    if (!users.has(user.id)) {
        users.set(user.id, {
            id: user.id,
            username: user.username || "",
            firstName: user.first_name || "",
            balance: 0
        });
    }

    const saved = users.get(user.id);

    saved.username = user.username || saved.username;
    saved.firstName = user.first_name || saved.firstName;

    return saved;
}

// ==================================================
//                   ТРАНЗАКЦИИ
// ==================================================

function addTransaction(userId, type, amount, description) {
    const id = transactionCounter++;

    const transaction = {
        id,
        userId,
        type,
        amount,
        description,
        date: new Date().toISOString()
    };

    if (!transactions.has(userId)) {
        transactions.set(userId, []);
    }

    transactions.get(userId).unshift(transaction);

    return transaction;
}

// ==================================================
//                     ГЛАВНАЯ
// ==================================================

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "СК МЕТРОШОП",
        currency: "POINT",
        currencyShort: "PT"
    });
});

// ==================================================
//                    ПРОФИЛЬ
// ==================================================

app.post("/api/profile", (req, res) => {
    const { initData } = req.body;

    const tgUser = checkTelegramData(initData);

    if (!tgUser) {
        return res.status(401).json({
            ok: false,
            error: "Неверные данные Telegram"
        });
    }

    const user = getOrCreateUser(tgUser);

    res.json({
        ok: true,
        user: {
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            balance: user.balance
        }
    });
});

// ==================================================
//                    ИСТОРИЯ
// ==================================================

app.post("/api/history", (req, res) => {
    const { initData } = req.body;

    const tgUser = checkTelegramData(initData);

    if (!tgUser) {
        return res.status(401).json({
            ok: false,
            error: "Неверные данные Telegram"
        });
    }

    const history = transactions.get(tgUser.id) || [];

    res.json({
        ok: true,
        history
    });
});

// ==================================================
//                    ТОВАРЫ
// ==================================================

app.get("/api/products", (req, res) => {
    const result = Object.entries(PRODUCTS).map(
        ([name, data]) => ({
            name,
            price: data.price,
            escort: data.escort
        })
    );

    res.json({
        ok: true,
        products: result
    });
});

// ==================================================
//                     ПОКУПКА
// ==================================================

app.post("/api/buy", async (req, res) => {
    try {
        const {
            initData,
            product,
            gameId
        } = req.body;

        const tgUser = checkTelegramData(initData);

        if (!tgUser) {
            return res.status(401).json({
                ok: false,
                error: "Неверные данные Telegram"
            });
        }

        if (!product || !gameId) {
            return res.status(400).json({
                ok: false,
                error: "Укажи товар и игровой ID"
            });
        }

        const productInfo = PRODUCTS[product];

        if (!productInfo) {
            return res.status(400).json({
                ok: false,
                error: "Товар не найден"
            });
        }

        if (!productInfo.price || productInfo.price <= 0) {
            return res.status(400).json({
                ok: false,
                error: "Цена этого товара ещё не установлена"
            });
        }

        const user = getOrCreateUser(tgUser);

        if (user.balance < productInfo.price) {
            return res.status(400).json({
                ok: false,
                error: "Недостаточно POINT",
                balance: user.balance,
                required: productInfo.price
            });}

        user.balance -= productInfo.price;

        const orderId = orderCounter++;

        const order = {
            id: orderId,
            product,
            gameId,
            userId: user.id,
            username: user.username || "без username",
            isEscort: productInfo.escort,
            price: productInfo.price,
            status: "waiting",
            employees: [],
            createdAt: new Date().toISOString()
        };

        orders.set(orderId, order);

        addTransaction(
            user.id,
            "purchase",
            -productInfo.price,
            `Покупка: ${product}`
        );

        const maxEmployees =
            productInfo.escort ? 3 : 1;

        const text =
            `🟡 <b>ЗАКАЗ В ОЖИДАНИИ</b>\n\n` +
            `🆔 Заказ: <code>${orderId}</code>\n` +
            `📦 Товар: <b>${product}</b>\n` +
            `💰 Цена: <b>${productInfo.price} PT</b>\n` +
            `🎮 Game ID: <code>${gameId}</code>\n` +
            `👤 Клиент: @${user.username || "без username"}\n\n` +
            `👥 Сотрудники: <b>0/${maxEmployees}</b>`;

        const message = await telegram(
            "sendMessage",
            {
                chat_id: STAFF_CHAT_ID,
                text,
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "✅ ВЗЯТЬ ЗАКАЗ",
                                callback_data:
                                    `claim:${orderId}`
                            }
                        ]
                    ]
                }
            }
        );

        if (!message.ok) {
            console.error(
                "Ошибка отправки заказа:",
                message
            );

            user.balance += productInfo.price;

            addTransaction(
                user.id,
                "refund",
                productInfo.price,
                `Возврат за заказ #${orderId}`
            );

            orders.delete(orderId);

            return res.status(500).json({
                ok: false,
                error:
                    "Не удалось отправить заказ сотрудникам"
            });
        }

        order.staffMessageId =
            message.result.message_id;

        res.json({
            ok: true,
            orderId,
            balance: user.balance,
            status: order.status
        });

    } catch (error) {
        console.error("Ошибка покупки:", error);

        res.status(500).json({
            ok: false,
            error: "Внутренняя ошибка сервера"
        });
    }
});

// ==================================================
//                 ПОПОЛНЕНИЕ POINT
// ==================================================

app.post("/api/topup/create", (req, res) => {
    const {
        initData,
        amount
    } = req.body;

    const tgUser = checkTelegramData(initData);

    if (!tgUser) {
        return res.status(401).json({
            ok: false,
            error: "Неверные данные Telegram"
        });
    }

    const rubles = Number(amount);

    if (!Number.isInteger(rubles) || rubles <= 0) {
        return res.status(400).json({
            ok: false,
            error: "Неверная сумма"
        });
    }

    const paymentId =
        "PT-" +
        Date.now() +
        "-" +
        Math.floor(Math.random() * 10000);

    res.json({
        ok: true,
        paymentId,
        amount: rubles,
        points: rubles,
        paymentUrl: null,
        message:
            "СБП пока не подключено. Сначала подключите платёжного провайдера."
    });
});

// ==================================================
//                  WEBHOOK ОПЛАТЫ
// ==================================================

app.post("/api/payment/webhook", (req, res) => {
    res.status(501).json({
        ok: false,
        error: "Webhook СБП ещё не подключён"
    });
});

// ==================================================
//                  ВЗЯТИЕ ЗАКАЗА
// ==================================================

async function handleClaim(
    callbackQuery,
    orderId
) {
    const order = orders.get(
        Number(orderId)
    );

    if (!order) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,
                text: "❌ Заказ не найден",
                show_alert: true
            }
        );

        return;
    }

    if (order.status === "completed") {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,
                text: "❌ Заказ уже выполнен",
                show_alert: true
            }
        );

        return;
    }

    const employeeId =
        callbackQuery.from.id;

    const employeeName =
        callbackQuery.from.username
            ? `@${callbackQuery.from.username}`
            : callbackQuery.from.first_name ||
              "Сотрудник";

    const maxEmployees =
        order.isEscort ? 3 : 1;

    if (
        order.employees.some(
            e => e.id === employeeId
        )
    ) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,
                text:
                    "Ты уже взял этот заказ",
                show_alert: true
            }
        );

        return;
    }

    if (
        order.employees.length >=
        maxEmployees
    ) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,
                text:
                    "❌ Все места уже заняты",
                show_alert: true
            }
        );

        return;
    }

    order.employees.push({
        id: employeeId,
        name: employeeName
    });

    order.status = "accepted";

    const count =
        order.employees.length;

    let text =
        `🟢 <b>ЗАКАЗ ПРИНЯТ</b>\n\n` +
        `🆔 Заказ: <code>${order.id}</code>\n` +
        `📦 Товар: <b>${order.product}</b>\n` +
        `💰 Цена: <b>${order.price} PT</b>\n` +
        `🎮 Game ID: <code>${order.gameId}</code>\n` +
        `👤 Клиент: @${order.username}\n\n` +
        `👥 Сотрудники: <b>${count}/${maxEmployees}</b>\n`;

    for (
        const employee of order.employees
    ) {
        text +=
            `• ${employee.name}\n`;
    }

    const buttons = [];

    if (count < maxEmployees) {
        buttons.push([
            {
                text: "✅ ВЗЯТЬ ЗАКАЗ",
                callback_data:
                    `claim:${order.id}`
            }
        ]);
    } else {
        buttons.push([
            {
                text: "🔵 ЗАКАЗ ВЫПОЛНЕН",
                callback_data:
                    `complete:${order.id}`
            }
        ]);
    }

    await telegram(
        "editMessageText",
        {
            chat_id: STAFF_CHAT_ID,
            message_id:
                order.staffMessageId,
            text,
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: buttons
            }
        }
    );

    await telegram(
        "answerCallbackQuery",
        {
            callback_query_id:
                callbackQuery.id,
            text:
                "✅ Заказ закреплён за тобой"
        }
    );

    await telegram(
        "sendMessage",
        {
            chat_id: order.userId,
            text:
                `🟢 <b>Ваш заказ принят!</b>\n\n` +
                `🆔 Заказ: <code>${order.id}</code>\n` +
                `📦 ${order.product}\n` +
                `👥 Сотрудников: <b>${count}/${maxEmployees}</b>`,
            parse_mode: "HTML"
        }
    );
}

// ==================================================
//                  ЗАВЕРШЕНИЕ ЗАКАЗА
// ==================================================

async function handleComplete(
    callbackQuery,
    orderId
) {
    const order = orders.get(
        Number(orderId)
    );

    if (!order) {
        return;
    }

    if (order.status === "completed") {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,
                text:
                    "Заказ уже выполнен",
                show_alert: true
            }
        );

        return;
    }

    const maxEmployees =
        order.isEscort ? 3 : 1;

    if (
        order.employees.length <
        maxEmployees
    ) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,
                text:
                    `Нужно сотрудников: ${maxEmployees}`,
                show_alert: true
            }
        );

        return;
    }

    const employeeId =
        callbackQuery.from.id;

    const isEmployee =
        order.employees.some(
            employee =>
                employee.id === employeeId
        );

    if (!isEmployee) {
        await telegram(
            "answerCallbackQuery",
            {
                callback_query_id:
                    callbackQuery.id,
                text:
                    "❌ Ты не сотрудник этого заказа",
                show_alert: true
            }
        );

        return;
    }

    order.status = "completed";

    const finisher =
        callbackQuery.from.username
            ? `@${callbackQuery.from.username}`
            : callbackQuery.from.first_name ||
              "Сотрудник";

    let text =
        `🔵 <b>ЗАКАЗ ВЫПОЛНЕН</b>\n\n` +
        `🆔 Заказ: <code>${order.id}</code>\n` +
        `📦 Товар: <b>${order.product}</b>\n` +
        `💰 Цена: <b>${order.price} PT</b>\n` +
        `🎮 Game ID: <code>${order.gameId}</code>\n` +
        `👤 Клиент: @${order.username}\n\n` +
        `👥 Сотрудники:\n`;

    for (
        const employee of order.employees
    ) {
        text +=
            `• ${employee.name}\n`;
    }

    text +=
        `\n✅ Завершил: ${finisher}`;

    await telegram(
        "editMessageText",
        {
            chat_id: STAFF_CHAT_ID,
            message_id:
                order.staffMessageId,
            text,
            parse_mode: "HTML"
        }
    );

    await telegram(
        "answerCallbackQuery",
        {
            callback_query_id:
                callbackQuery.id,
            text:
                "🔵 Заказ завершён"
        }
    );

    await telegram(
        "sendMessage",
        {
            chat_id: order.userId,
            text:
                `🔵 <b>Ваш заказ выполнен!</b>\n\n` +
                `🆔 Заказ: <code>${order.id}</code>\n` +
                `📦 ${order.product}\n\n` +
                `Спасибо за заказ!`,
            parse_mode: "HTML"
        }
    );
}

// ==================================================
//                 CALLBACK TELEGRAM
// ==================================================

async function handleCallback(
    callbackQuery
) {
    const data =
        callbackQuery.data || "";

    if (data.startsWith("claim:")) {
        const orderId =
            data.split(":")[1];

        await handleClaim(
            callbackQuery,
            orderId
        );

        return;
    }

    if (data.startsWith("complete:")) {
        const orderId =
            data.split(":")[1];

        await handleComplete(
            callbackQuery,
            orderId
        );

        return;
    }

    await telegram(
        "answerCallbackQuery",
        {
            callback_query_id:
                callbackQuery.id
        }
    );
}

// ==================================================
//                  TELEGRAM BOT
// ==================================================

let offset = 0;

async function startBot() {
    if (!BOT_TOKEN) {
