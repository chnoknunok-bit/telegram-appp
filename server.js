const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID || "";

// Данные для ручной оплаты хранятся в Render Environment,
// а не внутри index.html и не в GitHub.
const PAYMENT_CARD = process.env.PAYMENT_CARD || "";
const PAYMENT_RECIPIENT = process.env.PAYMENT_RECIPIENT || "";
const PT_RUB_RATE = Number(process.env.PT_RUB_RATE || 1);

// =========================
// ВРЕМЕННОЕ ХРАНИЛИЩЕ
// =========================

const users = new Map();
const orders = new Map();
const transactions = new Map();

// Заявки на пополнение
const topups = new Map();

// =========================
// ТОВАРЫ
// =========================

const PRODUCTS = [
  {
    id: "set_full6_mk",
    name: "Набор Фулл 6 + МК вк на обвесах",
    category: "Наборы",
    price: 25,
    available: true,
    quantityEnabled: true,
    maxQuantity: 10
  },
  {
    id: "set_full6",
    name: "Набор фулл 6",
    category: "Наборы",
    price: 18,
    available: true,
    quantityEnabled: true,
    maxQuantity: 10
  },
  {
    id: "weapon_mk",
    name: "Оружие МК вк",
    category: "Оружие",
    price: 0,
    available: false,
    quantityEnabled: false,
    maxQuantity: 1
  },
  {
    id: "escort_7",
    name: "Сопровождение 7кк + вещи",
    category: "Сопровождение",
    price: 0,
    available: false,
    quantityEnabled: false,
    maxQuantity: 1
  },
  {
    id: "escort_15",
    name: "Сопровождение 15кк + вещи",
    category: "Сопровождение",
    price: 0,
    available: false,
    quantityEnabled: false,
    maxQuantity: 1
  },
  {
    id: "escort_20",
    name: "Сопровождение 20кк + вещи",
    category: "Сопровождение",
    price: 0,
    available: false,
    quantityEnabled: false,
    maxQuantity: 1
  },
  {
    id: "escort_25",
    name: "Сопровождение 25кк + вещи",
    category: "Сопровождение",
    price: 0,
    available: false,
    quantityEnabled: false,
    maxQuantity: 1
  }
];

// =========================
// ПРОМОКОДЫ
// =========================

const PROMOCODES = {
  WELCOME: {
    type: "percent",
    percent: 25,
    bonus: 0,
    maxUses: 15,
    uses: 0,
    active: true
  },

  CHEEZ: {
    type: "bonus",
    percent: 0,
    bonus: 750,
    maxUses: 1,
    uses: 0,
    active: true
  },

  KAVASEX67: {
    type: "bonus",
    percent: 0,
    bonus: 500,
    maxUses: 1,
    uses: 0,
    active: true
  }
};

// =========================
// УТИЛИТЫ
// =========================

function normalizePromoCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

function now() {
  return new Date().toISOString();
}

function randomId(prefix = "") {
  return prefix + crypto.randomBytes(8).toString("hex");
}

// =========================
// TELEGRAM WEB APP AUTH
// =========================

function checkTelegramData(initData) {
  if (!initData || typeof initData !== "string") {
    throw new Error("Не переданы данные Telegram");
  }

  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN не настроен");
  }

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) {
    throw new Error("Не найден hash Telegram");
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

  const received = Buffer.from(hash, "hex");
  const calculated = Buffer.from(calculatedHash, "hex");

  if (
    received.length !== calculated.length ||
    !crypto.timingSafeEqual(received, calculated)
  ) {
    throw new Error("Недействительные данные Telegram");
  }

  const userRaw = params.get("user");

  if (!userRaw) {
    throw new Error("Не найден пользователь Telegram");
  }

  let tgUser;

  try {
    tgUser = JSON.parse(userRaw);
  } catch {
    throw new Error("Ошибка чтения пользователя Telegram");
  }

  if (!tgUser || !tgUser.id) {
    throw new Error("Некорректный Telegram ID");
  }

  return tgUser;
}

// =========================
// ПОЛЬЗОВАТЕЛИ
// =========================

function getOrCreateUser(tgUser) {
  const telegramId = String(tgUser.id);

  let user = users.get(telegramId);

  if (!user) {
    user = {
      telegramId,
      firstName: tgUser.first_name || "",
      lastName: tgUser.last_name || "",
      username: tgUser.username || "",
      balance: 0,
      promoUses: {},
      createdAt: now()
    };

    users.set(telegramId, user);
  } else {
    user.firstName = tgUser.first_name || user.firstName || "";
    user.lastName = tgUser.last_name || user.lastName || "";
    user.username = tgUser.username || user.username || "";
  }

  return user;
}

// =========================
// АВТОРИЗАЦИЯ ЗАПРОСА
// =========================

function requireTelegramUser(req) {
  const initData =
    req.body?.initData ||
    req.headers["x-telegram-init-data"];

  const tgUser = checkTelegramData(initData);
  const user = getOrCreateUser(tgUser);

  return {
    tgUser,
    user
  };
}

// =========================
// ТРАНЗАКЦИИ
// =========================

function addTransaction({
  telegramId,
  type,
  amount,
  description,
  orderId = null,
  topupId = null
}) {
  const id = randomId("tx_");

  const transaction = {
    id,
    telegramId: String(telegramId),
    type,
    amount: Number(amount) || 0,
    description: description || "",
    orderId,
    topupId,
    createdAt: now()
  };

  transactions.set(id, transaction);

  return transaction;
}

// =========================
// ПРОМО ПРОЦЕНТОВ
// =========================

function calculatePercentPromo(user, code) {
  const promoCode = normalizePromoCode(code);

  if (!promoCode) {
    return {
      ok: true,
      code: null,
      percent: 0,
      bonus: 0
    };
  }

  const promo = PROMOCODES[promoCode];

  if (!promo) {
    return {
      ok: false,
      message: "Промокод не найден"
    };
  }

  if (!promo.active) {
    return {
      ok: false,
      message: "Промокод больше недействителен"
    };
  }

  if (promo.type !== "percent") {
    return {
      ok: false,
      message: "Этот промокод нельзя использовать для пополнения"
    };
  }

  const userUses = Number(user.promoUses?.[promoCode] || 0);

  if (userUses >= 1) {
    return {
      ok: false,
      message: "Вы уже использовали этот промокод"
    };
  }

  if (promo.uses >= promo.maxUses) {
    return {
      ok: false,
      message: "Лимит использований промокода исчерпан"
    };
  }

  return {
    ok: true,
    code: promoCode,
    percent: promo.percent,
    bonus: 0
  };
}

// =========================
// PT ПРОМО
// =========================

function calculateBonusPromo(user, code) {
  const promoCode = normalizePromoCode(code);

  if (!promoCode) {
    return {
      ok: false,
      message: "Введите промокод"
    };
  }

  const promo = PROMOCODES[promoCode];

  if (!promo) {
    return {
      ok: false,
      message: "Промокод не найден"
    };
  }

  if (!promo.active) {
    return {
      ok: false,
      message: "Промокод больше недействителен"
    };
  }

  if (promo.type !== "bonus") {
    return {
      ok: false,
      message: "Этот промокод предназначен для пополнения"
    };
  }

  const userUses = Number(user.promoUses?.[promoCode] || 0);

  if (userUses >= 1) {
    return {
      ok: false,
      message: "Вы уже использовали этот промокод"
    };
  }

  if (promo.uses >= promo.maxUses) {
    return {
      ok: false,
      message: "Лимит использований промокода исчерпан"
    };
  }

  return {
    ok: true,
    code: promoCode,
    percent: 0,
    bonus: promo.bonus
  };
}

// =========================
// АКТИВАЦИЯ ПРОМО
// =========================

function activatePromoCode(user, code) {
  const promoCode = normalizePromoCode(code);
  const promo = PROMOCODES[promoCode];

  if (!promo) {
    throw new Error("Промокод не найден");
  }

  if (!promo.active) {
    throw new Error("Промокод неактивен");
  }

  const userUses = Number(user.promoUses?.[promoCode] || 0);

  if (userUses >= 1) {
    throw new Error("Пользователь уже использовал этот промокод");
  }

  if (promo.uses >= promo.maxUses) {
    throw new Error("Лимит промокода исчерпан");
  }

  promo.uses += 1;

  if (!user.promoUses) {
    user.promoUses = {};
  }

  user.promoUses[promoCode] = userUses + 1;

  return promo;
}

// =========================
// ПЛАТЁЖНЫЕ ДАННЫЕ
// =========================

function getPaymentDetails() {
  return {
    card: PAYMENT_CARD,
    recipient: PAYMENT_RECIPIENT,
    rate: PT_RUB_RATE
  };
}

// =========================
// TELEGRAM API
// =========================

async function telegramRequest(method, body = {}) {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN не настроен");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description || `Telegram API error: ${method}`
    );
  }

  return data.result;
}

// =========================
// ОТПРАВКА ЗАЯВКИ НА ПОПОЛНЕНИЕ
// =========================

async function sendTopupToStaff(topup) {
  if (!STAFF_CHAT_ID) {
    throw new Error("STAFF_CHAT_ID не настроен");
  }

  const username = topup.user.username
    ? `@${topup.user.username}`
    : "без username";

  const text = [
    "💎 НОВАЯ ЗАЯВКА НА ПОПОЛНЕНИЕ",
    "",
    `💰 Оплата: ${topup.paymentRub} ₽`,
    `💎 Зачисление: ${topup.totalPoints} PT`,
    `🎁 Бонус: ${topup.bonusPoints} PT`,
    `🎟️ Промокод: ${topup.promoPercent || "нет"}`,
    "",
    `👤 ${topup.user.firstName || ""} ${topup.user.lastName || ""}`.trim(),
    `🔗 ${username}`,
    `🆔 Telegram ID: ${topup.telegramId}`,
    "",
    `🧾 Заявка: ${topup.id}`,
    "",
    "⚠️ Проверьте перевод вручную перед зачислением."
  ].join("\n");

  return telegramRequest("sendMessage", {
    chat_id: STAFF_CHAT_ID,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ ЗАЧИСЛИТЬ PT",
            callback_data: `topup_confirm:${topup.id}`
          }
        ],
        [
          {
            text: "❌ ОТКЛОНИТЬ",
            callback_data: `topup_reject:${topup.id}`
          }
        ]
      ]
    }
  });
}// =========================
// API: ГЛАВНАЯ
// =========================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "СК МЕТРОШОП API",
    time: now()
  });
});

// =========================
// API: ТОВАРЫ
// =========================

app.get("/api/products", (req, res) => {
  res.json({
    ok: true,
    products: PRODUCTS
  });
});

// =========================
// API: ПРОФИЛЬ
// =========================

app.post("/api/profile", (req, res) => {
  try {
    const { tgUser, user } = requireTelegramUser(req);

    res.json({
      ok: true,
      profile: {
        telegramId: tgUser.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        balance: user.balance
      }
    });
  } catch (error) {
    res.status(401).json({
      ok: false,
      message: error.message || "Ошибка авторизации"
    });
  }
});

// =========================
// API: ИСТОРИЯ
// =========================

app.post("/api/history", (req, res) => {
  try {
    const { user } = requireTelegramUser(req);

    const userTransactions = [...transactions.values()]
      .filter((tx) => tx.telegramId === user.telegramId)
      .sort((a, b) => {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

    res.json({
      ok: true,
      transactions: userTransactions
    });
  } catch (error) {
    res.status(401).json({
      ok: false,
      message: error.message || "Ошибка авторизации"
    });
  }
});

// =========================
// ПРОМО: ПРОВЕРКА ПРОЦЕНТА
// =========================

app.post("/api/promo/check-percent", (req, res) => {
  try {
    const { user } = requireTelegramUser(req);

    const code = normalizePromoCode(req.body?.code);
    const result = calculatePercentPromo(user, code);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json({
      ok: true,
      code: result.code,
      type: "percent",
      percent: result.percent
    });
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: error.message || "Ошибка проверки промокода"
    });
  }
});

// =========================
// ПРОМО: ПРОВЕРКА PT
// =========================

app.post("/api/promo/check-bonus", (req, res) => {
  try {
    const { user } = requireTelegramUser(req);

    const code = normalizePromoCode(req.body?.code);
    const result = calculateBonusPromo(user, code);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    return res.json({
      ok: true,
      code: result.code,
      type: "bonus",
      bonus: result.bonus
    });
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: error.message || "Ошибка проверки промокода"
    });
  }
});

// =========================
// СТАРЫЙ СОВМЕСТИМЫЙ PROMO CHECK
// =========================

app.post("/api/promo/check", (req, res) => {
  try {
    const { user } = requireTelegramUser(req);

    const code = normalizePromoCode(req.body?.code);

    const percentResult = calculatePercentPromo(user, code);

    if (percentResult.ok) {
      return res.json({
        ok: true,
        code: percentResult.code,
        type: "percent",
        percent: percentResult.percent,
        bonus: 0
      });
    }

    const bonusResult = calculateBonusPromo(user, code);

    if (bonusResult.ok) {
      return res.json({
        ok: true,
        code: bonusResult.code,
        type: "bonus",
        percent: 0,
        bonus: bonusResult.bonus
      });
    }

    return res.status(400).json({
      ok: false,
      message: "Промокод не найден или недействителен"
    });
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: error.message || "Ошибка проверки промокода"
    });
  }
});

// =========================
// АКТИВАЦИЯ PT-ПРОМОКОДА
// =========================

app.post("/api/promo/activate", (req, res) => {
  try {
    const { user } = requireTelegramUser(req);

    const code = normalizePromoCode(req.body?.code);

    const result = calculateBonusPromo(user, code);

    if (!result.ok) {
      return res.status(400).json(result);
    }

    if (result.bonus <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Этот промокод не даёт PT"
      });
    }

    const promo = activatePromoCode(user, code);

    user.balance += promo.bonus;

    addTransaction({
      telegramId: user.telegramId,
      type: "promo_bonus",
      amount: promo.bonus,
      description: `Активация PT-промокода ${code}`
    });

    return res.json({
      ok: true,
      code,
      bonus: promo.bonus,
      balance: user.balance,
      message: `Начислено +${promo.bonus} PT`
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error.message || "Не удалось активировать промокод"
    });
  }
});

// =========================
// ПОКУПКА ТОВАРА
// =========================

app.post("/api/buy", async (req, res) => {
  let createdOrder = null;

  try {
    const { tgUser, user } = requireTelegramUser(req);

    const productId = String(req.body?.productId || "");
    const gameId = String(req.body?.gameId || "").trim();

    let quantity = Number(req.body?.quantity || 1);

    if (!Number.isInteger(quantity)) {
      return res.status(400).json({
        ok: false,
        message: "Количество должно быть целым числом"
      });
    }

    const product = PRODUCTS.find((item) => item.id === productId);

    if (!product) {
      return res.status(404).json({
        ok: false,
        message: "Товар не найден"
      });
    }

    if (!product.available) {
      return res.status(400).json({
        ok: false,
        message: "Этот товар пока недоступен"
      });
    }

    if (!gameId) {
      return res.status(400).json({
        ok: false,
        message: "Введите Game ID"
      });
    }

    if (product.quantityEnabled) {
      if (quantity < 1 || quantity > product.maxQuantity) {
        return res.status(400).json({
          ok: false,
          message: `Можно купить от 1 до ${product.maxQuantity} шт.`
        });
      }
    } else {
      quantity = 1;
    }

    const total = product.price * quantity;

    if (total <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Цена товара некорректна"
      });
    }

    if (user.balance < total) {
      return res.status(400).json({
        ok: false,
        message: "Недостаточно PT",
        balance: user.balance,
        required: total
      });
    }

    const orderId = randomId("order_");

    createdOrder = {
      id: orderId,
      type: "shop_order",
      status: "waiting",
      telegramId: user.telegramId,

      user: {
        telegramId: tgUser.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username
      },

      productId: product.id,
      productName: product.name,
      quantity,
      unitPrice: product.price,
      total,
      gameId,

      createdAt: now(),

      claimedBy: null,
      completedAt: null
    };

    user.balance -= total;

    orders.set(orderId, createdOrder);

    addTransaction({
      telegramId: user.telegramId,
      type: "purchase",
      amount: -total,
      description: `Покупка: ${product.name} × ${quantity}`,
      orderId
    });

    try {
      await sendOrderToStaff(createdOrder);
    } catch (telegramError) {
      user.balance += total;

      orders.delete(orderId);

      addTransaction({
        telegramId: user.telegramId,
        type: "refund",
        amount: total,
        description: `Возврат за заказ ${orderId}: ошибка отправки`
      });

      return res.status(500).json({
        ok: false,
        message: "Не удалось отправить заказ сотрудникам. PT возвращены.",
        balance: user.balance
      });
    }

    return res.json({
      ok: true,
      message: "Заказ создан",
      orderId,
      balance: user.balance,
      order: {
        id: createdOrder.id,
        productName: createdOrder.productName,
        quantity: createdOrder.quantity,
        total: createdOrder.total,
        status: createdOrder.status
      }
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error.message || "Не удалось оформить заказ"
    });
  }
});

// =========================
// ПОПОЛНЕНИЕ: СОЗДАНИЕ ЗАЯВКИ
// =========================

app.post("/api/topup/create", (req, res) => {
  try {
    const { tgUser, user } = requireTelegramUser(req);

    const amount = Number(req.body?.amount || 0);

    if (!Number.isInteger(amount)) {
      return res.status(400).json({
        ok: false,
        message: "Количество PT должно быть целым числом"
      });
    }

    if (amount < 1 || amount > 1000000) {
      return res.status(400).json({
        ok: false,
        message: "Сумма пополнения должна быть от 1 до 1 000 000 PT"
      });
    }

    const promoPercentCode = normalizePromoCode(
      req.body?.promoPercent
    );

    let percent = 0;

    if (promoPercentCode) {
      const promoResult = calculatePercentPromo(
        user,
        promoPercentCode
      );

      if (!promoResult.ok) {
        return res.status(400).json({
          ok: false,
          message: promoResult.message
        });
      }

      percent = promoResult.percent;
    }

    const bonusPoints = Math.floor(
      amount * (percent / 100)
    );

    const totalPoints = amount + bonusPoints;

    const paymentRub = Math.ceil(
      amount * PT_RUB_RATE
    );

    if (!Number.isFinite(paymentRub) || paymentRub <= 0) {
      return res.status(500).json({
        ok: false,
        message: "Некорректный курс PT/₽"
      });
    }

    if (!PAYMENT_CARD || !PAYMENT_RECIPIENT) {
      return res.status(500).json({
        ok: false,
        message: "Реквизиты оплаты ещё не настроены на сервере"
      });
    }

    const paymentId = randomId("topup_");

    const topup = {
      id: paymentId,

      telegramId: user.telegramId,

      user: {
        telegramId: tgUser.id,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username
      },

      amountPT: amount,
      bonusPoints,
      totalPoints,

      promoPercent: promoPercentCode || null,
      percent,

      paymentRub,

      status: "waiting_payment",

      createdAt: now(),
      paidAt: null,
      confirmedAt: null,
      rejectedAt: null
    };

    topups.set(paymentId, topup);

    return res.json({
      ok: true,
      paymentId,

      amountPT: amount,
      bonusPoints,
      totalPoints,
      paymentRub,

      promoPercent: promoPercentCode || null,

      payment: {
        card: PAYMENT_CARD,
        recipient: PAYMENT_RECIPIENT
      },

      status: topup.status,

      message:
        "Заявка создана. Выполните перевод и нажмите «Я оплатил»."
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error.message || "Не удалось создать заявку"
    });
  }
});

// =========================
// ПОПОЛНЕНИЕ: ПОЛЬЗОВАТЕЛЬ НАЖАЛ «Я ОПЛАТИЛ»
// =========================

app.post("/api/topup/mark-paid", async (req, res) => {
  try {
    const { user } = requireTelegramUser(req);

    const paymentId = String(
      req.body?.paymentId || ""
    ).trim();

    if (!paymentId) {
      return res.status(400).json({
        ok: false,
        message: "Не указан ID заявки"
      });
    }

    const topup = topups.get(paymentId);

    if (!topup) {
      return res.status(404).json({
        ok: false,
        message: "Заявка не найдена"
      });
    }

    if (String(topup.telegramId) !== String(user.telegramId)) {
      return res.status(403).json({
        ok: false,
        message: "Это не ваша заявка"
      });
    }

    if (topup.status === "paid_waiting_confirmation") {
      return res.json({
        ok: true,
        status: topup.status,
        message: "Заявка уже отправлена на проверку"
      });
    }

    if (topup.status !== "waiting_payment") {
      return res.status(400).json({
        ok: false,
        message: "Эта заявка больше не может быть оплачена"
      });
    }

    topup.status = "paid_waiting_confirmation";
    topup.paidAt = now();

    try {
      await sendTopupToStaff(topup);
    } catch (telegramError) {
      topup.status = "waiting_payment";
      topup.paidAt = null;

      return res.status(500).json({
        ok: false,
        message:
          "Не удалось отправить заявку сотрудникам. Попробуйте ещё раз."
      });
    }

    return res.json({
      ok: true,
      paymentId: topup.id,
      status: topup.status,
      message:
        "Заявка отправлена на проверку. PT будут начислены после подтверждения оплаты."
    });
  } catch (error) {
    return res.status(400).json({
      ok: false,
      message: error.message || "Не удалось отметить оплату"
    });
  }
});

// =========================
// WEBHOOK ОПЛАТЫ
// =========================

app.post("/api/payment/webhook", (req, res) => {
  res.status(501).json({
    ok: false,
    message: "Автоматический webhook оплаты пока не используется"
  });
});

// =========================
// ПОЛУЧЕНИЕ СТАТУСА ЗАЯВКИ
// =========================

app.post("/api/topup/status", (req, res) => {
  try {
    const { user } = requireTelegramUser(req);

    const paymentId = String(
      req.body?.paymentId || ""
    ).trim();

    const topup = topups.get(paymentId);

    if (!topup) {
      return res.status(404).json({
        ok: false,
        message: "Заявка не найдена"
      });
    }

    if (String(topup.telegramId) !== String(user.telegramId)) {
      return res.status(403).json({
        ok: false,
        message: "Нет доступа к этой заявке"
      });
    }

    res.json({
      ok: true,
      paymentId: topup.id,
      status: topup.status,
      amountPT: topup.amountPT,
      bonusPoints: topup.bonusPoints,
      totalPoints: topup.totalPoints,
      paymentRub: topup.paymentRub,
      createdAt: topup.createdAt,
      paidAt: topup.paidAt,
      confirmedAt: topup.confirmedAt
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error.message || "Ошибка получения статуса"
    });
  }
});// =========================
// ОТПРАВКА ЗАКАЗА СОТРУДНИКАМ
// =========================

async function sendOrderToStaff(order) {
  if (!STAFF_CHAT_ID) {
    throw new Error("STAFF_CHAT_ID не настроен");
  }

  const username = order.user.username
    ? `@${order.user.username}`
    : "без username";

  const text = [
    "🛒 НОВЫЙ ЗАКАЗ",
    "",
    `📦 Товар: ${order.productName}`,
    `🔢 Количество: ${order.quantity}`,
    `💎 Сумма: ${order.total} PT`,
    `🎮 Game ID: ${order.gameId}`,
    "",
    `👤 ${order.user.firstName || ""} ${order.user.lastName || ""}`.trim(),
    `🔗 ${username}`,
    `🆔 Telegram ID: ${order.telegramId}`,
    "",
    `🧾 Заказ: ${order.id}`
  ].join("\n");

  return telegramRequest("sendMessage", {
    chat_id: STAFF_CHAT_ID,
    text,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ ВЗЯТЬ ЗАКАЗ",
            callback_data: `claim:${order.id}`
          }
        ]
      ]
    }
  });
}

// =========================
// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ
// =========================

function isStaffMessage(callbackQuery) {
  if (!STAFF_CHAT_ID) {
    return false;
  }

  return (
    callbackQuery &&
    callbackQuery.message &&
    String(callbackQuery.message.chat.id) === String(STAFF_CHAT_ID)
  );
}

// =========================
// ЗАБРАТЬ ЗАКАЗ
// =========================

async function handleClaim(callbackQuery, orderId) {
  if (!isStaffMessage(callbackQuery)) {
    throw new Error("Недоступно вне рабочего чата");
  }

  const order = orders.get(orderId);

  if (!order) {
    throw new Error("Заказ не найден");
  }

  if (order.status !== "waiting") {
    throw new Error("Этот заказ уже взят или завершён");
  }

  const staff = callbackQuery.from;

  const staffName = [
    staff.first_name || "",
    staff.last_name || ""
  ]
    .join(" ")
    .trim() || "Сотрудник";

  order.status = "claimed";

  order.claimedBy = {
    telegramId: String(staff.id),
    firstName: staff.first_name || "",
    lastName: staff.last_name || "",
    username: staff.username || "",
    name: staffName,
    claimedAt: now()
  };

  await telegramRequest("editMessageReplyMarkup", {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `✅ ВЗЯТО: ${staffName}`.slice(0, 64),
            callback_data: `complete:${order.id}`
          }
        ]
      ]
    }
  });
}

// =========================
// ЗАВЕРШИТЬ ЗАКАЗ
// =========================

async function handleComplete(callbackQuery, orderId) {
  if (!isStaffMessage(callbackQuery)) {
    throw new Error("Недоступно вне рабочего чата");
  }

  const order = orders.get(orderId);

  if (!order) {
    throw new Error("Заказ не найден");
  }

  if (order.status !== "claimed") {
    throw new Error("Заказ нельзя завершить в текущем статусе");
  }

  const staffId = String(callbackQuery.from.id);

  if (
    !order.claimedBy ||
    String(order.claimedBy.telegramId) !== staffId
  ) {
    throw new Error(
      "Завершить заказ может только сотрудник, который его взял"
    );
  }

  order.status = "completed";
  order.completedAt = now();

  await telegramRequest("editMessageReplyMarkup", {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "✅ ЗАКАЗ ЗАВЕРШЁН",
            callback_data: "noop"
          }
        ]
      ]
    }
  });

  try {
    await telegramRequest("sendMessage", {
      chat_id: order.telegramId,
      text:
        `✅ Заказ ${order.id} завершён.\n\n` +
        `📦 ${order.productName}\n` +
        `🔢 Количество: ${order.quantity}\n` +
        `💎 Списано: ${order.total} PT`
    });
  } catch (error) {
    console.error(
      "Не удалось уведомить пользователя о завершении заказа:",
      error.message
    );
  }
}

// =========================
// ПОДТВЕРЖДЕНИЕ ПОПОЛНЕНИЯ
// =========================

async function handleTopupConfirm(callbackQuery, paymentId) {
  if (!isStaffMessage(callbackQuery)) {
    throw new Error("Недоступно вне рабочего чата");
  }

  const topup = topups.get(paymentId);

  if (!topup) {
    throw new Error("Заявка на пополнение не найдена");
  }

  // Защита от повторного начисления
  if (topup.status === "completed") {
    throw new Error("PT по этой заявке уже были начислены");
  }

  if (topup.status !== "paid_waiting_confirmation") {
    throw new Error(
      `Нельзя подтвердить заявку в статусе: ${topup.status}`
    );
  }

  const user = users.get(String(topup.telegramId));

  if (!user) {
    throw new Error("Пользователь заявки не найден");
  }

  // Проверяем промокод ещё раз непосредственно перед зачислением.
  // Клиент не может самостоятельно изменить количество бонусных PT.
  if (topup.promoPercent) {
    const promoCheck = calculatePercentPromo(
      user,
      topup.promoPercent
    );

    if (!promoCheck.ok) {
      throw new Error(
        `Промокод ${topup.promoPercent} больше нельзя применить: ${promoCheck.message}`
      );
    }

    const expectedBonus = Math.floor(
      topup.amountPT * (promoCheck.percent / 100)
    );

    if (
      expectedBonus !== topup.bonusPoints ||
      promoCheck.percent !== topup.percent
    ) {
      throw new Error(
        "Данные бонуса заявки не совпадают с текущими условиями промокода"
      );
    }
  }

  // Активируем промокод только после реального подтверждения оплаты.
  if (topup.promoPercent) {
    activatePromoCode(user, topup.promoPercent);
  }

  const oldBalance = user.balance;

  user.balance += topup.totalPoints;

  topup.status = "completed";
  topup.confirmedAt = now();
  topup.confirmedBy = {
    telegramId: String(callbackQuery.from.id),
    firstName: callbackQuery.from.first_name || "",
    lastName: callbackQuery.from.last_name || "",
    username: callbackQuery.from.username || ""
  };

  addTransaction({
    telegramId: user.telegramId,
    type: "topup",
    amount: topup.totalPoints,
    description:
      `Пополнение ${topup.amountPT} PT` +
      (topup.bonusPoints > 0
        ? ` + ${topup.bonusPoints} PT бонус`
        : ""),
    topupId: topup.id
  });

  const staffName = [
    callbackQuery.from.first_name || "",
    callbackQuery.from.last_name || ""
  ]
    .join(" ")
    .trim() || "Сотрудник";

  await telegramRequest("editMessageReplyMarkup", {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `✅ ЗАЧИСЛЕНО: ${topup.totalPoints} PT`.slice(0, 64),
            callback_data: "noop"
          }
        ]
      ]
    }
  });

  try {
    await telegramRequest("sendMessage", {
      chat_id: topup.telegramId,
      text:
        `✅ Пополнение подтверждено!\n\n` +
        `💰 Оплачено: ${topup.paymentRub} ₽\n` +
        `💎 Зачислено: ${topup.totalPoints} PT\n` +
        (topup.bonusPoints > 0
          ? `🎁 Бонус: +${topup.bonusPoints} PT\n`
          : "") +
        `💳 Баланс: ${oldBalance} → ${user.balance} PT\n\n` +
        `🧾 Заявка: ${topup.id}`
    });
  } catch (error) {
    console.error(
      "Не удалось уведомить пользователя о пополнении:",
      error.message
    );
  }

  return {
    ok: true,
    balance: user.balance,
    staffName
  };
}

// =========================
// ОТКЛОНЕНИЕ ПОПОЛНЕНИЯ
// =========================

async function handleTopupReject(callbackQuery, paymentId) {
  if (!isStaffMessage(callbackQuery)) {
    throw new Error("Недоступно вне рабочего чата");
  }

  const topup = topups.get(paymentId);

  if (!topup) {
    throw new Error("Заявка на пополнение не найдена");
  }

  if (topup.status === "rejected") {
    throw new Error("Заявка уже отклонена");
  }

  if (topup.status === "completed") {
    throw new Error(
      "Нельзя отклонить уже подтверждённое пополнение"
    );
  }

  if (topup.status !== "paid_waiting_confirmation") {
    throw new Error(
      `Нельзя отклонить заявку в статусе: ${topup.status}`
    );
  }

  topup.status = "rejected";
  topup.rejectedAt = now();
  topup.rejectedBy = {
    telegramId: String(callbackQuery.from.id),
    firstName: callbackQuery.from.first_name || "",
    lastName: callbackQuery.from.last_name || "",
    username: callbackQuery.from.username || ""
  };

  const staffName = [
    callbackQuery.from.first_name || "",
    callbackQuery.from.last_name || ""
  ]
    .join(" ")
    .trim() || "Сотрудник";

  await telegramRequest("editMessageReplyMarkup", {
    chat_id: callbackQuery.message.chat.id,
    message_id: callbackQuery.message.message_id,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `❌ ОТКЛОНЕНО: ${staffName}`.slice(0, 64),
            callback_data: "noop"
          }
        ]
      ]
    }
  });

  try {
    await telegramRequest("sendMessage", {
      chat_id: topup.telegramId,
      text:
        `❌ Пополнение отклонено.\n\n` +
        `💰 Сумма: ${topup.paymentRub} ₽\n` +
        `💎 PT: ${topup.totalPoints}\n\n` +
        `🧾 Заявка: ${topup.id}\n\n` +
        `Если вы действительно отправили оплату, обратитесь к сотруднику магазина.`
    });
  } catch (error) {
    console.error(
      "Не удалось уведомить пользователя об отклонении:",
      error.message
    );
  }

  return {
    ok: true,
    staffName
  };
}

// =========================
// CALLBACK QUERY
// =========================

async function handleCallback(callbackQuery) {
  const data = String(callbackQuery.data || "");

  try {
    if (data === "noop") {
      await telegramRequest("answerCallbackQuery", {
        callback_query_id: callbackQuery.id
      });

      return;
    }

    if (data.startsWith("claim:")) {
      const orderId = data.slice("claim:".length);

      await handleClaim(
        callbackQuery,
        orderId
      );

      await telegramRequest("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: "Заказ взят"
      });

      return;
    }

    if (data.startsWith("complete:")) {
      const orderId = data.slice("complete:".length);

      await handleComplete(
        callbackQuery,
        orderId
      );

      await telegramRequest("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: "Заказ завершён"
      });

      return;
    }

    if (data.startsWith("topup_confirm:")) {
      const paymentId = data.slice(
        "topup_confirm:".length
      );

      const result = await handleTopupConfirm(
        callbackQuery,
        paymentId
      );

      await telegramRequest("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: `Зачислено ${result.balance} PT на балансе`
      });

      return;
    }

    if (data.startsWith("topup_reject:")) {
      const paymentId = data.slice(
        "topup_reject:".length
      );

      await handleTopupReject(
        callbackQuery,
        paymentId
      );

      await telegramRequest("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: "Пополнение отклонено"
      });

      return;
    }

    await telegramRequest("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
      text: "Неизвестная команда"
    });
  } catch (error) {
    console.error(
      "Ошибка callback:",
      error.message
    );

    try {
      await telegramRequest("answerCallbackQuery", {
        callback_query_id: callbackQuery.id,
        text: error.message || "Ошибка",
        show_alert: true
      });
    } catch (answerError) {
      console.error(
        "Ошибка answerCallbackQuery:",
        answerError.message
      );
    }
  }
}

// =========================
// TELEGRAM LONG POLLING
// =========================

let telegramOffset = 0;
let pollingRunning = false;

async function startTelegramPolling() {
  if (pollingRunning) {
    return;
  }

  if (!BOT_TOKEN) {
    console.log(
      "⚠️ BOT_TOKEN не установлен. Telegram polling отключён."
    );
    return;
  }

  pollingRunning = true;

  try {
    await telegramRequest("deleteWebhook", {
      drop_pending_updates: false
    });

    console.log("✅ Telegram webhook удалён, запускаем polling.");
  } catch (error) {
    console.error(
      "Ошибка удаления webhook:",
      error.message
    );
  }

  while (pollingRunning) {
    try {
      const updates = await telegramRequest(
        "getUpdates",
        {
          offset: telegramOffset,
          timeout: 25,
          allowed_updates: ["callback_query"]
        }
      );

      for (const update of updates) {
        telegramOffset = update.update_id + 1;

        if (update.callback_query) {
          await handleCallback(
            update.callback_query
          );
        }
      }
    } catch (error) {
      console.error(
        "Ошибка Telegram polling:",
        error.message
      );

      await new Promise((resolve) => {
        setTimeout(resolve, 3000);
      });
    }
  }
}

// =========================
// ЗАПУСК
// =========================

app.listen(PORT, () => {
  console.log(
    `✅ СК МЕТРОШОП сервер запущен на порту ${PORT}`
  );

  console.log(
    `💎 PT/₽ курс: ${PT_RUB_RATE}`
  );

  console.log(
    `💳 Реквизиты оплаты: ${
      PAYMENT_CARD ? "настроены" : "НЕ НАСТРОЕНЫ"
    }`
  );

  console.log(
    `👤 Получатель: ${
      PAYMENT_RECIPIENT ? "настроен" : "НЕ НАСТРОЕН"
    }`
  );

  startTelegramPolling();
});
