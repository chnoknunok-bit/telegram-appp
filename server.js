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

            balance: 0
        });
    }

    const saved =
        users.get(user.id);

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
        Проверяем товар и Game ID
        ------------------------------------------
        */

        if (!product || !gameId) {

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


        /*
        ------------------------------------------
        Проверяем цену
        ------------------------------------------
        */

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


        /*
        ------------------------------------------
        КОЛИЧЕСТВО
        ------------------------------------------
        */

        let finalQuantity = 1;

        if (productInfo.quantityEnabled) {

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


        /*
        ------------------------------------------
        ИТОГОВАЯ ЦЕНА
        ------------------------------------------
        */

        const totalPrice =
            productInfo.price *
            finalQuantity;


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
        ПРОВЕРКА БАЛАНСА
        ------------------------------------------
        */

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


        /*
        ------------------------------------------
        СПИСЫВАЕМ POINT
        ------------------------------------------
        */

        user.balance -=
            totalPrice;


        /*
        ------------------------------------------
        СОЗДАЁМ ЗАКАЗ
        ------------------------------------------
        */

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


        /*
        ------------------------------------------
        ЗАПИСЫВАЕМ ОПЕРАЦИЮ
        ------------------------------------------
        */

        addTransaction(

            user.id,

            "purchase",

            -totalPrice,

            `Покупка: ${product} × ${finalQuantity}`
        );


        /*
        ==========================================
                ОТПРАВКА В STAFF CHAT
        ==========================================
        */

        const maxEmployees =
            productInfo.escort
                ? 3
                : 1;


        let text =

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


        /*
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
           ПОПОЛНЕНИЕ POINT
==================================================
*/

app.post(
    "/api/topup/create",
    (req, res) => {

        const {
            initData,
            amount
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


        const rubles =
            Number(amount);


        if (
            !Number.isInteger(
                rubles
            ) ||
            rubles <= 0
        ) {

            return res
                .status(400)
                .json({

                    ok: false,

                    error:
                        "Неверная сумма"
                });
        }


        const paymentId =
            "PT-" +
            Date.now() +
            "-" +
            Math.floor(
                Math.random() *
                10000
            );


        res.json({

            ok: true,

            paymentId,

            amount:
                rubles,

            points:
                rubles,

            paymentUrl:
                null,

            message:
                "СБП пока не подключено. Сначала подключите платёжного провайдера."
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
);
