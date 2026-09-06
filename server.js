const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());

// ===============================
// CORS
// ===============================
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// ===============================
// ENV
// ===============================
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID || "";

// ===============================
// ТОВАРЫ
// ===============================
const PRODUCTS = [
  {
    id: "full6_mk",
    name: "Набор Фулл 6 + МК вк на обвесах",
    price: 0,
    escort: false
  },
  {
    id: "full6",
    name: "Набор фулл 6",
    price: 0,
    escort: false
  },
  {
    id: "mk_weapon",
    name: "Оружие МК вк",
    price: 0,
    escort: false
  },
  {
    id: "escort_7",
    name: "Сопровождение 7кк + вещи",
    price: 0,
    escort: true
  },
  {
    id: "escort_15",
    name: "Сопровождение 15кк + вещи",
    price: 0,
    escort: true
  },
  {
    id: "escort_20",
    name: "Сопровождение 20кк + вещи",
    price: 0,
    escort: true
  },
  {
    id: "escort_25",
    name: "Сопровождение 25кк + вещи",
    price: 0,
    escort: true
  }
];

// ===============================
// БАЗЫ В ПАМЯТИ
// ===============================
const users = new Map();
const orders = new Map();
const transactions = new Map();

let orderCounter = 1000;
let transactionCounter = 1;
let telegramOffset = 0;

// ===============================
// TELEGRAM API
// ===============================
async function telegram(method, data = {}) {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN не задан");
  }

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

  const result = await response.json();

  if (!result.ok) {
    throw new Error(
      result.description || "Ошибка Telegram API"
    );
  }

  return result.result;
}

// ===============================
// ПРОВЕРКА TELEGRAM INIT DATA
// ===============================
function validateTelegramInitData(initData) {
  if (!BOT_TOKEN) {
    return {
      ok: false,
      error: "BOT_TOKEN не настроен"
    };
  }

  if (!initData || typeof initData !== "string") {
    return {
      ok: false,
      error: "Нет Telegram initData"
    };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    return {
      ok: false,
      error: "В initData нет hash"
    };
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

  const valid = crypto.timingSafeEqual(
    Buffer.from(calculatedHash, "hex"),
    Buffer.from(hash, "hex")
  );

  if (!valid) {
    return {
      ok: false,
      error: "Неверная подпись Telegram"
    };
  }

  let user = null;

  try {
    user = JSON.parse(
      params.get("user") || "null"
    );
  } catch (_) {}

  if (!user || !user.id) {
    return {
      ok: false,
      error: "Не найден пользователь Telegram"
    };
  }

  return {
    ok: true,
    user
  };
}

// ===============================
// ПОЛЬЗОВАТЕЛЬ
// ===============================
function getOrCreateUser(tgUser) {
  const id = String(tgUser.id);

  if (!users.has(id)) {
    users.set(id, {
      id,
      username: tgUser.username || "",
      firstName: tgUser.first_name || "",
      lastName: tgUser.last_name || "",
      balance: 0,
      createdAt: new Date().toISOString()
    });
  }

  const user = users.get(id);

  user.username =
    tgUser.username || user.username;

  user.firstName =
    tgUser.first_name || user.firstName;

  user.lastName =
    tgUser.last_name || user.lastName;

  return user;
}

// ===============================
// ТРАНЗАКЦИЯ
// ===============================
function addTransaction(
  userId,
  type,
  amount,
  description
) {
  const id = String(transactionCounter++);

  const transaction = {
    id,
    userId: String(userId),
    type,
    amount,
    description,
    createdAt: new Date().toISOString()
  };

  transactions.set(id, transaction);

  return transaction;
}

// ===============================
// АВТОРИЗАЦИЯ
// ===============================
function authFromBody(req) {
  const result = validateTelegramInitData(
    req.body?.initData
  );

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    user: getOrCreateUser(result.user)
  };
}

// ===============================
// ГЛАВНАЯ
// ===============================
app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

// ===============================
// HEALTH
// ===============================
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "СК МЕТРОШОП",
    currency: "POINT",
    currencyShort: "PT"
  });
});

// ===============================
// ТОВАРЫ
// ===============================
app.get("/api/products", (req, res) => {
  res.json({
    ok: true,
    products: PRODUCTS
  });
});

// ===============================
// ПРОФИЛЬ
// ===============================
app.post("/api/profile", (req, res) => {
  const auth = authFromBody(req);

  if (!auth.ok) {
    return res.status(401).json(auth);
  }

  const user = auth.user;

  res.json({
    ok: true,
    profile: {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      balance: user.balance
    }
  });
});

// ===============================
// ИСТОРИЯ
// ===============================
app.post("/api/history", (req, res) => {
  const auth = authFromBody(req);

  if (!auth.ok) {
    return res.status(401).json(auth);
  }

  const list = [...transactions.values()]
    .filter(
      transaction =>
        transaction.userId === auth.user.id
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt) -
        new Date(a.createdAt)
    );

  res.json({
    ok: true,
    history: list
  });
});

// ===============================
// ПОКУПКА
// ===============================
app.post("/api/buy", async (req, res) => {
  const auth = authFromBody(req);

  if (!auth.ok) {
    return res.status(401).json(auth);
  }

  const {
    productId,
    playerId
  } = req.body || {};

  const product = PRODUCTS.find(
    p => p.id === productId
  );

  if (!product) {
    return res.status(404).json({
      ok: false,
      error: "Товар не найден"
    });
  }

  if (!product.price || product.price <= 0) {
    return res.status(400).json({
      ok: false,
      error:
        "Цена этого товара ещё не установлена"
    });
  }

  if (
    auth.user.balance <
    product.price
  ) {
    return res.status(400).json({
      ok: false,
      error: "Недостаточно POINT"
    });
  }

  const orderId = String(++orderCounter);

  const order = {
    id: orderId,
    userId: auth.user.id,
    productId: product.id,
    productName: product.name,
    price: product.price,
    playerId: playerId || "",
    status: "pending",
    createdAt: new Date().toISOString()
  };

  auth.user.balance -= product.price;

  orders.set(orderId, order);

  addTransaction(
    auth.user.id,
    "purchase",
    -product.price,
    `Покупка: ${product.name}`
  );

  try {
    if (STAFF_CHAT_ID) {
      await telegram("sendMessage", {
        chat_id: STAFF_CHAT_ID,

        text:
          `🛒 НОВЫЙ ЗАКАЗ #${order.id}\n\n` +
          `Товар: ${order.productName}\n` +
          `Цена: ${order.price} POINT\n` +
          `Игровой ID: ${
            order.playerId || "не указан"
          }\n` +
          `Telegram ID: ${order.userId}\n` +
          `Статус: ожидает обработки`,

        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "✅ Принять",
                callback_data:
                  `claim:${order.id}`
              },
              {
                text: "❌ Отменить",
                callback_data:
                  `complete:${order.id}`
              }
            ]
          ]
        }
      });
    }
  } catch (error) {
    console.error(
      "Ошибка отправки заказа:",
      error.message
    );

    auth.user.balance += product.price;

    orders.delete(orderId);

    addTransaction(
      auth.user.id,
      "refund",
      product.price,
      `Возврат: ${product.name}`
    );

    return res.status(500).json({
      ok: false,
      error:
        "Не удалось отправить заказ сотрудникам"
    });
  }

  res.json({
    ok: true,
    order
  });
});

// ===============================
// СОЗДАНИЕ ПОПОЛНЕНИЯ
// ===============================
app.post(
  "/api/topup/create",
  (req, res) => {
    const auth = authFromBody(req);

    if (!auth.ok) {
      return res.status(401).json(auth);
    }

    const amount = Number(
      req.body?.amount
    );

    if (
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error: "Неверная сумма"
      });
    }

    res.json({
      ok: true,
      paymentUrl: null,
      amount,

      message:
        "СБП пока не подключён. Для работы реального пополнения нужно подключить платёжного провайдера."
    });
  }
);

// ===============================
// WEBHOOK ПЛАТЕЖА
// ===============================
app.post(
  "/api/payment/webhook",
  (req, res) => {
    const {
      userId,
      amount,
      status
    } = req.body || {};

    const user = users.get(
      String(userId)
    );

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "Пользователь не найден"
      });
    }

    if (status !== "success") {
      return res.json({
        ok: true,
        ignored: true
      });
    }

    const value = Number(amount);

    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      return res.status(400).json({
        ok: false,
        error: "Неверная сумма"
      });
    }

    user.balance += value;

    addTransaction(
      user.id,
      "topup",
      value,
      "Пополнение через СБП"
    );

    res.json({
      ok: true,
      balance: user.balance
    });
  }
);

// ===============================
// ПРИНЯТЬ ЗАКАЗ
// ===============================
async function handleClaim(
  callbackQuery,
  orderId
) {
  const order = orders.get(
    String(orderId)
  );

  if (!order) {
    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text: "Заказ не найден",
        show_alert: true
      }
    );

    return;
  }

  if (order.status !== "pending") {
    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          `Заказ уже имеет статус: ${order.status}`,

        show_alert: true
      }
    );

    return;
  }

  order.status = "accepted";

  order.staffId =
    String(callbackQuery.from.id);

  order.staffUsername =
    callbackQuery.from.username ||
    callbackQuery.from.first_name ||
    "сотрудник";

  await telegram(
    "answerCallbackQuery",
    {
      callback_query_id:
        callbackQuery.id,

      text: "Заказ принят"
    }
  );

  await telegram(
    "editMessageReplyMarkup",
    {
      chat_id:
        callbackQuery.message.chat.id,

      message_id:
        callbackQuery.message.message_id,

      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "🟢 Принят",
              callback_data: "noop"
            }
          ]
        ]
      }
    }
  );

  try {
    await telegram(
      "sendMessage",
      {
        chat_id: order.userId,

        text:
          `✅ Ваш заказ #${order.id} принят сотрудником.\n\n` +
          `Товар: ${order.productName}`
      }
    );
  } catch (_) {}
}

// ===============================
// ОТМЕНА ЗАКАЗА
// ===============================
async function handleComplete(
  callbackQuery,
  orderId
) {
  const order = orders.get(
    String(orderId)
  );

  if (!order) {
    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text: "Заказ не найден",

        show_alert: true
      }
    );

    return;
  }

  if (
    order.status === "completed" ||
    order.status === "cancelled"
  ) {
    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          `Заказ уже закрыт: ${order.status}`,

        show_alert: true
      }
    );

    return;
  }

  order.status = "cancelled";

  const user = users.get(
    String(order.userId)
  );

  if (user) {
    user.balance += order.price;

    addTransaction(
      user.id,
      "refund",
      order.price,
      `Возврат за заказ #${order.id}`
    );
  }

  await telegram(
    "answerCallbackQuery",
    {
      callback_query_id:
        callbackQuery.id,

      text:
        "Заказ отменён, POINT возвращены"
    }
  );

  await telegram(
    "editMessageReplyMarkup",
    {
      chat_id:
        callbackQuery.message.chat.id,

      message_id:
        callbackQuery.message.message_id,

      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "❌ Отменён",
              callback_data: "noop"
            }
          ]
        ]
      }
    }
  );

  try {
    await telegram(
      "sendMessage",
      {
        chat_id: order.userId,

        text:
          `❌ Заказ #${order.id} отменён.\n\n` +
          `${order.price} POINT возвращены на баланс.`
      }
    );
  } catch (_) {}
}

// ===============================
// CALLBACK TELEGRAM
// ===============================
async function handleCallback(
  callbackQuery
) {
  const data =
    callbackQuery.data || "";

  const [
    action,
    orderId
  ] = data.split(":");

  if (action === "noop") {
    await telegram(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id
      }
    );

    return;
  }

  if (action === "claim") {
    return handleClaim(
      callbackQuery,
      orderId
    );
  }

  if (action === "complete") {
    return handleComplete(
      callbackQuery,
      orderId
    );
  }

  await telegram(
    "answerCallbackQuery",
    {
      callback_query_id:
        callbackQuery.id
    }
  );
}

// ===============================
// TELEGRAM POLLING
// ===============================
async function pollTelegram() {
  if (!BOT_TOKEN) {
    return;
  }

  try {
    const updates =
      await telegram(
        "getUpdates",
        {
          offset: telegramOffset,
          timeout: 20,
          allowed_updates: [
            "callback_query"
          ]
        }
      );

    for (const update of updates) {
      telegramOffset =
        update.update_id + 1;

      if (update.callback_query) {
        try {
          await handleCallback(
            update.callback_query
          );
        } catch (error) {
          console.error(
            "Callback error:",
            error.message
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "Telegram polling error:",
      error.message
    );
  }

  setTimeout(
    pollTelegram,
    1000
  );
}

// ===============================
// ЗАПУСК
// ===============================
app.listen(
  PORT,
  "0.0.0.0",
  async () => {
    console.log(
      `СК МЕТРОШОП запущен на порту ${PORT}`
    );

    if (BOT_TOKEN) {
      try {
        await telegram(
          "deleteWebhook",
          {
            drop_pending_updates: false
          }
        );

        console.log(
          "Telegram webhook удалён, polling запущен"
        );

        pollTelegram();
      } catch (error) {
        console.error(
          "Не удалось запустить Telegram polling:",
          error.message
        );
      }
    } else {
      console.log(
        "BOT_TOKEN не задан — Telegram polling отключён"
      );
    }
  }
);
