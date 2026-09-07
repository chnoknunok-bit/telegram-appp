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

ПРОМОКОДЫ НА ПРОЦЕНТ:

WELCOME
→ +25% к пополнению
→ максимум 15 активаций


ПРОМОКОДЫ НА PT:

CHEEZ
→ +750 PT
→ максимум 1 активация


KAVASEX67
→ +500 PT
→ максимум 1 активация


ВАЖНО:

Промокоды на % и PT используются
В РАЗНЫХ ПОЛЯХ.

WELCOME нельзя использовать в поле PT.

CHEEZ и KAVASEX67 нельзя использовать
в поле %.


Один пользователь может использовать:

WELCOME + CHEEZ

или

WELCOME + KAVASEX67

Потому что это разные промокоды.
==================================================
*/

const PROMOCODES = {

    /*
    Поле:
    «Промокод на %»
    */

    WELCOME: {
        type: "percent",
        percent: 25,
        bonus: 0,
        maxUses: 15,
        uses: 0,
        active: true
    },


    /*
    Поле:
    «Промокод на PT»
    */

    CHEEZ: {
        type: "bonus",
        percent: 0,
        bonus: 750,
        maxUses: 1,
        uses: 0,
        active: true
    },


    /*
    Поле:
    «Промокод на PT»
    */

    KAVASEX67: {
        type: "bonus",
        percent: 0,
        bonus: 500,
        maxUses: 1,
        uses: 0,
        active: true
    }

};


/*
==================================================
              НОРМАЛИЗАЦИЯ ПРОМО
==================================================
*/

function normalizePromoCode(code) {

    if (
        typeof code !== "string"
    ) {

        return "";
    }

    return code
        .trim()
        .toUpperCase();
}


/*
==================================================
       ПРОВЕРКА ПРОМОКОДА НА ПРОЦЕНТ
==================================================

РАЗРЕШЁН ТОЛЬКО:

WELCOME

CHEEZ / KAVASEX67 здесь
будут отклонены.
==================================================
*/

function calculatePercentPromo(
    user,
    amount,
    promoCode
) {

    const code =
        normalizePromoCode(
            promoCode
        );


    const basePoints =
        Number(amount);


    /*
    Поле пустое —
    просто пополнение без %.
    */

    if (!code) {

        return {

            ok: true,

            promoApplied: false,

            promoCode: null,

            basePoints,

            bonusPoints: 0,

            totalPoints:
                basePoints
        };
    }


    const promo =
        PROMOCODES[code];


    if (!promo) {

        return {

            ok: false,

            error:
                "Промокод на процент не найден"
        };
    }


    /*
    ЗАЩИТА ОТ PT-ПРОМОКОДОВ
    */

    if (
        promo.type !== "percent"
    ) {

        return {

            ok: false,

            error:
                "В это поле можно вводить только промокод на процент"
        };
    }


    if (
        !promo.active
    ) {

        return {

            ok: false,

            error:
                "Промокод отключён"
        };
    }


    if (
        promo.maxUses !== null &&
        promo.uses >= promo.maxUses
    ) {

        return {

            ok: false,

            error:
                "Лимит активаций промокода исчерпан"
        };
    }


    /*
    Проверяем использование
    именно этого промокода.

    Поэтому WELCOME и CHEEZ
    не конфликтуют между собой.
    */

    if (
        user.usedPromoCodes &&
        user.usedPromoCodes.has(code)
    ) {

        return {

            ok: false,

            error:
                "Ты уже использовал этот промокод"
        };
    }


    const bonusPoints =
        Math.floor(
            basePoints *
            promo.percent /
            100
        );


    return {

        ok: true,

        promoApplied: true,

        promoCode: code,

        basePoints,

        bonusPoints,

        totalPoints:
            basePoints +
            bonusPoints
    };
}


/*
==================================================
          ПРОВЕРКА ПРОМОКОДА НА PT
==================================================

РАЗРЕШЕНЫ ТОЛЬКО:

CHEEZ
KAVASEX67

WELCOME здесь будет отклонён.
==================================================
*/

function calculateBonusPromo(
    user,
    promoCode
) {

    const code =
        normalizePromoCode(
            promoCode
        );


    /*
    Поле пустое —
    бонуса нет.
    */

    if (!code) {

        return {

            ok: true,

            promoApplied: false,

            promoCode: null,

            bonusPoints: 0
        };
    }


    const promo =
        PROMOCODES[code];


    if (!promo) {

        return {

            ok: false,

            error:
                "Промокод на бонусные PT не найден"
        };
    }


    /*
    ЗАЩИТА ОТ WELCOME
    */

    if (
        promo.type !== "bonus"
    ) {

        return {

            ok: false,

            error:
                "В это поле можно вводить только промокод на бонусные PT"
        };
    }


    if (
        !promo.active
    ) {

        return {

            ok: false,

            error:
                "Промокод отключён"
        };
    }


    if (
        promo.maxUses !== null &&
        promo.uses >= promo.maxUses
    ) {

        return {

            ok: false,

            error:
                "Лимит активаций промокода исчерпан"
        };
    }


    /*
    Проверяем только этот конкретный код.
    */

    if (
        user.usedPromoCodes &&
        user.usedPromoCodes.has(code)
    ) {

        return {

            ok: false,

            error:
                "Ты уже использовал этот промокод"
        };
    }


    return {

        ok: true,

        promoApplied: true,

        promoCode: code,

        bonusPoints:
            promo.bonus
    };
}


/*
==================================================
          АКТИВАЦИЯ ПРОМОКОДА
==================================================

Вызывается ТОЛЬКО после успешного
начисления пополнения.

Поэтому создание заявки само по себе
промокод не сжигает.
==================================================
*/

function activatePromoCode(
    user,
    promoCode
) {

    const code =
        normalizePromoCode(
            promoCode
        );


    if (!code) {
        return;
    }


    const promo =
        PROMOCODES[code];


    if (!promo) {
        return;
    }


    if (!user.usedPromoCodes) {

        user.usedPromoCodes =
            new Set();
    }


    /*
    Защита от повторной активации.
    */

    if (
        user.usedPromoCodes.has(code)
    ) {

        return;
    }


    /*
    Защита от превышения
    общего лимита промокода.
    */

    if (
        promo.maxUses !== null &&
        promo.uses >= promo.maxUses
    ) {

        return;
    }


    promo.uses++;


    user.usedPromoCodes.add(
        code
    );
}


/*
==================================================
                  СЧЁТЧИКИ
==================================================
*/

let orderCounter = 1000;
let transactionCounter = 1;


/*
==================================================
                  TELEGRAM
==================================================
*/

async function telegram(
    method,
    data
) {

    const response =
        await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
            {

                method: "POST",

                headers: {

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(data)
            }
        );


    return await response.json();
}


/*
==================================================
             TELEGRAM MINI APP DATA
==================================================
*/

function checkTelegramData(
    initData
) {

    if (
        !initData ||
        !BOT_TOKEN
    ) {

        return null;
    }


    try {

        const params =
            new URLSearchParams(
                initData
            );


        const hash =
            params.get("hash");


        if (!hash) {

            return null;
        }


        params.delete("hash");


        const dataCheckString =
            [...params.entries()]
                .sort(
                    ([a], [b]) =>
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
                .update(
                    dataCheckString
                )
                .digest("hex");


        if (
            calculatedHash !== hash
        ) {

            return null;
        }


        const userRaw =
            params.get("user");


        if (!userRaw) {

            return null;
        }


        return JSON.parse(
            userRaw
        );

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

function getOrCreateUser(
    user
) {

    if (
        !users.has(user.id)
    ) {

        users.set(
            user.id,
            {

                id:
                    user.id,

                username:
                    user.username ||
                    "",

                firstName:
                    user.first_name ||
                    "",

                balance: 0,

                usedPromoCodes:
                    new Set()
            }
        );
    }


    const saved =
        users.get(user.id);


    saved.username =
        user.username ||
        saved.username;


    saved.firstName =
        user.first_name ||
        saved.firstName;


    if (
        !saved.usedPromoCodes
    ) {

        saved.usedPromoCodes =
            new Set();
    }


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
            new Date()
                .toISOString()
    };


    if (
        !transactions.has(
            userId
        )
    ) {

        transactions.set(
            userId,
            []
        );
    }


    transactions
        .get(userId)
        .unshift(
            transaction
        );


    return transaction;
}


/*
==================================================
                    API
==================================================
*/

app.get(
    "/",
    (req, res) => {

        res.json({

            ok: true,

            service:
                "СК МЕТРОШОП",

            currency:
                "POINT",

            currencyShort:
                "PT"
        });
    }
);


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
);


/*
==================================================
            ПОЛУЧИТЬ ТОВАРЫ
==================================================
*/

app.get(
    "/api/products",
    (req, res) => {

        const result =
            Object.entries(
                PRODUCTS
            ).map(
                ([name, data]) => ({

                    name,

                    price:
                        data.price,

                    escort:
                        data.escort,

                    quantityEnabled:
                        data.quantityEnabled,

                    maxQuantity:
                        data.maxQuantity
                })
            );


        res.json({

            ok: true,

            products:
                result
        });
    }
);


/*
==================================================
       ПРОВЕРКА ПРОМОКОДА НА ПРОЦЕНТ
==================================================

Используется отдельное поле:

promoPercent

Пример:

{
    initData,
    amount,
    promoPercent: "WELCOME"
}

Сюда нельзя передавать CHEEZ
или KAVASEX67.
==================================================
*/

app.post(
    "/api/promo/check-percent",
    (req, res) => {

        const {
            initData,
            amount,
            promoPercent
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


        const points =
            Number(amount);


        if (
            !Number.isInteger(
                points
            ) ||
            points <= 0
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Количество PT должно быть целым числом больше 0"
                });
        }


        if (
            points > 1000000
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Максимум за одно пополнение — 1 000 000 PT"
                });
        }


        const user =
            getOrCreateUser(
                tgUser
            );


        const result =
            calculatePercentPromo(
                user,
                points,
                promoPercent
            );


        if (!result.ok) {

            return res
                .status(400)
                .json(result);
        }


        res.json({

            ok: true,

            basePoints:
                result.basePoints,

            bonusPoints:
                result.bonusPoints,

            totalPoints:
                result.totalPoints,

            promoApplied:
                result.promoApplied,

            promoCode:
                result.promoCode
        });
    }
);


/*
==================================================
          ПРОВЕРКА ПРОМОКОДА НА PT
==================================================

Используется отдельное поле:

promoBonus

Пример:

{
    initData,
    promoBonus: "CHEEZ"
}

или:

{
    initData,
    promoBonus: "KAVASEX67"
}

WELCOME здесь работать НЕ будет.
==================================================
*/

app.post(
    "/api/promo/check-bonus",
    (req, res) => {

        const {
            initData,
            promoBonus
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


        const result =
            calculateBonusPromo(
                user,
                promoBonus
            );


        if (!result.ok) {

            return res
                .status(400)
                .json(result);
        }


        res.json({

            ok: true,

            bonusPoints:
                result.bonusPoints,

            promoApplied:
                result.promoApplied,

            promoCode:
                result.promoCode
        });
    }
);


/*
==================================================
       СТАРЫЙ API ПРОВЕРКИ ПРОМО
==================================================

Оставляем совместимость со старым фронтендом.

ВАЖНО:

Теперь этот endpoint считает
ТОЛЬКО процентный промокод.

Для PT используется:

/api/promo/check-bonus
==================================================
*/

app.post(
    "/api/promo/check",
    (req, res) => {

        const {
            initData,
            amount,
            promoCode
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


        const points =
            Number(amount);


        if (
            !Number.isInteger(
                points
            ) ||
            points <= 0
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Количество PT должно быть целым числом больше 0"
                });
        }


        if (
            points > 1000000
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Максимум за одно пополнение — 1 000 000 PT"
                });
        }


        const user =
            getOrCreateUser(
                tgUser
            );


        const result =
            calculatePercentPromo(
                user,
                points,
                promoCode
            );


        if (!result.ok) {

            return res
                .status(400)
                .json(result);
        }


        res.json({

            ok: true,

            basePoints:
                result.basePoints,

            bonusPoints:
                result.bonusPoints,

            totalPoints:
                result.totalPoints,

            promoApplied:
                result.promoApplied,

            promoCode:
                result.promoCode
        });
    }
);


/*
==================================================
       СОЗДАТЬ ЗАКАЗ ЗА POINT
==================================================
*/

app.post(
    "/api/buy",
    async (req, res) => {

        const {
            initData,
            product,
            gameId,
            quantity
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


        if (
            !product ||
            !gameId
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Укажи товар и игровой ID"
                });
        }


        const productInfo =
            PRODUCTS[product];


        if (!productInfo) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Товар не найден"
                });
        }


        if (
            !productInfo.price ||
            productInfo.price <= 0
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Цена этого товара ещё не установлена"
                });
        }


        let finalQuantity = 1;


        if (
            productInfo.quantityEnabled
        ) {

            finalQuantity =
                Number(quantity);


            if (
                !Number.isInteger(
                    finalQuantity
                )
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            "Количество должно быть целым числом"
                    });
            }


            if (
                finalQuantity < 1 ||
                finalQuantity >
                    productInfo.maxQuantity
            ) {

                return res
                    .status(400)
                    .json({

                        ok: false,

                        error:
                            `Количество должно быть от 1 до ${productInfo.maxQuantity}`
                    });
            }
        }


        const totalPrice =
            productInfo.price *
            finalQuantity;


        const user =
            getOrCreateUser(
                tgUser
            );


        if (
            user.balance <
            totalPrice
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Недостаточно POINT",

                    balance:
                        user.balance,

                    required:
                        totalPrice
                });
        }


        user.balance -=
            totalPrice;


        const orderId =
            orderCounter++;


        const order = {

            id:
                orderId,

            product,

            gameId,

            quantity:
                finalQuantity,

            userId:
                user.id,

            username:
                user.username ||
                "без username",

            isEscort:
                productInfo.escort,

            unitPrice:
                productInfo.price,

            price:
                totalPrice,

            status:
                "waiting",

            employees:
                [],

            createdAt:
                new Date().toISOString()
        };


        orders.set(
            orderId,
            order
        );


        addTransaction(

            user.id,

            "purchase",

            -totalPrice,

            `Покупка: ${product} × ${finalQuantity}`
        );


        const maxEmployees =
            productInfo.escort
                ? 3
                : 1;


        const text =

            `🟡 <b>ЗАКАЗ В ОЖИДАНИИ</b>\n\n` +

            `🆔 Заказ: <code>${orderId}</code>\n` +

            `📦 Товар: <b>${product}</b>\n` +

            `📦 Количество: <b>${finalQuantity} шт.</b>\n` +

            `💰 Цена за 1 шт.: <b>${productInfo.price} PT</b>\n` +

            `💰 Итого: <b>${totalPrice} PT</b>\n` +

            `🎮 Game ID: <code>${gameId}</code>\n` +

            `👤 Клиент: @${user.username || "без username"}\n\n` +

            `👥 Сотрудники: <b>0/${maxEmployees}</b>`;


        let message;


        try {

            message =
                await telegram(
                    "sendMessage",
                    {

                        chat_id:
                            STAFF_CHAT_ID,

                        text,

                        parse_mode:
                            "HTML",

                        reply_markup: {

                            inline_keyboard: [

                                [

                                    {

                                        text:
                                            "✅ ВЗЯТЬ ЗАКАЗ",

                                        callback_data:
                                            `claim:${orderId}`
                                    }

                                ]

                            ]
                        }
                    }
                );

        } catch (error) {

            console.error(
                "Ошибка Telegram:",
                error
            );

            message = {
                ok: false
            };
        }


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


        order.staffMessageId =
            message.result.message_id;


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
);/*
==================================================
           ПОПОЛНЕНИЕ POINT
==================================================
*/

app.post(
    "/api/topup/create",
    (req, res) => {

        const {
            initData,
            amount,
            promoPercent,
            promoBonus,

            // Оставляем старое имя для совместимости
            promoCode
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


        const points =
            Number(amount);


        if (
            !Number.isInteger(
                points
            ) ||
            points <= 0
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Количество PT должно быть целым числом больше 0"
                });
        }


        if (
            points > 1000000
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Максимум за одно пополнение — 1 000 000 PT"
                });
        }


        const user =
            getOrCreateUser(
                tgUser
            );


        /*
        ==================================================
        ПОЛЕ ПРОМОКОДА НА %
        ==================================================

        Основное поле:
        promoPercent

        Если фронтенд пока отправляет старое:
        promoCode

        используем его только как промокод на %.
        ==================================================
        */

        const percentCode =
            typeof promoPercent === "string"
                ? promoPercent
                : (
                    typeof promoCode === "string"
                        ? promoCode
                        : ""
                );


        const percentResult =
            calculatePercentPromo(
                user,
                points,
                percentCode
            );


        if (!percentResult.ok) {

            return res
                .status(400)
                .json(
                    percentResult
                );
        }


        /*
        ==================================================
        ПОЛЕ ПРОМОКОДА НА PT
        ==================================================

        Отдельное поле:
        promoBonus

        Например:

        CHEEZ
        KAVASEX67

        WELCOME здесь работать не будет.
        ==================================================
        */

        const bonusResult =
            calculateBonusPromo(
                user,
                promoBonus
            );


        if (!bonusResult.ok) {

            return res
                .status(400)
                .json(
                    bonusResult
                );
        }


        /*
        ==================================================
        ОБЩИЙ БОНУС
        ==================================================

        Пример:

        Пополнение: 1000 PT
        WELCOME: +250 PT
        CHEEZ: +750 PT

        Итого:

        2000 PT
        ==================================================
        */

        const percentBonus =
            percentResult.bonusPoints || 0;


        const fixedBonus =
            bonusResult.bonusPoints || 0;


        const totalBonus =
            percentBonus +
            fixedBonus;


        const totalPoints =
            points +
            totalBonus;


        /*
        ==================================================
        СОЗДАЁМ ID ПЛАТЕЖА
        ==================================================
        */

        const paymentId =
            "PT-" +
            Date.now() +
            "-" +
            Math.floor(
                Math.random() *
                10000
            );


        /*
        ==================================================
        ВАЖНО
        ==================================================

        Баланс здесь НЕ увеличивается.

        Промокоды здесь тоже НЕ активируются.

        Они активируются только после того,
        как ручная оплата будет подтверждена.
        ==================================================
        */


        res.json({

            ok: true,

            paymentId,

            amount:
                points,

            basePoints:
                points,

            percentBonus,

            fixedBonus,

            bonusPoints:
                totalBonus,

            points:
                totalPoints,

            promoPercent:
                percentResult.promoCode,

            promoBonus:
                bonusResult.promoCode,

            promoApplied:
                Boolean(
                    percentResult.promoApplied ||
                    bonusResult.promoApplied
                ),

            paymentUrl:
                null,

            message:
                "Заявка рассчитана. Ручная оплата будет подключена следующим этапом."
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

        /*
        Пока ручная оплата не подключена.

        Здесь позже будет подтверждение платежа
        и фактическое начисление PT.
        */

        return res
            .status(501)
            .json({

                ok: false,

                error:
                    "Ручная оплата ещё не подключена"
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


    /*
    Проверяем завершён ли заказ
    */

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


    /*
    Для обычного товара:
    1 сотрудник.

    Для сопровождения:
    3 сотрудника.
    */

    const maxEmployees =
        order.isEscort
            ? 3
            : 1;


    /*
    Проверяем, не взял ли
    этот сотрудник заказ раньше.
    */

    if (
        order.employees.some(
            employee =>
                employee.id ===
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


    /*
    Проверяем свободные места.
    */

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


    /*
    Добавляем сотрудника.
    */

    order.employees.push({

        id:
            employeeId,

        name:
            employeeName
    });


    /*
    После первого сотрудника
    заказ считается принятым.
    */

    order.status =
        "accepted";


    const count =
        order.employees.length;


    /*
    ==================================================
    СООБЩЕНИЕ ДЛЯ СОТРУДНИКОВ
    ==================================================
    */

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


    /*
    ==================================================
    КНОПКИ
    ==================================================
    */

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

        /*
        Все необходимые сотрудники
        набраны — можно завершать.
        */

        buttons.push([

            {

                text:
                    "🔵 ЗАКАЗ ВЫПОЛНЕН",

                callback_data:
                    `complete:${order.id}`
            }

        ]);
    }


    /*
    ==================================================
    ОБНОВЛЯЕМ СООБЩЕНИЕ В ЧАТЕ СОТРУДНИКОВ
    ==================================================
    */

    const editResult =
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


    if (
        !editResult ||
        !editResult.ok
    ) {

        console.error(
            "Ошибка изменения сообщения заказа:",
            editResult
        );
    }


    /*
    ==================================================
    ОТВЕТ НА НАЖАТИЕ КНОПКИ
    ==================================================
    */

    await telegram(
        "answerCallbackQuery",
        {

            callback_query_id:
                callbackQuery.id,

            text:
                "✅ Заказ закреплён за тобой"
        }
    );


    /*
    ==================================================
    УВЕДОМЛЯЕМ КЛИЕНТА
    ==================================================
    */

    const clientMessage =
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


    if (
        !clientMessage ||
        !clientMessage.ok
    ) {

        console.error(
            "Не удалось отправить уведомление клиенту:",
            clientMessage
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


    /*
    Проверяем, не выполнен ли
    заказ уже.
    */

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


    /*
    ==================================================
    ПРОВЕРЯЕМ КОЛИЧЕСТВО СОТРУДНИКОВ
    ==================================================
    */

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


    /*
    ==================================================
    ПРОВЕРЯЕМ, ЧТО КНОПКУ НАЖАЛ
    СОТРУДНИК ЭТОГО ЗАКАЗА
    ==================================================
    */

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


    /*
    ==================================================
    ЗАВЕРШАЕМ ЗАКАЗ
    ==================================================
    */

    order.status =
        "completed";


    order.completedAt =
        new Date().toISOString();


    const finisher =
        callbackQuery.from.username
            ? `@${callbackQuery.from.username}`
            : callbackQuery.from.first_name ||
              "Сотрудник";


    /*
    ==================================================
    ФОРМИРУЕМ СООБЩЕНИЕ
    ==================================================
    */

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


    /*
    ==================================================
    ОБНОВЛЯЕМ СООБЩЕНИЕ СОТРУДНИКОВ
    ==================================================
    */

    const editResult =
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


    if (
        !editResult ||
        !editResult.ok
    ) {

        console.error(
            "Ошибка обновления завершённого заказа:",
            editResult
        );
    }


    /*
    ==================================================
    ОТВЕТ СОТРУДНИКУ
    ==================================================
    */

    await telegram(
        "answerCallbackQuery",
        {

            callback_query_id:
                callbackQuery.id,

            text:
                "🔵 Заказ завершён"
        }
    );


    /*
    ==================================================
    УВЕДОМЛЯЕМ КЛИЕНТА
    ==================================================
    */

    const clientMessage =
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


    if (
        !clientMessage ||
        !clientMessage.ok
    ) {

        console.error(
            "Не удалось отправить сообщение клиенту:",
            clientMessage
        );
    }
}/*
==================================================
               ОБРАБОТКА CALLBACK
==================================================
*/

async function handleCallback(
    callbackQuery
) {

    const data =
        callbackQuery.data || "";


    /*
    ==============================================
    ВЗЯТИЕ ЗАКАЗА
    ==============================================
    */

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


    /*
    ==============================================
    ЗАВЕРШЕНИЕ ЗАКАЗА
    ==============================================
    */

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


    /*
    ==============================================
    НЕИЗВЕСТНЫЙ CALLBACK
    ==============================================
    */

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


/*
==================================================
                  ЗАПУСК БОТА
==================================================
*/

async function startBot() {

    if (!BOT_TOKEN) {

        console.error(
            "❌ Бот не запущен: нет BOT_TOKEN"
        );

        return;
    }


    /*
    Удаляем webhook,
    потому что используем getUpdates.
    */

    try {

        const webhookResult =
            await telegram(
                "deleteWebhook",
                {

                    drop_pending_updates:
                        false
                }
            );


        if (
            !webhookResult ||
            !webhookResult.ok
        ) {

            console.error(
                "Ошибка удаления webhook:",
                webhookResult
            );
        }

    } catch (error) {

        console.error(
            "Ошибка deleteWebhook:",
            error
        );
    }


    console.log(
        "🤖 Telegram бот запущен"
    );


    /*
    ==============================================
    БЕСКОНЕЧНЫЙ POLLING
    ==============================================
    */

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


            /*
            ==========================================
            ОШИБКА TELEGRAM
            ==========================================
            */

            if (
                !result ||
                !result.ok
            ) {

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


            /*
            ==========================================
            ОБРАБАТЫВАЕМ ОБНОВЛЕНИЯ
            ==========================================
            */

            for (
                const update
                of result.result
            ) {

                /*
                Сдвигаем offset,
                чтобы одно обновление
                не обрабатывалось повторно.
                */

                offset =
                    update.update_id + 1;


                /*
                ======================================
                CALLBACK QUERY
                ======================================
                */

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


                        /*
                        Пытаемся сообщить
                        пользователю об ошибке.
                        */

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

            /*
            ==========================================
            ОШИБКА POLLING
            ==========================================
            */

            console.error(
                "Ошибка Telegram bot:",
                error
            );


            /*
            Небольшая пауза перед
            повторной попыткой.
            */

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


        /*
        Запускаем Telegram-бота
        после запуска Express.
        */

        startBot();
    }
);
