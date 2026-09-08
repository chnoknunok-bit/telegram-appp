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


/*
==================================================
                ДАННЫЕ МАГАЗИНА
==================================================
*/

const PRODUCTS = {

    "Набор Фулл 6 + МК вк на обвесах": {
        price: 25,
        escort: false,
        quantityEnabled: true,
        maxQuantity: 10
    },

    "Набор фулл 6": {
        price: 18,
        escort: false,
        quantityEnabled: true,
        maxQuantity: 10
    },

    "Оружие МК вк": {
        price: 0,
        escort: false,
        quantityEnabled: false,
        maxQuantity: 1
    },

    "Сопровождение 7кк + вещи": {
        price: 0,
        escort: true,
        quantityEnabled: false,
        maxQuantity: 1
    },

    "Сопровождение 15кк + вещи": {
        price: 0,
        escort: true,
        quantityEnabled: false,
        maxQuantity: 1
    },

    "Сопровождение 20кк + вещи": {
        price: 0,
        escort: true,
        quantityEnabled: false,
        maxQuantity: 1
    },

    "Сопровождение 25кк + вещи": {
        price: 0,
        escort: true,
        quantityEnabled: false,
        maxQuantity: 1
    }
};


/*
==================================================
            ВРЕМЕННОЕ ХРАНИЛИЩЕ
==================================================

ВАЖНО:
После перезапуска Render данные сбросятся.

Для настоящего магазина потом перенесём
пользователей, балансы и заказы в PostgreSQL.
==================================================
*/

const users = new Map();
const orders = new Map();
const transactions = new Map();

/*
==================================================
                  ПРОМОКОДЫ
==================================================

WELCOME   -> +25%, максимум 15 активаций
KavaSex67 -> +500 PT, 1 активация
Cheez     -> +750 PT, 1 активация
==================================================
*/

const PROMOCODES = {
    WELCOME: { type: "percent", percent: 25, bonus: 0, maxUses: 15, uses: 0, active: true },
    KAVASEX67: { type: "bonus", percent: 0, bonus: 500, maxUses: 1, uses: 0, active: true },
    CHEEZ: { type: "bonus", percent: 0, bonus: 750, maxUses: 1, uses: 0, active: true }
};

function normalizePromoCode(code) {
    return typeof code === "string" ? code.trim().toUpperCase() : "";
}

function calculatePromo(user, amount, promoCode) {
    const code = normalizePromoCode(promoCode);
    const basePoints = Number(amount);

    if (!code) return { ok: true, promoApplied: false, promoCode: null, basePoints, bonusPoints: 0, totalPoints: basePoints };

    const promo = PROMOCODES[code];
    if (!promo) return { ok: false, error: "Промокод не найден" };
    if (!promo.active) return { ok: false, error: "Промокод отключён" };
    if (promo.maxUses !== null && promo.uses >= promo.maxUses) return { ok: false, error: "Лимит активаций промокода исчерпан" };
    if (user.usedPromoCodes && user.usedPromoCodes.has(code)) return { ok: false, error: "Ты уже использовал этот промокод" };

    let bonusPoints = 0;
    if (promo.type === "percent") bonusPoints = Math.floor(basePoints * promo.percent / 100);
    if (promo.type === "bonus") bonusPoints = promo.bonus;

    return { ok: true, promoApplied: true, promoCode: code, basePoints, bonusPoints, totalPoints: basePoints + bonusPoints };
}

function activatePromoCode(user, promoCode) {
    const code = normalizePromoCode(promoCode);
    if (!code) return;
    const promo = PROMOCODES[code];
    if (!promo) return;
    promo.uses++;
    user.usedPromoCodes.add(code);
}

let orderCounter = 1000;
let transactionCounter = 1;


/*
==================================================
                  TELEGRAM
==================================================
*/

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


/*
==================================================
             TELEGRAM MINI APP DATA
==================================================
*/

function checkTelegramData(initData) {

    if (!initData || !BOT_TOKEN) {
        return null;
    }

    try {

        const params =
            new URLSearchParams(initData);

        const hash =
            params.get("hash");

        if (!hash) {
            return null;
        }

        params.delete("hash");

        const dataCheckString =
            [...params.entries()]
                .sort(([a], [b]) =>
                    a.localeCompare(b)
                )
                .map(
                    ([key, value]) =>
                        `${key}=${value}`
                )
                .join("\n");

        const secretKey =
            crypto
                .createHmac(
                    "sha256",
                    "WebAppData"
                )
                .update(BOT_TOKEN)
                .digest();

        const calculatedHash =
            crypto
                .createHmac(
                    "sha256",
                    secretKey
                )
                .update(dataCheckString)
                .digest("hex");

        if (calculatedHash !== hash) {
            return null;
        }

        const userRaw =
            params.get("user");

        if (!userRaw) {
            return null;
        }

        return JSON.parse(userRaw);

    } catch (error) {

        console.error(
            "Ошибка проверки Telegram:",
            error
        );

        return null;
    }
}


/*
==================================================
              ПОЛЬЗОВАТЕЛЬ
==================================================
*/

function getOrCreateUser(user) {

    if (!users.has(user.id)) {

        users.set(user.id, {

            id: user.id,

            username:
                user.username || "",

            firstName:
                user.first_name || "",

            balance: 0,

            usedPromoCodes: new Set()
        });
    }

    const saved =
        users.get(user.id);

    if (!saved.usedPromoCodes) {
        saved.usedPromoCodes = new Set();
    }

    saved.username =
        user.username ||
        saved.username;

    saved.firstName =
        user.first_name ||
        saved.firstName;

    return saved;
}


/*
==================================================
              ТРАНЗАКЦИИ
==================================================
*/

function addTransaction(
    userId,
    type,
    amount,
    description
) {

    const id =
        transactionCounter++;

    const transaction = {

        id,

        userId,

        type,

        amount,

        description,

        date:
            new Date().toISOString()
    };

    if (!transactions.has(userId)) {

        transactions.set(
            userId,
            []
        );
    }

    transactions
        .get(userId)
        .unshift(transaction);

    return transaction;
}


/*
==================================================
                    API
==================================================
*/

app.get("/", (req, res) => {

    res.json({

        ok: true,

        service:
            "СК МЕТРОШОП",

        currency:
            "POINT",

        currencyShort:
            "PT"
    });
});


/*
==================================================
             ПОЛУЧИТЬ ПРОФИЛЬ
==================================================
*/

app.post(
    "/api/profile",
    (req, res) => {

        const {
            initData
        } = req.body;

        const tgUser =
            checkTelegramData(
                initData
            );

        if (!tgUser) {

            return res
                .status(401)
                .json({

                    ok: false,

                    error:
                        "Неверные данные Telegram"
                });
        }

        const user =
            getOrCreateUser(
                tgUser
            );

        res.json({

            ok: true,

            user: {

                id:
                    user.id,

                username:
                    user.username,

                firstName:
                    user.firstName,

                balance:
                    user.balance
            }
        });
    }
);


/*
==================================================
             ПОЛУЧИТЬ ИСТОРИЮ
==================================================
*/

app.post(
    "/api/history",
    (req, res) => {

        const {
            initData
        } = req.body;

        const tgUser =
            checkTelegramData(
                initData
            );

        if (!tgUser) {

            return res
                .status(401)
                .json({

                    ok: false,

                    error:
                        "Неверные данные Telegram"
                });
        }

        const history =
            transactions.get(
                tgUser.id
            ) || [];

        res.json({

            ok: true,

            history
        });
    }
);        /*
        ------------------------------------------
        ЕСЛИ TELEGRAM НЕ ПРИНЯЛ ЗАКАЗ
        ------------------------------------------
        */

        if (
            !message ||
            !message.ok
        ) {

            user.balance +=
                totalPrice;

            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "Не удалось отправить заказ сотрудникам"
                });
        }


        /*
        ------------------------------------------
        СОХРАНЯЕМ MESSAGE ID
        ------------------------------------------
        */

        order.staffMessageId =
            message.result
                ? message.result.message_id
                : null;


        /*
        ------------------------------------------
        ОТВЕТ ПОЛЬЗОВАТЕЛЮ
        ------------------------------------------
        */

        return res.json({

            ok: true,

            orderId,

            balance:
                user.balance,

            order: {

                id:
                    order.id,

                product:
                    order.product,

                gameId:
                    order.gameId,

                quantity:
                    order.quantity,

                price:
                    order.price,

                status:
                    order.status,

                createdAt:
                    order.createdAt
            }
        });

    }
);


/*
==================================================
            ПОПОЛНЕНИЕ POINT
==================================================
*/

app.post(
    "/api/topup/create",
    async (req, res) => {

        const {
            initData,
            amount,
            promoCode
        } = req.body;


        /*
        ------------------------------------------
        Проверяем Telegram
        ------------------------------------------
        */

        const tgUser =
            checkTelegramData(
                initData
            );

        if (!tgUser) {

            return res
                .status(401)
                .json({

                    ok: false,

                    error:
                        "Неверные данные Telegram"
                });
        }


        /*
        ------------------------------------------
        ПРОВЕРЯЕМ СУММУ
        ------------------------------------------
        */

        const baseAmount =
            Number(amount);

        if (
            !Number.isFinite(
                baseAmount
            ) ||
            baseAmount <= 0
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Некорректная сумма"
                });
        }


        /*
        ------------------------------------------
        ПОЛУЧАЕМ ПОЛЬЗОВАТЕЛЯ
        ------------------------------------------
        */

        const user =
            getOrCreateUser(
                tgUser
            );


        /*
        ------------------------------------------
        ПРОМО
        ------------------------------------------
        */

        const promo =
            calculatePromo(
                user,
                baseAmount,
                promoCode
            );

        if (!promo.ok) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        promo.error
                });
        }


        const totalPoints =
            promo.totalPoints;


        /*
        ------------------------------------------
        СОЗДАЁМ ЗАЯВКУ
        ------------------------------------------
        */

        const topupId =
            `TP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;


        const topup = {

            id:
                topupId,

            userId:
                user.id,

            username:
                user.username ||
                "без username",

            baseAmount,

            bonusPoints:
                promo.bonusPoints,

            totalPoints,

            promoCode:
                promo.promoCode,

            status:
                "waiting_payment",

            createdAt:
                new Date().toISOString()
        };


        /*
        ------------------------------------------
        СОХРАНЯЕМ
        ------------------------------------------
        */

        if (!orders.has("topups")) {
            orders.set(
                "topups",
                new Map()
            );
        }

        orders
            .get("topups")
            .set(
                topupId,
                topup
            );


        /*
        ------------------------------------------
        СООБЩЕНИЕ СОТРУДНИКАМ
        ------------------------------------------
        */

        const text =

            `💰 <b>ПОПОЛНЕНИЕ POINT</b>\n\n` +

            `🆔 Заявка: <code>${topupId}</code>\n` +

            `👤 Клиент: @${topup.username}\n` +

            `💎 Базовое количество: <b>${baseAmount} PT</b>\n` +

            (
                promo.bonusPoints > 0
                    ? `🎁 Бонус: <b>+${promo.bonusPoints} PT</b>\n`
                    : ""
            ) +

            `💎 Итого: <b>${totalPoints} PT</b>\n` +

            (
                promo.promoCode
                    ? `🎟️ Промокод: <code>${promo.promoCode}</code>\n`
                    : ""
            ) +

            `\n🟡 Статус: <b>ОЖИДАЕТ ОПЛАТЫ</b>`;


        try {

            await telegram(
                "sendMessage",
                {

                    chat_id:
                        STAFF_CHAT_ID,

                    text,

                    parse_mode:
                        "HTML"
                }
            );

        } catch (error) {

            console.error(
                "Ошибка отправки пополнения:",
                error
            );
        }


        /*
        ------------------------------------------
        ОТВЕТ
        ------------------------------------------
        */

        return res.json({

            ok: true,

            topup: {

                id:
                    topupId,

                amount:
                    baseAmount,

                bonus:
                    promo.bonusPoints,

                total:
                    totalPoints,

                promoCode:
                    promo.promoCode,

                status:
                    topup.status
            }
        });
    }
);


/*
==================================================
          АКТИВАЦИЯ ПРОМОКОДА
==================================================
*/

app.post(
    "/api/promo/activate",
    (req, res) => {

        const {
            initData,
            code
        } = req.body;


        /*
        ------------------------------------------
        TELEGRAM
        ------------------------------------------
        */

        const tgUser =
            checkTelegramData(
                initData
            );

        if (!tgUser) {

            return res
                .status(401)
                .json({

                    ok: false,

                    error:
                        "Неверные данные Telegram"
                });
        }


        /*
        ------------------------------------------
        ПОЛЬЗОВАТЕЛЬ
        ------------------------------------------
        */

        const user =
            getOrCreateUser(
                tgUser
            );


        /*
        ------------------------------------------
        КОД
        ------------------------------------------
        */

        const normalizedCode =
            normalizePromoCode(
                code
            );

        const promo =
            PROMOCODES[
                normalizedCode
            ];

        if (!promo) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Промокод не найден"
                });
        }


        /*
        ------------------------------------------
        ТОЛЬКО БОНУСНЫЕ PT-КОДЫ
        ------------------------------------------
        */

        if (
            promo.type !==
            "bonus"
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Этот код нельзя активировать здесь"
                });
        }


        /*
        ------------------------------------------
        ПРОВЕРКА И АКТИВАЦИЯ
        ------------------------------------------
        */

        const result =
            calculatePromo(
                user,
                0,
                normalizedCode
            );

        if (!result.ok) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        result.error
                });
        }

        user.balance +=
            promo.bonus;

        activatePromoCode(
            user,
            normalizedCode
        );

        addTransaction(

            user.id,

            "promo",

            promo.bonus,

            `Промокод ${normalizedCode}`
        );


        /*
        ------------------------------------------
        ОТВЕТ
        ------------------------------------------
        */

        return res.json({

            ok: true,

            promoCode:
                normalizedCode,

            bonus:
                promo.bonus,

            balance:
                user.balance
        });
    }
);


/*
==================================================
            ПРОВЕРКА ПРОМО ПРОЦЕНТА
==================================================
*/

app.post(
    "/api/promo/check-percent",
    (req, res) => {

        const {
            initData,
            code
        } = req.body;

        const tgUser =
            checkTelegramData(
                initData
            );

        if (!tgUser) {

            return res
                .status(401)
                .json({

                    ok: false,

                    error:
                        "Неверные данные Telegram"
                });
        }

        const user =
            getOrCreateUser(
                tgUser
            );

        const normalizedCode =
            normalizePromoCode(
                code
            );

        const promo =
            PROMOCODES[
                normalizedCode
            ];

        if (!promo) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Промокод не найден"
                });
        }

        if (
            promo.type !==
            "percent"
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Это не процентный промокод"
                });
        }

        const result =
            calculatePromo(
                user,
                100,
                normalizedCode
            );

        if (!result.ok) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        result.error
                });
        }

        return res.json({

            ok: true,

            code:
                normalizedCode,

            percent:
                promo.percent
        });
    }
);


/*
==================================================
               ПРОВЕРКА PT ПРОМО
==================================================
*/

app.post(
    "/api/promo/check-bonus",
    (req, res) => {

        const {
            initData,
            code
        } = req.body;

        const tgUser =
            checkTelegramData(
                initData
            );

        if (!tgUser) {

            return res
                .status(401)
                .json({

                    ok: false,

                    error:
                        "Неверные данные Telegram"
                });
        }

        const user =
            getOrCreateUser(
                tgUser
            );

        const normalizedCode =
            normalizePromoCode(
                code
            );

        const promo =
            PROMOCODES[
                normalizedCode
            ];

        if (!promo) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Промокод не найден"
                });
        }

        if (
            promo.type !==
            "bonus"
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Это не PT-промокод"
                });
        }

        const result =
            calculatePromo(
                user,
                0,
                normalizedCode
            );

        if (!result.ok) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        result.error
                });
        }

        return res.json({

            ok: true,

            code:
                normalizedCode,

            bonus:
                promo.bonus
        });
    }
);


/*
==================================================
             ПРОВЕРКА ОБЩЕГО ПРОМО
==================================================
*/

app.post(
    "/api/promo/check",
    (req, res) => {

        const {
            initData,
            code
        } = req.body;

        const tgUser =
            checkTelegramData(
                initData
            );

        if (!tgUser) {

            return res
                .status(401)
                .json({

                    ok: false,

                    error:
                        "Неверные данные Telegram"
                });
        }

        const user =
            getOrCreateUser(
                tgUser
            );

        const normalizedCode =
            normalizePromoCode(
                code
            );

        const promo =
            PROMOCODES[
                normalizedCode
            ];

        if (!promo) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Промокод не найден"
                });
        }

        const result =
            calculatePromo(
                user,
                promo.type === "percent"
                    ? 100
                    : 0,
                normalizedCode
            );

        if (!result.ok) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        result.error
                });
        }

        return res.json({

            ok: true,

            code:
                normalizedCode,

            type:
                promo.type,

            percent:
                promo.percent,

            bonus:
                promo.bonus
        });
    }
);        /*
        ------------------------------------------
        ЕСЛИ TELEGRAM НЕ ПРИНЯЛ ЗАКАЗ
        ------------------------------------------
        */

        if (
            !message ||
            !message.ok
        ) {

            console.error(
                "Ошибка отправки заказа:",
                message
            );


            user.balance +=
                totalPrice;


            addTransaction(

                user.id,

                "refund",

                totalPrice,

                `Возврат за заказ #${orderId}`
            );


            orders.delete(
                orderId
            );


            return res
                .status(500)
                .json({

                    ok: false,

                    error:
                        "Не удалось отправить заказ сотрудникам"
                });
        }


        /*
        ------------------------------------------
        СОХРАНЯЕМ MESSAGE ID
        ------------------------------------------
        */

        order.staffMessageId =
            message.result.message_id;


        /*
        ------------------------------------------
        ОТВЕТ MINI APP
        ------------------------------------------
        */

        res.json({

            ok: true,

            orderId,

            balance:
                user.balance,

            status:
                order.status,

            quantity:
                finalQuantity,

            unitPrice:
                productInfo.price,

            totalPrice
        });
    }
);


/*
==================================================
           ПРОВЕРКА ПРОМОКОДА
==================================================
*/

app.post(
    "/api/promo/check",
    (req, res) => {

        const { initData, amount, promoCode } = req.body;
        const tgUser = checkTelegramData(initData);

        if (!tgUser) {
            return res.status(401).json({ ok: false, error: "Неверные данные Telegram" });
        }

        const points = Number(amount);

        if (!Number.isInteger(points) || points <= 0) {
            return res.status(400).json({ ok: false, error: "Количество PT должно быть целым числом больше 0" });
        }

        if (points > 1000000) {
            return res.status(400).json({ ok: false, error: "Максимум за одно пополнение — 1 000 000 PT" });
        }

        const user = getOrCreateUser(tgUser);
        const result = calculatePromo(user, points, promoCode);

        if (!result.ok) return res.status(400).json(result);

        res.json({
            ok: true,
            basePoints: result.basePoints,
            bonusPoints: result.bonusPoints,
            totalPoints: result.totalPoints,
            promoApplied: result.promoApplied,
            promoCode: result.promoCode
        });
    }
);


/*
==================================================
            ПОПОЛНЕНИЕ POINT
==================================================
*/

app.post(
    "/api/topup/create",
    (req, res) => {

        const { initData, amount, promoCode } = req.body;
        const tgUser = checkTelegramData(initData);

        if (!tgUser) {
            return res.status(401).json({ ok: false, error: "Неверные данные Telegram" });
        }

        const points = Number(amount);

        if (!Number.isInteger(points) || points <= 0) {
            return res.status(400).json({ ok: false, error: "Количество PT должно быть целым числом больше 0" });
        }

        if (points > 1000000) {
            return res.status(400).json({ ok: false, error: "Максимум за одно пополнение — 1 000 000 PT" });
        }

        const user = getOrCreateUser(tgUser);
        const promoResult = calculatePromo(user, points, promoCode);

        if (!promoResult.ok) return res.status(400).json(promoResult);

        const paymentId =
            "PT-" + Date.now() + "-" + Math.floor(Math.random() * 10000);

        res.json({
            ok: true,
            paymentId,
            amount: points,
            basePoints: promoResult.basePoints,
            bonusPoints: promoResult.bonusPoints,
            points: promoResult.totalPoints,
            promoApplied: promoResult.promoApplied,
            promoCode: promoResult.promoCode,
            paymentUrl: null,
            message: "Заявка рассчитана. Ручная оплата будет подключена следующим этапом."
        });
    }
);


/*
==================================================
       ВНУТРЕННЕЕ НАЧИСЛЕНИЕ POINT
==================================================
*/

app.post(
    "/api/payment/webhook",
    (req, res) => {

        return res
            .status(501)
            .json({

                ok: false,

                error:
                    "Webhook СБП ещё не подключён"
            });
    }
);


/*
==================================================
            ВЗЯТИЕ ЗАКАЗА
==================================================
*/

async function handleClaim(
    callbackQuery,
    orderId
) {

    const order =
        orders.get(
            Number(orderId)
        );


    if (!order) {

        await telegram(
            "answerCallbackQuery",
            {

                callback_query_id:
                    callbackQuery.id,

                text:
                    "❌ Заказ не найден",

                show_alert:
                    true
            }
        );

        return;
    }


    if (
        order.status ===
        "completed"
    ) {

        await telegram(
            "answerCallbackQuery",
            {

                callback_query_id:
                    callbackQuery.id,

                text:
                    "❌ Заказ уже выполнен",

                show_alert:
                    true
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
        order.isEscort
            ? 3
            : 1;


    if (
        order.employees.some(
            e =>
                e.id ===
                employeeId
        )
    ) {

        await telegram(
            "answerCallbackQuery",
            {

                callback_query_id:
                    callbackQuery.id,

                text:
                    "Ты уже взял этот заказ",

                show_alert:
                    true
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

                show_alert:
                    true
            }
        );

        return;
    }


    order.employees.push({

        id:
            employeeId,

        name:
            employeeName
    });


    order.status =
        "accepted";


    const count =
        order.employees.length;


    let text =

        `🟢 <b>ЗАКАЗ ПРИНЯТ</b>\n\n` +

        `🆔 Заказ: <code>${order.id}</code>\n` +

        `📦 Товар: <b>${order.product}</b>\n` +

        `📦 Количество: <b>${order.quantity} шт.</b>\n` +

        `💰 Цена за 1 шт.: <b>${order.unitPrice} PT</b>\n` +

        `💰 Итого: <b>${order.price} PT</b>\n` +

        `🎮 Game ID: <code>${order.gameId}</code>\n` +

        `👤 Клиент: @${order.username}\n\n` +

        `👥 Сотрудники: <b>${count}/${maxEmployees}</b>\n`;


    for (
        const employee
        of order.employees
    ) {

        text +=
            `• ${employee.name}\n`;
    }


    const buttons = [];


    if (
        count <
        maxEmployees
    ) {

        buttons.push([

            {

                text:
                    "✅ ВЗЯТЬ ЗАКАЗ",

                callback_data:
                    `claim:${order.id}`
            }

        ]);

    } else {

        buttons.push([

            {

                text:
                    "🔵 ЗАКАЗ ВЫПОЛНЕН",

                callback_data:
                    `complete:${order.id}`
            }
        ]);
    }


    await telegram(
        "editMessageText",
        {

            chat_id:
                STAFF_CHAT_ID,

            message_id:
                order.staffMessageId,

            text,

            parse_mode:
                "HTML",

            reply_markup: {

                inline_keyboard:
                    buttons
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

            chat_id:
                order.userId,

            text:

                `🟢 <b>Ваш заказ принят!</b>\n\n` +

                `🆔 Заказ: <code>${order.id}</code>\n` +

                `📦 ${order.product}\n` +

                `📦 Количество: <b>${order.quantity} шт.</b>\n` +

                `👥 Сотрудников: <b>${count}/${maxEmployees}</b>`,

            parse_mode:
                "HTML"
        }
    );
}


/*
==================================================
            ЗАВЕРШЕНИЕ ЗАКАЗА
==================================================
*/

async function handleComplete(
    callbackQuery,
    orderId
) {

    const order =
        orders.get(
            Number(orderId)
        );


    if (!order) {
        return;
    }


    if (
        order.status ===
        "completed"
    ) {

        await telegram(
            "answerCallbackQuery",
            {

                callback_query_id:
                    callbackQuery.id,

                text:
                    "Заказ уже выполнен",

                show_alert:
                    true
            }
        );

        return;
    }


    const maxEmployees =
        order.isEscort
            ? 3
            : 1;


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

                show_alert:
                    true
            }
        );

        return;
    }


    const employeeId =
        callbackQuery.from.id;


    const isEmployee =
        order.employees.some(
            employee =>
                employee.id ===
                employeeId
        );


    if (!isEmployee) {

        await telegram(
            "answerCallbackQuery",
            {

                callback_query_id:
                    callbackQuery.id,

                text:
                    "❌ Ты не сотрудник этого заказа",

                show_alert:
                    true
            }
        );

        return;
    }


    order.status =
        "completed";


    const finisher =
        callbackQuery.from.username
            ? `@${callbackQuery.from.username}`
            : callbackQuery.from.first_name ||
              "Сотрудник";


    let text =

        `🔵 <b>ЗАКАЗ ВЫПОЛНЕН</b>\n\n` +

        `🆔 Заказ: <code>${order.id}</code>\n` +

        `📦 Товар: <b>${order.product}</b>\n` +

        `📦 Количество: <b>${order.quantity} шт.</b>\n` +

        `💰 Цена за 1 шт.: <b>${order.unitPrice} PT</b>\n` +

        `💰 Итого: <b>${order.price} PT</b>\n` +

        `🎮 Game ID: <code>${order.gameId}</code>\n` +

        `👤 Клиент: @${order.username}\n\n` +

        `👥 Сотрудники:\n`;


    for (
        const employee
        of order.employees
    ) {

        text +=
            `• ${employee.name}\n`;
    }


    text +=
        `\n✅ Завершил: ${finisher}`;


    await telegram(
        "editMessageText",
        {

            chat_id:
                STAFF_CHAT_ID,

            message_id:
                order.staffMessageId,

            text,

            parse_mode:
                "HTML"
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

            chat_id:
                order.userId,

            text:

                `🔵 <b>Ваш заказ выполнен!</b>\n\n` +

                `🆔 Заказ: <code>${order.id}</code>\n` +

                `📦 ${order.product}\n` +

                `📦 Количество: <b>${order.quantity} шт.</b>\n\n` +

                `Спасибо за заказ!`,

            parse_mode:
                "HTML"
        }
    );
}


/*
==================================================
              ОБРАБОТКА CALLBACK
==================================================
*/

async function handleCallback(
    callbackQuery
) {

    const data =
        callbackQuery.data || "";


    if (
        data.startsWith("claim:")
    ) {

        const orderId =
            data.split(":")[1];

        await handleClaim(
            callbackQuery,
            orderId
        );

        return;
    }


    if (
        data.startsWith("complete:")
    ) {

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


/*
==================================================
                 TELEGRAM BOT
==================================================
*/

let offset = 0;


async function startBot() {

    if (!BOT_TOKEN) {

        console.error(
            "❌ Бот не запущен: нет BOT_TOKEN"
        );

        return;
    }


    await telegram(
        "deleteWebhook",
        {
            drop_pending_updates:
                false
        }
    );


    console.log(
        "Telegram бот запущен"
    );


    while (true) {

        try {

            const result =
                await telegram(
                    "getUpdates",
                    {

                        offset,

                        timeout:
                            25,

                        allowed_updates: [
                            "message",
                            "callback_query"
                        ]
                    }
                );


            if (!result.ok) {

                console.error(
                    "Telegram getUpdates:",
                    result
                );


                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            3000
                        )
                );


                continue;
            }


            for (
                const update
                of result.result
            ) {

                offset =
                    update.update_id + 1;


                if (
                    update.callback_query
                ) {

                    try {

                        await handleCallback(
                            update.callback_query
                        );

                    } catch (error) {

                        console.error(
                            "Ошибка callback:",
                            error
                        );

                        try {

                            await telegram(
                                "answerCallbackQuery",
                                {

                                    callback_query_id:
                                        update.callback_query.id,

                                    text:
                                        "❌ Произошла ошибка",

                                    show_alert:
                                        true
                                }
                            );

                        } catch (_) {}
                    }
                }
            }

        } catch (error) {

            console.error(
                "Ошибка Telegram bot:",
                error
            );


            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        3000
                    )
            );
        }
    }
}


/*
==================================================
                    ЗАПУСК
==================================================
*/

app.listen(
    PORT,
    () => {

        console.log(
            `🚀 Сервер запущен на порту ${PORT}`
        );

        startBot();
    }
);        await telegram(
            "sendMessage",
            {

                chat_id:
                    order.userId,

                text:

                    `🟢 <b>Ваш заказ принят!</b>\n\n` +

                    `🆔 Заказ: <code>${order.id}</code>\n` +

                    `📦 ${order.product}\n` +

                    `📦 Количество: <b>${order.quantity} шт.</b>\n` +

                    `👥 Сотрудников: <b>${count}/${maxEmployees}</b>`,

                parse_mode:
                    "HTML"
            }
        );
    }
}


/*
==================================================
            ЗАВЕРШЕНИЕ ЗАКАЗА
==================================================
*/

async function handleComplete(
    callbackQuery,
    orderId
) {

    const order =
        orders.get(
            Number(orderId)
        );


    if (!order) {
        return;
    }


    if (
        order.status ===
        "completed"
    ) {

        await telegram(
            "answerCallbackQuery",
            {

                callback_query_id:
                    callbackQuery.id,

                text:
                    "Заказ уже выполнен",

                show_alert:
                    true
            }
        );

        return;
    }


    const maxEmployees =
        order.isEscort
            ? 3
            : 1;


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

                show_alert:
                    true
            }
        );

        return;
    }


    const employeeId =
        callbackQuery.from.id;


    const isEmployee =
        order.employees.some(
            employee =>
                employee.id ===
                employeeId
        );


    if (!isEmployee) {

        await telegram(
            "answerCallbackQuery",
            {

                callback_query_id:
                    callbackQuery.id,

                text:
                    "❌ Ты не сотрудник этого заказа",

                show_alert:
                    true
            }
        );

        return;
    }


    order.status =
        "completed";


    const finisher =
        callbackQuery.from.username
            ? `@${callbackQuery.from.username}`
            : callbackQuery.from.first_name ||
              "Сотрудник";


    let text =

        `🔵 <b>ЗАКАЗ ВЫПОЛНЕН</b>\n\n` +

        `🆔 Заказ: <code>${order.id}</code>\n` +

        `📦 Товар: <b>${order.product}</b>\n` +

        `📦 Количество: <b>${order.quantity} шт.</b>\n` +

        `💰 Цена за 1 шт.: <b>${order.unitPrice} PT</b>\n` +

        `💰 Итого: <b>${order.price} PT</b>\n` +

        `🎮 Game ID: <code>${order.gameId}</code>\n` +

        `👤 Клиент: @${order.username}\n\n` +

        `👥 Сотрудники:\n`;


    for (
        const employee
        of order.employees
    ) {

        text +=
            `• ${employee.name}\n`;
    }


    text +=
        `\n✅ Завершил: ${finisher}`;


    await telegram(
        "editMessageText",
        {

            chat_id:
                STAFF_CHAT_ID,

            message_id:
                order.staffMessageId,

            text,

            parse_mode:
                "HTML"
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

            chat_id:
                order.userId,

            text:

                `🔵 <b>Ваш заказ выполнен!</b>\n\n` +

                `🆔 Заказ: <code>${order.id}</code>\n` +

                `📦 ${order.product}\n` +

                `📦 Количество: <b>${order.quantity} шт.</b>\n\n` +

                `Спасибо за заказ!`,

            parse_mode:
                "HTML"
        }
    );
}


/*
==================================================
              ОБРАБОТКА CALLBACK
==================================================
*/

async function handleCallback(
    callbackQuery
) {

    const data =
        callbackQuery.data || "";


    if (
        data.startsWith("claim:")
    ) {

        const orderId =
            data.split(":")[1];

        await handleClaim(
            callbackQuery,
            orderId
        );

        return;
    }


    if (
        data.startsWith("complete:")
    ) {

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


/*
==================================================
                 TELEGRAM BOT
==================================================
*/

let offset = 0;


async function startBot() {

    if (!BOT_TOKEN) {

        console.error(
            "❌ Бот не запущен: нет BOT_TOKEN"
        );

        return;
    }


    await telegram(
        "deleteWebhook",
        {
            drop_pending_updates:
                false
        }
    );


    console.log(
        "Telegram бот запущен"
    );


    while (true) {

        try {

            const result =
                await telegram(
                    "getUpdates",
                    {

                        offset,

                        timeout:
                            25,

                        allowed_updates: [
                            "message",
                            "callback_query"
                        ]
                    }
                );


            if (!result.ok) {

                console.error(
                    "Telegram getUpdates:",
                    result
                );


                await new Promise(
                    resolve =>
                        setTimeout(
                            resolve,
                            3000
                        )
                );


                continue;
            }


            for (
                const update
                of result.result
            ) {

                offset =
                    update.update_id + 1;


                if (
                    update.callback_query
                ) {

                    try {

                        await handleCallback(
                            update.callback_query
                        );

                    } catch (error) {

                        console.error(
                            "Ошибка callback:",
                            error
                        );

                        try {

                            await telegram(
                                "answerCallbackQuery",
                                {

                                    callback_query_id:
                                        update.callback_query.id,

                                    text:
                                        "❌ Произошла ошибка",

                                    show_alert:
                                        true
                                }
                            );

                        } catch (_) {}
                    }
                }
            }

        } catch (error) {

            console.error(
                "Ошибка Telegram bot:",
                error
            );


            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        3000
                    )
            );
        }
    }
}


/*
==================================================
                    ЗАПУСК
==================================================
*/

app.listen(
    PORT,
    () => {

        console.log(
            `🚀 Сервер запущен на порту ${PORT}`
        );

        startBot();
    }
);
