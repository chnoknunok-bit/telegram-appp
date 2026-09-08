const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const STAFF_CHAT_ID = process.env.STAFF_CHAT_ID || "";
const PAYMENT_CHAT_ID =
  process.env.PAYMENT_CHAT_ID || STAFF_CHAT_ID;

const PAYMENT_CARD = process.env.PAYMENT_CARD || "";
const PAYMENT_RECIPIENT =
  process.env.PAYMENT_RECIPIENT || "";

const PT_RUB_RATE =
  Number(process.env.PT_RUB_RATE || 1);

const DATABASE_URL =
  process.env.DATABASE_URL || "";

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL не настроен");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


// ==========================================
// ТОВАРЫ
// ==========================================

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


// ==========================================
// ПРОМОКОДЫ
// ==========================================

const PROMOCODES = {
  WELCOME: {
    type: "percent",
    percent: 25,
    bonus: 0,
    maxUses: 15,
    active: true
  },

  CHEEZ: {
    type: "bonus",
    percent: 0,
    bonus: 750,
    maxUses: 1,
    active: true
  },

  KAVASEX67: {
    type: "bonus",
    percent: 0,
    bonus: 500,
    maxUses: 1,
    active: true
  }
};


// ==========================================
// УТИЛИТЫ
// ==========================================

function now() {
  return new Date();
}

function normalizePromoCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase();
}

function randomId(prefix = "") {
  return (
    prefix +
    crypto.randomBytes(8).toString("hex")
  );
}


// ==========================================
// СОЗДАНИЕ ТАБЛИЦ
// ==========================================

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      username TEXT DEFAULT '',
      balance INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS promo_uses (
      telegram_id TEXT NOT NULL,
      promo_code TEXT NOT NULL,
      uses INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (telegram_id, promo_code)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS promo_global (
      promo_code TEXT PRIMARY KEY,
      uses INTEGER NOT NULL DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      description TEXT DEFAULT '',
      order_id TEXT,
      topup_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting',

      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      total INTEGER NOT NULL,
      game_id TEXT NOT NULL,

      user_first_name TEXT DEFAULT '',
      user_last_name TEXT DEFAULT '',
      user_username TEXT DEFAULT '',

      claimed_by_id TEXT,
      claimed_by_name TEXT,
      claimed_by_username TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS topups (
      id TEXT PRIMARY KEY,
      telegram_id TEXT NOT NULL,

      amount_pt INTEGER NOT NULL,
      bonus_points INTEGER NOT NULL DEFAULT 0,
      total_points INTEGER NOT NULL,

      promo_percent TEXT,
      percent INTEGER NOT NULL DEFAULT 0,

      payment_rub INTEGER NOT NULL,

      status TEXT NOT NULL DEFAULT 'waiting_payment',

      user_first_name TEXT DEFAULT '',
      user_last_name TEXT DEFAULT '',
      user_username TEXT DEFAULT '',

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      rejected_at TIMESTAMPTZ,

      confirmed_by_id TEXT,
      confirmed_by_name TEXT,
      confirmed_by_username TEXT,

      rejected_by_id TEXT,
      rejected_by_name TEXT,
      rejected_by_username TEXT
    );
  `);

  // Добавляем промокоды в глобальное хранилище,
  // если их там ещё нет.
  for (const code of Object.keys(PROMOCODES)) {
    await pool.query(
      `
        INSERT INTO promo_global (
          promo_code,
          uses
        )
        VALUES ($1, 0)
        ON CONFLICT (promo_code)
        DO NOTHING
      `,
      [code]
    );
  }

  console.log("✅ PostgreSQL таблицы готовы");
}


// ==========================================
// TELEGRAM WEB APP AUTH
// ==========================================

function checkTelegramData(initData) {
  if (!initData || typeof initData !== "string") {
    throw new Error(
      "Не переданы данные Telegram"
    );
  }

  if (!BOT_TOKEN) {
    throw new Error(
      "BOT_TOKEN не настроен"
    );
  }

  const params =
    new URLSearchParams(initData);

  const hash = params.get("hash");

  if (!hash) {
    throw new Error(
      "Не найден hash Telegram"
    );
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

  const received =
    Buffer.from(hash, "hex");

  const calculated =
    Buffer.from(
      calculatedHash,
      "hex"
    );

  if (
    received.length !==
      calculated.length ||
    !crypto.timingSafeEqual(
      received,
      calculated
    )
  ) {
    throw new Error(
      "Недействительные данные Telegram"
    );
  }

  const userRaw =
    params.get("user");

  if (!userRaw) {
    throw new Error(
      "Не найден пользователь Telegram"
    );
  }

  let tgUser;

  try {
    tgUser =
      JSON.parse(userRaw);
  } catch {
    throw new Error(
      "Ошибка чтения пользователя Telegram"
    );
  }

  if (!tgUser || !tgUser.id) {
    throw new Error(
      "Некорректный Telegram ID"
    );
  }

  return tgUser;
}


// ==========================================
// ПОЛЬЗОВАТЕЛЬ ИЛИ СОЗДАНИЕ
// ==========================================

async function getOrCreateUser(tgUser) {
  const telegramId =
    String(tgUser.id);

  const result =
    await pool.query(
      `
        INSERT INTO users (
          telegram_id,
          first_name,
          last_name,
          username
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (telegram_id)
        DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          username = EXCLUDED.username,
          updated_at = NOW()
        RETURNING *
      `,
      [
        telegramId,
        tgUser.first_name || "",
        tgUser.last_name || "",
        tgUser.username || ""
      ]
    );

  return result.rows[0];
}


// ==========================================
// АВТОРИЗАЦИЯ ЗАПРОСА
// ==========================================

async function requireTelegramUser(req) {
  const initData =
    req.body?.initData ||
    req.headers[
      "x-telegram-init-data"
    ];

  const tgUser =
    checkTelegramData(initData);

  const user =
    await getOrCreateUser(
      tgUser
    );

  return {
    tgUser,
    user
  };
}


// ==========================================
// ПОЛУЧИТЬ ИЛИ СОЗДАТЬ ПРОМО ИСПОЛЬЗОВАНИЯ
// ==========================================

async function getPromoUserUses(
  telegramId,
  promoCode
) {
  const result =
    await pool.query(
      `
        SELECT uses
        FROM promo_uses
        WHERE telegram_id = $1
          AND promo_code = $2
      `,
      [
        String(telegramId),
        promoCode
      ]
    );

  if (!result.rows.length) {
    return 0;
  }

  return Number(
    result.rows[0].uses || 0
  );
}


async function getPromoGlobalUses(
  promoCode
) {
  const result =
    await pool.query(
      `
        SELECT uses
        FROM promo_global
        WHERE promo_code = $1
      `,
      [promoCode]
    );

  if (!result.rows.length) {
    return 0;
  }

  return Number(
    result.rows[0].uses || 0
  );
}


// ==========================================
// ТРАНЗАКЦИЯ
// ==========================================

async function addTransaction({
  telegramId,
  type,
  amount,
  description,
  orderId = null,
  topupId = null,
  client = null
}) {
  const id =
    randomId("tx_");

  const executor =
    client || pool;

  await executor.query(
    `
      INSERT INTO transactions (
        id,
        telegram_id,
        type,
        amount,
        description,
        order_id,
        topup_id
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7
      )
    `,
    [
      id,
      String(telegramId),
      type,
      Number(amount) || 0,
      description || "",
      orderId,
      topupId
    ]
  );

  return id;
}


// ==========================================
// ПРОМО ПРОЦЕНТОВ
// ==========================================

async function calculatePercentPromo(
  user,
  code
) {
  const promoCode =
    normalizePromoCode(code);

  if (!promoCode) {
    return {
      ok: true,
      code: null,
      percent: 0,
      bonus: 0
    };
  }

  const promo =
    PROMOCODES[promoCode];

  if (!promo) {
    return {
      ok: false,
      message:
        "Промокод не найден"
    };
  }

  if (!promo.active) {
    return {
      ok: false,
      message:
        "Промокод больше недействителен"
    };
  }

  if (promo.type !== "percent") {
    return {
      ok: false,
      message:
        "Этот промокод нельзя использовать для пополнения"
    };
  }

  const userUses =
    await getPromoUserUses(
      user.telegram_id,
      promoCode
    );

  if (userUses >= 1) {
    return {
      ok: false,
      message:
        "Вы уже использовали этот промокод"
    };
  }

  const globalUses =
    await getPromoGlobalUses(
      promoCode
    );

  if (
    globalUses >=
    promo.maxUses
  ) {
    return {
      ok: false,
      message:
        "Лимит использований промокода исчерпан"
    };
  }

  return {
    ok: true,
    code: promoCode,
    percent: promo.percent,
    bonus: 0
  };
}


// ==========================================
// PT ПРОМО
// ==========================================

async function calculateBonusPromo(
  user,
  code
) {
  const promoCode =
    normalizePromoCode(code);

  if (!promoCode) {
    return {
      ok: false,
      message:
        "Введите промокод"
    };
  }

  const promo =
    PROMOCODES[promoCode];

  if (!promo) {
    return {
      ok: false,
      message:
        "Промокод не найден"
    };
  }

  if (!promo.active) {
    return {
      ok: false,
      message:
        "Промокод больше недействителен"
    };
  }

  if (promo.type !== "bonus") {
    return {
      ok: false,
      message:
        "Этот промокод предназначен для пополнения"
    };
  }

  const userUses =
    await getPromoUserUses(
      user.telegram_id,
      promoCode
    );

  if (userUses >= 1) {
    return {
      ok: false,
      message:
        "Вы уже использовали этот промокод"
    };
  }

  const globalUses =
    await getPromoGlobalUses(
      promoCode
    );

  if (
    globalUses >=
    promo.maxUses
  ) {
    return {
      ok: false,
      message:
        "Лимит использований промокода исчерпан"
    };
  }

  return {
    ok: true,
    code: promoCode,
    percent: 0,
    bonus: promo.bonus
  };
}


// ==========================================
// ПОЛУЧЕНИЕ РЕКВИЗИТОВ
// ==========================================

function getPaymentDetails() {
  return {
    card: PAYMENT_CARD,
    recipient: PAYMENT_RECIPIENT,
    rate: PT_RUB_RATE
  };
}


// ==========================================
// TELEGRAM API
// ==========================================

async function telegramRequest(
  method,
  body = {}
) {
  if (!BOT_TOKEN) {
    throw new Error(
      "BOT_TOKEN не настроен"
    );
  }

  const response =
    await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(body)
      }
    );

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
        `Telegram API error: ${method}`
    );
  }

  return data.result;
}


// ==========================================
// АКТИВАЦИЯ ПРОМОКОДА
// ==========================================

async function activatePromoCode(
  user,
  code,
  client
) {
  const promoCode =
    normalizePromoCode(code);

  const promo =
    PROMOCODES[promoCode];

  if (!promo) {
    throw new Error(
      "Промокод не найден"
    );
  }

  if (!promo.active) {
    throw new Error(
      "Промокод неактивен"
    );
  }

  const userUses =
    await getPromoUserUses(
      user.telegram_id,
      promoCode
    );

  if (userUses >= 1) {
    throw new Error(
      "Пользователь уже использовал этот промокод"
    );
  }

  const globalUses =
    await getPromoGlobalUses(
      promoCode
    );

  if (
    globalUses >=
    promo.maxUses
  ) {
    throw new Error(
      "Лимит промокода исчерпан"
    );
  }

  const executor =
    client || pool;

  await executor.query(
    `
      INSERT INTO promo_uses (
        telegram_id,
        promo_code,
        uses
      )
      VALUES ($1, $2, 1)

      ON CONFLICT (
        telegram_id,
        promo_code
      )

      DO UPDATE SET
        uses =
          promo_uses.uses + 1
    `,
    [
      String(user.telegram_id),
      promoCode
    ]
  );

  await executor.query(
    `
      INSERT INTO promo_global (
        promo_code,
        uses
      )
      VALUES ($1, 1)

      ON CONFLICT (
        promo_code
      )

      DO UPDATE SET
        uses =
          promo_global.uses + 1
    `,
    [
      promoCode
    ]
  );

  return promo;
}


// ==========================================
// API: ГЛАВНАЯ
// ==========================================

app.get("/", async (req, res) => {
  try {
    const result =
      await pool.query(
        "SELECT NOW() AS now"
      );

    res.json({
      ok: true,
      service:
        "СК МЕТРОШОП API",
      database: true,
      time:
        result.rows[0].now
    });

  } catch (error) {

    console.error(
      "DATABASE CHECK ERROR:",
      error.message
    );

    res.status(500).json({
      ok: false,
      service:
        "СК МЕТРОШОП API",
      database: false,
      message:
        "Ошибка подключения к базе"
    });
  }
});


// ==========================================
// API: ТОВАРЫ
// ==========================================

app.get(
  "/api/products",
  (req, res) => {

    res.json({
      ok: true,
      products: PRODUCTS
    });

  }
);


// ==========================================
// API: ПРОФИЛЬ
// ==========================================

app.post(
  "/api/profile",
  async (req, res) => {

    try {

      const {
        tgUser,
        user
      } =
        await requireTelegramUser(
          req
        );

      res.json({
        ok: true,

        profile: {
          telegramId:
            tgUser.id,

          firstName:
            user.first_name,

          lastName:
            user.last_name,

          username:
            user.username,

          balance:
            Number(user.balance || 0)
        }
      });

    } catch (error) {

      console.error(
        "PROFILE ERROR:",
        error.message
      );

      res.status(401).json({
        ok: false,
        message:
          error.message ||
          "Ошибка авторизации"
      });
    }
  }
);


// ==========================================
// API: ИСТОРИЯ
// ==========================================

app.post(
  "/api/history",
  async (req, res) => {

    try {

      const {
        user
      } =
        await requireTelegramUser(
          req
        );

      const result =
        await pool.query(
          `
            SELECT
              id,
              type,
              amount,
              description,
              order_id,
              topup_id,
              created_at
            FROM transactions
            WHERE telegram_id = $1
            ORDER BY created_at DESC
          `,
          [
            String(
              user.telegram_id
            )
          ]
        );

      res.json({
        ok: true,

        transactions:
          result.rows.map(
            (row) => ({
              id: row.id,
              type: row.type,
              amount:
                Number(row.amount),
              description:
                row.description,
              orderId:
                row.order_id,
              topupId:
                row.topup_id,
              createdAt:
                row.created_at
            })
          )
      });

    } catch (error) {

      console.error(
        "HISTORY ERROR:",
        error.message
      );

      res.status(401).json({
        ok: false,
        message:
          error.message ||
          "Ошибка загрузки истории"
      });
    }
  }
);


// ==========================================
// API: БАЛАНС
// ==========================================

app.post(
  "/api/balance",
  async (req, res) => {

    try {

      const {
        user
      } =
        await requireTelegramUser(
          req
        );

      res.json({
        ok: true,
        balance:
          Number(
            user.balance || 0
          )
      });

    } catch (error) {

      console.error(
        "BALANCE ERROR:",
        error.message
      );

      res.status(401).json({
        ok: false,
        message:
          error.message ||
          "Ошибка получения баланса"
      });
    }
  }
);


// ==========================================
// API: ПРОВЕРКА ПРОМО НА ПОПОЛНЕНИЕ
// ==========================================

app.post(
  "/api/check-topup-promo",
  async (req, res) => {

    try {

      const {
        user
      } =
        await requireTelegramUser(
          req
        );

      const code =
        normalizePromoCode(
          req.body?.promoCode
        );

      const result =
        await calculatePercentPromo(
          user,
          code
        );

      if (!result.ok) {
        return res.status(400).json(
          result
        );
      }

      res.json({
        ok: true,
        code: result.code,
        percent:
          result.percent,
        bonus:
          result.bonus
      });

    } catch (error) {

      console.error(
        "CHECK TOPUP PROMO ERROR:",
        error.message
      );

      res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Ошибка проверки промокода"
      });
    }
  }
);


// ==========================================
// API: ПРОВЕРКА PT ПРОМО
// ==========================================

app.post(
  "/api/check-pt-promo",
  async (req, res) => {

    try {

      const {
        user
      } =
        await requireTelegramUser(
          req
        );

      const code =
        normalizePromoCode(
          req.body?.promoCode
        );

      const result =
        await calculateBonusPromo(
          user,
          code
        );

      if (!result.ok) {
        return res.status(400).json(
          result
        );
      }

      res.json({
        ok: true,
        code: result.code,
        bonus:
          result.bonus
      });

    } catch (error) {

      console.error(
        "CHECK PT PROMO ERROR:",
        error.message
      );

      res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Ошибка проверки промокода"
      });
    }
  }
);


// ==========================================
// API: РЕКВИЗИТЫ
// ==========================================

app.get(
  "/api/payment-details",
  (req, res) => {

    const details =
      getPaymentDetails();

    res.json({
      ok: true,
      ...details
    });

  }
);


// ==========================================
// УВЕДОМЛЕНИЯ О ПОПОЛНЕНИИ
// ==========================================

async function notifyTopupCreated(
  topup
) {
  if (!topup) {
    return;
  }

  const username =
    topup.user_username
      ? `@${topup.user_username}`
      : "без username";

  const text =
    `💳 НОВОЕ ПОПОЛНЕНИЕ\n\n` +
    `🆔 ID: ${topup.id}\n` +
    `👤 Пользователь: ${topup.user_first_name || ""} ${topup.user_last_name || ""}\n` +
    `🔗 Username: ${username}\n` +
    `🆔 Telegram ID: ${topup.telegram_id}\n\n` +
    `💰 Пополнение: ${topup.amount_pt} PT\n` +
    `🎁 Бонус: ${topup.bonus_points || 0} PT\n` +
    `💎 Итого: ${topup.total_points} PT\n` +
    `💵 К оплате: ${topup.payment_rub} ₽\n\n` +
    `💳 Карта: ${PAYMENT_CARD || "не указана"}\n` +
    `👤 Получатель: ${PAYMENT_RECIPIENT || "не указан"}\n\n` +
    `⏳ Статус: ОЖИДАЕТ ОПЛАТУ`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "💰 ОПЛАЧЕНО",
          callback_data:
            `topup_paid:${topup.id}`
        }
      ]
    ]
  };

  return telegramRequest(
    "sendMessage",
    {
      chat_id:
        PAYMENT_CHAT_ID,
      text,
      reply_markup:
        keyboard
    }
  );
}


// ==========================================
// УВЕДОМЛЕНИЕ ПОЛЬЗОВАТЕЛЯ О ПОПОЛНЕНИИ
// ==========================================

async function notifyUserTopupWaiting(
  topup
) {
  const text =
    `💳 Пополнение создано!\n\n` +
    `💰 Сумма: ${topup.amount_pt} PT\n` +
    `🎁 Бонус: ${topup.bonus_points || 0} PT\n` +
    `💎 Вы получите: ${topup.total_points} PT\n` +
    `💵 К оплате: ${topup.payment_rub} ₽\n\n` +
    `💳 Карта: ${PAYMENT_CARD || "не указана"}\n` +
    `👤 Получатель: ${PAYMENT_RECIPIENT || "не указан"}\n\n` +
    `⏳ Статус: ОЖИДАЕТ ОПЛАТУ\n\n` +
    `После оплаты нажмите кнопку «Я ОПЛАТИЛ».`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "✅ Я ОПЛАТИЛ",
          callback_data:
            `topup_paid:${topup.id}`
        }
      ]
    ]
  };

  return telegramRequest(
    "sendMessage",
    {
      chat_id:
        topup.telegram_id,
      text,
      reply_markup:
        keyboard
    }
  );
}


// ==========================================
// УВЕДОМЛЕНИЕ ОБ ОПЛАТЕ
// ==========================================

async function notifyTopupPaid(
  topup
) {
  const username =
    topup.user_username
      ? `@${topup.user_username}`
      : "без username";

  const text =
    `💰 ОПЛАТА ПОПОЛНЕНИЯ\n\n` +
    `🆔 ID: ${topup.id}\n` +
    `👤 Пользователь: ${topup.user_first_name || ""} ${topup.user_last_name || ""}\n` +
    `🔗 Username: ${username}\n` +
    `🆔 Telegram ID: ${topup.telegram_id}\n\n` +
    `💎 PT: ${topup.total_points}\n` +
    `💵 Сумма: ${topup.payment_rub} ₽\n\n` +
    `🟡 Статус: ОПЛАТА ПОДТВЕРЖДЕНА ПОЛЬЗОВАТЕЛЕМ`;

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "✅ ПОДТВЕРДИТЬ",
          callback_data:
            `topup_confirm:${topup.id}`
        },
        {
          text: "❌ ОТКЛОНИТЬ",
          callback_data:
            `topup_reject:${topup.id}`
        }
      ]
    ]
  };

  return telegramRequest(
    "sendMessage",
    {
      chat_id:
        PAYMENT_CHAT_ID,
      text,
      reply_markup:
        keyboard
    }
  );
}


// ==========================================
// УВЕДОМЛЕНИЕ ПОЛЬЗОВАТЕЛЯ О ПОДТВЕРЖДЕНИИ
// ==========================================

async function notifyTopupConfirmed(
  topup
) {
  const text =
    `✅ ПОПОЛНЕНИЕ ПОДТВЕРЖДЕНО!\n\n` +
    `💰 Основная сумма: ${topup.amount_pt} PT\n` +
    `🎁 Бонус: ${topup.bonus_points || 0} PT\n` +
    `💎 Начислено: ${topup.total_points} PT\n\n` +
    `Баланс успешно пополнен.`;

  return telegramRequest(
    "sendMessage",
    {
      chat_id:
        topup.telegram_id,
      text
    }
  );
}


// ==========================================
// УВЕДОМЛЕНИЕ ОБ ОТКЛОНЕНИИ
// ==========================================

async function notifyTopupRejected(
  topup
) {
  const text =
    `❌ ПОПОЛНЕНИЕ ОТКЛОНЕНО\n\n` +
    `🆔 ID: ${topup.id}\n` +
    `💰 Сумма: ${topup.amount_pt} PT\n\n` +
    `Если вы считаете, что это ошибка, обратитесь к администрации.`;

  return telegramRequest(
    "sendMessage",
    {
      chat_id:
        topup.telegram_id,
      text
    }
  );
}


// ==========================================
// API: СОЗДАНИЕ ПОПОЛНЕНИЯ
// ==========================================

app.post(
  "/api/topup",
  async (req, res) => {

    const client =
      await pool.connect();

    try {

      const {
        user
      } =
        await requireTelegramUser(
          req
        );

      const amountPt =
        Number(
          req.body?.amountPt
        );

      const promoCode =
        normalizePromoCode(
          req.body?.promoCode
        );

      if (
        !Number.isInteger(
          amountPt
        ) ||
        amountPt <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Некорректная сумма пополнения"
        });
      }

      let promoResult = {
        ok: true,
        code: null,
        percent: 0,
        bonus: 0
      };

      if (promoCode) {
        promoResult =
          await calculatePercentPromo(
            user,
            promoCode
          );

        if (!promoResult.ok) {
          return res.status(400).json(
            promoResult
          );
        }
      }

      const percent =
        Number(
          promoResult.percent || 0
        );

      const bonusPoints =
        Math.floor(
          amountPt *
          percent /
          100
        );

      const totalPoints =
        amountPt +
        bonusPoints;

      const paymentRub =
        Math.ceil(
          amountPt *
          PT_RUB_RATE
        );

      const topupId =
        randomId("topup_");

      await client.query(
        "BEGIN"
      );

      await client.query(
        `
          SELECT telegram_id
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
        `,
        [
          String(
            user.telegram_id
          )
        ]
      );

      await client.query(
        `
          INSERT INTO topups (
            id,
            telegram_id,
            amount_pt,
            bonus_points,
            total_points,
            promo_percent,
            percent,
            payment_rub,
            status,
            user_first_name,
            user_last_name,
            user_username
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            'waiting_payment',
            $9,
            $10,
            $11
          )
        `,
        [
          topupId,
          String(
            user.telegram_id
          ),
          amountPt,
          bonusPoints,
          totalPoints,
          promoResult.code,
          percent,
          paymentRub,
          user.first_name || "",
          user.last_name || "",
          user.username || ""
        ]
      );

      await client.query(
        "COMMIT"
      );

      const result =
        await pool.query(
          `
            SELECT *
            FROM topups
            WHERE id = $1
          `,
          [topupId]
        );

      const topup =
        result.rows[0];

      try {
        await notifyUserTopupWaiting(
          topup
        );
      } catch (error) {
        console.error(
          "USER TOPUP NOTIFY ERROR:",
          error.message
        );
      }

      try {
        await notifyTopupCreated(
          topup
        );
      } catch (error) {
        console.error(
          "STAFF TOPUP NOTIFY ERROR:",
          error.message
        );
      }

      res.json({
        ok: true,
        topup: {
          id: topup.id,
          amountPt:
            topup.amount_pt,
          bonusPoints:
            topup.bonus_points,
          totalPoints:
            topup.total_points,
          paymentRub:
            topup.payment_rub,
          status:
            topup.status
        }
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "TOPUP ERROR:",
        error.message
      );

      res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Ошибка создания пополнения"
      });

    } finally {

      client.release();
    }
  }
);  const text =
    buildStaffOrderText(
      order,
      "waiting"
    );

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "✅ ВЗЯТЬ ЗАКАЗ",
          callback_data:
            `claim:${order.id}`
        }
      ]
    ]
  };

  return telegramRequest(
    "sendMessage",
    {
      chat_id:
        STAFF_CHAT_ID,
      text,
      reply_markup:
        keyboard
    }
  );
}


// ==========================================
// ПОЛУЧЕНИЕ ЗАКАЗА ИЗ БАЗЫ
// ==========================================

async function getOrderById(
  orderId,
  client = null
) {
  const executor =
    client || pool;

  const result =
    await executor.query(
      `
        SELECT *
        FROM orders
        WHERE id = $1
      `,
      [orderId]
    );

  if (!result.rows.length) {
    return null;
  }

  return result.rows[0];
}


// ==========================================
// УВЕДОМЛЕНИЕ О ВЗЯТИИ ЗАКАЗА
// ==========================================

async function handleClaim(
  callbackQuery,
  orderId
) {
  if (
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(STAFF_CHAT_ID)
  ) {
    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          "❌ У вас нет доступа",
        show_alert: true
      }
    );

    return;
  }

  const staff =
    callbackQuery.from;

  const client =
    await pool.connect();

  try {

    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
          SELECT *
          FROM orders
          WHERE id = $1
          FOR UPDATE
        `,
        [orderId]
      );

    if (!result.rows.length) {

      await client.query(
        "ROLLBACK"
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,
          text:
            "❌ Заказ не найден",
          show_alert: true
        }
      );

      return;
    }

    const order =
      result.rows[0];

    if (
      order.status !==
      "waiting"
    ) {

      await client.query(
        "ROLLBACK"
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,
          text:
            "⚠️ Этот заказ уже взят или выполнен",
          show_alert: true
        }
      );

      return;
    }

    const staffName =
      getStaffDisplayName(
        staff
      );

    const staffUsername =
      staff.username ||
      "";

    await client.query(
      `
        UPDATE orders
        SET
          status = 'claimed',
          claimed_by_id = $1,
          claimed_by_name = $2,
          claimed_by_username = $3
        WHERE id = $4
      `,
      [
        String(staff.id),
        staffName,
        staffUsername,
        orderId
      ]
    );

    await client.query(
      "COMMIT"
    );

    const updatedOrder =
      await getOrderById(
        orderId
      );

    const staffText =
      buildStaffOrderText(
        updatedOrder,
        "claimed"
      );

    const keyboard = {
      inline_keyboard: [
        [
          {
            text:
              "✅ ВЫПОЛНИТЬ ЗАКАЗ",
            callback_data:
              `complete:${orderId}`
          }
        ]
      ]
    };

    try {

      await telegramRequest(
        "editMessageText",
        {
          chat_id:
            callbackQuery.message
              .chat.id,

          message_id:
            callbackQuery.message
              .message_id,

          text:
            staffText,

          reply_markup:
            keyboard
        }
      );

    } catch (editError) {

      console.error(
        "EDIT CLAIMED ORDER ERROR:",
        editError.message
      );
    }

    try {

      await notifyOrderClaimed(
        updatedOrder,
        staffName,
        staffUsername
      );

    } catch (notifyError) {

      console.error(
        "CLAIM USER NOTIFY ERROR:",
        notifyError.message
      );
    }

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          "✅ Заказ взят"
      }
    );

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    console.error(
      "CLAIM ERROR:",
      error.message
    );

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          "❌ Ошибка при взятии заказа",
        show_alert: true
      }
    );

  } finally {

    client.release();
  }
}


// ==========================================
// ВЫПОЛНЕНИЕ ЗАКАЗА
// ==========================================

async function handleComplete(
  callbackQuery,
  orderId
) {
  if (
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(STAFF_CHAT_ID)
  ) {
    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          "❌ У вас нет доступа",
        show_alert: true
      }
    );

    return;
  }

  const staff =
    callbackQuery.from;

  const client =
    await pool.connect();

  try {

    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
          SELECT *
          FROM orders
          WHERE id = $1
          FOR UPDATE
        `,
        [orderId]
      );

    if (!result.rows.length) {

      await client.query(
        "ROLLBACK"
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,
          text:
            "❌ Заказ не найден",
          show_alert: true
        }
      );

      return;
    }

    const order =
      result.rows[0];

    if (
      order.status !==
      "claimed"
    ) {

      await client.query(
        "ROLLBACK"
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,
          text:
            "⚠️ Заказ нельзя выполнить в текущем статусе",
          show_alert: true
        }
      );

      return;
    }

    if (
      String(
        order.claimed_by_id
      ) !==
      String(staff.id)
    ) {

      await client.query(
        "ROLLBACK"
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,
          text:
            "❌ Выполнить заказ может только сотрудник, который его взял",
          show_alert: true
        }
      );

      return;
    }

    await client.query(
      `
        UPDATE orders
        SET
          status = 'completed',
          completed_at = NOW()
        WHERE id = $1
      `,
      [orderId]
    );

    await client.query(
      "COMMIT"
    );

    const updatedOrder =
      await getOrderById(
        orderId
      );

    const staffText =
      buildStaffOrderText(
        updatedOrder,
        "completed"
      );

    try {

      await telegramRequest(
        "editMessageText",
        {
          chat_id:
            callbackQuery.message
              .chat.id,

          message_id:
            callbackQuery.message
              .message_id,

          text:
            staffText
        }
      );

    } catch (editError) {

      console.error(
        "EDIT COMPLETED ORDER ERROR:",
        editError.message
      );
    }

    try {

      await notifyOrderCompleted(
        updatedOrder
      );

    } catch (notifyError) {

      console.error(
        "COMPLETE USER NOTIFY ERROR:",
        notifyError.message
      );
    }

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          "✅ Заказ выполнен"
      }
    );

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    console.error(
      "COMPLETE ERROR:",
      error.message
    );

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          "❌ Ошибка выполнения заказа",
        show_alert: true
      }
    );

  } finally {

    client.release();
  }
}


// ==========================================
// ПОПОЛНЕНИЕ: ПОЛЬЗОВАТЕЛЬ НАЖАЛ «ОПЛАЧЕНО»
// ==========================================

async function handleTopupPaid(
  callbackQuery,
  topupId
) {
  const callbackUser =
    callbackQuery.from;

  const client =
    await pool.connect();

  try {

    const chatId =
      String(
        callbackQuery.message?.chat?.id
      );

    const paymentChat =
      String(
        PAYMENT_CHAT_ID
      );

    const isStaffChat =
      chatId === paymentChat;

    if (
      !isStaffChat
    ) {

      const user =
        await getOrCreateUser(
          callbackUser
        );

      const result =
        await client.query(
          `
            SELECT *
            FROM topups
            WHERE id = $1
              AND telegram_id = $2
          `,
          [
            topupId,
            String(
              user.telegram_id
            )
          ]
        );

      if (!result.rows.length) {

        await telegramRequest(
          "answerCallbackQuery",
          {
            callback_query_id:
              callbackQuery.id,
            text:
              "❌ Пополнение не найдено",
            show_alert: true
          }
        );

        return;
      }

      const topup =
        result.rows[0];

      if (
        topup.status !==
        "waiting_payment"
      ) {

        await telegramRequest(
          "answerCallbackQuery",
          {
            callback_query_id:
              callbackQuery.id,
            text:
              "⚠️ Это пополнение уже обработано",
            show_alert: true
          }
        );

        return;
      }

      await client.query(
        `
          UPDATE topups
          SET status = 'paid'
          WHERE id = $1
        `,
        [topupId]
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,
          text:
            "✅ Информация об оплате отправлена"
        }
      );

      const updated =
        await client.query(
          `
            SELECT *
            FROM topups
            WHERE id = $1
          `,
          [topupId]
        );

      try {

        await notifyTopupPaid(
          updated.rows[0]
        );

      } catch (notifyError) {

        console.error(
          "TOPUP PAID STAFF NOTIFY ERROR:",
          notifyError.message
        );
      }

      return;
    }

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          "❌ Эта кнопка доступна пользователю"
      }
    );

  } catch (error) {

    console.error(
      "TOPUP PAID ERROR:",
      error.message
    );

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          "❌ Ошибка",
        show_alert: true
      }
    );

  } finally {

    client.release();
  }
}


// ==========================================
// ПОДТВЕРЖДЕНИЕ ПОПОЛНЕНИЯ СОТРУДНИКОМ
// ==========================================

async function handleTopupConfirm(
  callbackQuery,
  topupId
) {
  if (
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(PAYMENT_CHAT_ID)
  ) {

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          "❌ Нет доступа",
        show_alert: true
      }
    );

    return;
  }

  const staff =
    callbackQuery.from;

  const client =
    await pool.connect();

  try {

    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
          SELECT *
          FROM topups
          WHERE id = $1
          FOR UPDATE
        `,
        [topupId]
      );

    if (!result.rows.length) {

      await client.query(
        "ROLLBACK"
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,
          text:
            "❌ Пополнение не найдено",
          show_alert: true
        }
      );

      return;
    }

    const topup =
      result.rows[0];

    if (
      topup.status !==
        "paid" &&
      topup.status !==
        "waiting_payment"
    ) {

      await client.query(
        "ROLLBACK"
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,
          text:
            "⚠️ Пополнение уже обработано",
          show_alert: true
        }
      );

      return;
    }

    const userResult =
      await client.query(
        `
          SELECT *
          FROM users
          WHERE telegram_id = $1
          FOR UPDATE
        `,
        [
          String(
            topup.telegram_id
          )
        ]
      );

    if (
      !userResult.rows.length
    ) {
      throw new Error(
        "Пользователь не найден"
      );
    }

    const user =
      userResult.rows[0];

    const promoCode =
      normalizePromoCode(
        topup.promo_percent
      );

    let bonusPoints =
      Number(
        topup.bonus_points || 0
      );

    if (
      promoCode &&
      bonusPoints > 0
    ) {

      const promoResult =
        await calculatePercentPromo(
          user,
          promoCode
        );

      if (!promoResult.ok) {
        throw new Error(
          promoResult.message
        );
      }

      bonusPoints =
        Math.floor(
          Number(
            topup.amount_pt
          ) *
          Number(
            promoResult.percent || 0
          ) /
          100
        );
    }

    const totalPoints =
      Number(
        topup.amount_pt
      ) +
      bonusPoints;

    const balanceBefore =
      Number(
        user.balance || 0
      );

    const balanceAfter =
      balanceBefore +
      totalPoints;

    if (
      promoCode &&
      bonusPoints > 0
    ) {
      await activatePromoCode(
        user,
        promoCode,
        client
      );
    }

    await client.query(
      `
        UPDATE users
        SET
          balance = $1,
          updated_at = NOW()
        WHERE telegram_id = $2
      `,
      [
        balanceAfter,
        String(
          user.telegram_id
        )
      ]
    );

    await client.query(
      `
        UPDATE topups
        SET
          status = 'confirmed',
          total_points = $1,
          bonus_points = $2,
          confirmed_at = NOW(),
          confirmed_by_id = $3,
          confirmed_by_name = $4,
          confirmed_by_username = $5
        WHERE id = $6
      `,
      [
        totalPoints,
        bonusPoints,
        String(staff.id),
        getStaffDisplayName(
          staff
        ),
        staff.username || "",
        topupId
      ]
    );

    await addTransaction({
      telegramId:
        user.telegram_id,

      type:
        "topup",

      amount:
        totalPoints,

      description:
        `Пополнение ${topupId}`,

      topupId,

      client
    });

    await client.query(
      "COMMIT"
    );

    const updated =
      await pool.query(
        `
          SELECT *
          FROM topups
          WHERE id = $1
        `,
        [topupId]
      );

    try {

      await notifyTopupConfirmed(
        updated.rows[0]
      );

    } catch (notifyError) {

      console.error(
        "TOPUP CONFIRM USER NOTIFY ERROR:",
        notifyError.message
      );
    }

    try {

      await telegramRequest(
        "editMessageText",
        {
          chat_id:
            callbackQuery.message
              .chat.id,

          message_id:
            callbackQuery.message
              .message_id,

          text:
            `✅ ПОПОЛНЕНИЕ ПОДТВЕРЖДЕНО\n\n` +
            `🆔 ID: ${topupId}\n` +
            `👤 ${topup.user_first_name || ""} ${topup.user_last_name || ""}\n` +
            `💎 Начислено: ${totalPoints} PT\n` +
            `🎁 Бонус: ${bonusPoints} PT\n\n` +
            `👤 Подтвердил: ${getStaffDisplayName(staff)}`
        }
      );

    } catch (editError) {

      console.error(
        "EDIT TOPUP CONFIRM ERROR:",
        editError.message
      );
    }

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          `✅ Начислено ${totalPoints} PT`
      }
    );

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    console.error(
      "TOPUP CONFIRM ERROR:",
      error.message
    );

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,
        text:
          error.message ||
          "❌ Ошибка подтверждения",
        show_alert: true
      }
    );

  } finally {

    client.release();
  }
}    }

    const oldBalance =
      Number(
        user.balance || 0
      );

    const totalPoints =
      Number(
        topup.amount_pt
      ) +
      finalBonus;

    const newBalance =
      oldBalance +
      totalPoints;

    await client.query(
      `
        UPDATE users
        SET
          balance = $1,
          updated_at = NOW()
        WHERE telegram_id = $2
      `,
      [
        newBalance,
        String(
          user.telegram_id
        )
      ]
    );

    await addTransaction({
      telegramId:
        user.telegram_id,

      type:
        "topup",

      amount:
        totalPoints,

      description:
        `Пополнение ${topup.amount_pt} PT` +
        (
          finalBonus > 0
            ? ` + ${finalBonus} PT бонус`
            : ""
        ),

      topupId:
        topup.id,

      client
    });

    const staff =
      callbackQuery.from;

    await client.query(
      `
        UPDATE topups
        SET
          status = 'completed',

          confirmed_at = NOW(),

          confirmed_by_id = $1,
          confirmed_by_name = $2,
          confirmed_by_username = $3,

          bonus_points = $4,
          total_points = $5
        WHERE id = $6
      `,
      [
        String(staff.id),

        [
          staff.first_name || "",
          staff.last_name || ""
        ]
          .join(" ")
          .trim(),

        staff.username || "",

        finalBonus,
        totalPoints,

        topup.id
      ]
    );

    await client.query(
      "COMMIT"
    );

    const staffName =
      [
        staff.first_name || "",
        staff.last_name || ""
      ]
        .join(" ")
        .trim() ||
      "Сотрудник";

    await telegramRequest(
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
                text:
                  `✅ ЗАЧИСЛЕНО: ${totalPoints} PT`
                    .slice(
                      0,
                      64
                    ),

                callback_data:
                  "noop"
              }
            ]
          ]
        }
      }
    );

    try {

      await telegramRequest(
        "sendMessage",
        {
          chat_id:
            topup.telegram_id,

          text:
            `✅ Пополнение подтверждено!\n\n` +
            `💰 Оплачено: ${topup.payment_rub} ₽\n` +
            `💎 Зачислено: ${totalPoints} PT\n` +
            (
              finalBonus > 0
                ? `🎁 Бонус: +${finalBonus} PT\n`
                : ""
            ) +
            `💳 Новый баланс: ${newBalance} PT\n\n` +
            `🧾 Заявка: ${topup.id}`
        }
      );

    } catch (notifyError) {

      console.error(
        "NOTIFY TOPUP USER ERROR:",
        notifyError.message
      );
    }

    return {
      ok: true,
      totalPoints,
      balance:
        newBalance,
      staffName
    };

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    throw error;

  } finally {

    client.release();
  }
}


// ==========================================
// ОТКЛОНЕНИЕ ПОПОЛНЕНИЯ
// ==========================================

async function handleTopupReject(
  callbackQuery,
  paymentId
) {
  if (
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(
      PAYMENT_CHAT_ID
    )
  ) {
    throw new Error(
      "Недоступно вне чата оплаты"
    );
  }

  const client =
    await pool.connect();

  try {

    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
          SELECT *
          FROM topups
          WHERE id = $1
          FOR UPDATE
        `,
        [
          paymentId
        ]
      );

    if (
      !result.rows.length
    ) {
      throw new Error(
        "Заявка на пополнение не найдена"
      );
    }

    const topup =
      result.rows[0];

    if (
      topup.status ===
      "rejected"
    ) {
      throw new Error(
        "Заявка уже отклонена"
      );
    }

    if (
      topup.status ===
      "completed"
    ) {
      throw new Error(
        "Нельзя отклонить уже подтверждённое пополнение"
      );
    }

    if (
      topup.status !==
      "paid_waiting_confirmation"
    ) {
      throw new Error(
        `Нельзя отклонить заявку в статусе: ${topup.status}`
      );
    }

    const staff =
      callbackQuery.from;

    await client.query(
      `
        UPDATE topups
        SET
          status = 'rejected',

          rejected_at = NOW(),

          rejected_by_id = $1,
          rejected_by_name = $2,
          rejected_by_username = $3
        WHERE id = $4
      `,
      [
        String(staff.id),

        [
          staff.first_name || "",
          staff.last_name || ""
        ]
          .join(" ")
          .trim(),

        staff.username || "",

        paymentId
      ]
    );

    await client.query(
      "COMMIT"
    );

    const staffName =
      [
        staff.first_name || "",
        staff.last_name || ""
      ]
        .join(" ")
        .trim() ||
      "Сотрудник";

    await telegramRequest(
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
                text:
                  `❌ ОТКЛОНЕНО: ${staffName}`
                    .slice(
                      0,
                      64
                    ),

                callback_data:
                  "noop"
              }
            ]
          ]
        }
      }
    );

    try {

      await telegramRequest(
        "sendMessage",
        {
          chat_id:
            topup.telegram_id,

          text:
            `❌ Заявка на пополнение отклонена.\n\n` +
            `💰 Сумма: ${topup.payment_rub} ₽\n` +
            `💎 PT: ${topup.total_points}\n\n` +
            `🧾 Заявка: ${topup.id}\n\n` +
            `Если вы действительно отправили оплату, обратитесь к сотруднику магазина.`
        }
      );

    } catch (notifyError) {

      console.error(
        "NOTIFY REJECT ERROR:",
        notifyError.message
      );
    }

    return {
      ok: true,
      staffName
    };

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    throw error;

  } finally {

    client.release();
  }
}


// ==========================================
// ЗАБРАТЬ ЗАКАЗ
// ==========================================

async function handleClaim(
  callbackQuery,
  orderId
) {
  if (
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(
      STAFF_CHAT_ID
    )
  ) {
    throw new Error(
      "Недоступно вне рабочего чата"
    );
  }

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
          SELECT *
          FROM orders
          WHERE id = $1
          FOR UPDATE
        `,
        [
          orderId
        ]
      );

    if (
      !result.rows.length
    ) {
      throw new Error(
        "Заказ не найден"
      );
    }

    const order =
      result.rows[0];

    if (
      order.status !==
      "waiting"
    ) {
      throw new Error(
        "Этот заказ уже взят или завершён"
      );
    }

    const staff =
      callbackQuery.from;

    const staffName =
      getStaffDisplayName(
        staff
      );

    await client.query(
      `
        UPDATE orders
        SET
          status = 'claimed',

          claimed_by_id = $1,
          claimed_by_name = $2,
          claimed_by_username = $3
        WHERE id = $4
      `,
      [
        String(
          staff.id
        ),

        staffName,

        staff.username || "",

        orderId
      ]
    );

    await client.query(
      "COMMIT"
    );

    const claimedOrder = {
      ...order,
      status: "claimed",
      claimed_by_id:
        String(staff.id),
      claimed_by_name:
        staffName,
      claimed_by_username:
        staff.username || ""
    };

    await telegramRequest(
      "editMessageText",
      {
        chat_id:
          callbackQuery.message.chat.id,

        message_id:
          callbackQuery.message.message_id,

        text:
          buildStaffOrderText(
            claimedOrder,
            "claimed"
          ),

        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  `✅ ЗАВЕРШИТЬ ЗАКАЗ`
                    .slice(0, 64),

                callback_data:
                  `complete:${orderId}`
              }
            ]
          ]
        }
      }
    );

    await notifyOrderClaimed(
      claimedOrder,
      staffName,
      staff.username || ""
    );

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    throw error;

  } finally {
    client.release();
  }
}


// ==========================================
// ЗАВЕРШИТЬ ЗАКАЗ
// ==========================================

async function handleComplete(
  callbackQuery,
  orderId
) {
  if (
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(
      STAFF_CHAT_ID
    )
  ) {
    throw new Error(
      "Недоступно вне рабочего чата"
    );
  }

  const client =
    await pool.connect();

  try {
    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
          SELECT *
          FROM orders
          WHERE id = $1
          FOR UPDATE
        `,
        [
          orderId
        ]
      );

    if (
      !result.rows.length
    ) {
      throw new Error(
        "Заказ не найден"
      );
    }

    const order =
      result.rows[0];

    if (
      order.status !==
      "claimed"
    ) {
      throw new Error(
        "Заказ нельзя завершить в текущем статусе"
      );
    }

    const staffId =
      String(
        callbackQuery.from.id
      );

    if (
      String(
        order.claimed_by_id
      ) !== staffId
    ) {
      throw new Error(
        "Завершить заказ может только сотрудник, который его взял"
      );
    }

    await client.query(
      `
        UPDATE orders
        SET
          status = 'completed',
          completed_at = NOW()
        WHERE id = $1
      `,
      [
        orderId
      ]
    );

    await client.query(
      "COMMIT"
    );

    const completedOrder = {
      ...order,
      status: "completed"
    };

    await telegramRequest(
      "editMessageText",
      {
        chat_id:
          callbackQuery.message.chat.id,

        message_id:
          callbackQuery.message.message_id,

        text:
          buildStaffOrderText(
            completedOrder,
            "completed"
          ),

        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  "✅ ЗАКАЗ ВЫПОЛНЕН",
                callback_data:
                  "noop"
              }
            ]
          ]
        }
      }
    );

    await notifyOrderCompleted(
      completedOrder
    );

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch {}

    throw error;

  } finally {
    client.release();
  }
}


// ==========================================
// CALLBACK QUERY
// ==========================================

async function handleCallback(
  callbackQuery
) {
  const data =
    String(
      callbackQuery.data || ""
    );

  try {

    if (data === "noop") {

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id
        }
      );

      return;
    }

    if (
      data.startsWith(
        "claim:"
      )
    ) {

      const orderId =
        data.slice(
          "claim:".length
        );

      await handleClaim(
        callbackQuery,
        orderId
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,

          text:
            "Заказ взят"
        }
      );

      return;
    }

    if (
      data.startsWith(
        "complete:"
      )
    ) {

      const orderId =
        data.slice(
          "complete:".length
        );

      await handleComplete(
        callbackQuery,
        orderId
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,

          text:
            "Заказ завершён"
        }
      );

      return;
    }

    if (
      data.startsWith(
        "topup_confirm:"
      )
    ) {

      const paymentId =
        data.slice(
          "topup_confirm:"
            .length
        );

      const result =
        await handleTopupConfirm(
          callbackQuery,
          paymentId
        );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,

          text:
            `Зачислено ${result.totalPoints} PT`
        }
      );

      return;
    }

    if (
      data.startsWith(
        "topup_reject:"
      )
    ) {

      const paymentId =
        data.slice(
          "topup_reject:"
            .length
        );

      await handleTopupReject(
        callbackQuery,
        paymentId
      );

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,

          text:
            "Пополнение отклонено"
        }
      );

      return;
    }

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          "Неизвестная команда"
      }
    );

  } catch (error) {

    console.error(
      "CALLBACK ERROR:",
      error.message
    );

    try {

      await telegramRequest(
        "answerCallbackQuery",
        {
          callback_query_id:
            callbackQuery.id,

          text:
            error.message ||
            "Ошибка",

          show_alert: true
        }
      );

    } catch (answerError) {

      console.error(
        "ANSWER CALLBACK ERROR:",
        answerError.message
      );
    }
  }
}


// ==========================================
// TELEGRAM LONG POLLING
// ==========================================

let telegramOffset = 0;

let pollingRunning =
  false;


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

    await telegramRequest(
      "deleteWebhook",
      {
        drop_pending_updates:
          false
      }
    );

    console.log(
      "✅ Telegram webhook удалён, запускаем polling."
    );

  } catch (error) {

    console.error(
      "DELETE WEBHOOK ERROR:",
      error.message
    );
  }

  while (
    pollingRunning
  ) {

    try {

      const updates =
        await telegramRequest(
          "getUpdates",
          {
            offset:
              telegramOffset,

            timeout:
              25,

            allowed_updates:
              [
                "callback_query"
              ]
          }
        );

      for (
        const update
        of updates
      ) {

        telegramOffset =
          update.update_id + 1;

        if (
          update.callback_query
        ) {

          await handleCallback(
            update.callback_query
          );
        }
      }

    } catch (error) {

      console.error(
        "TELEGRAM POLLING ERROR:",
        error.message
      );

      await new Promise(
        (resolve) => {
          setTimeout(
            resolve,
            3000
          );
        }
      );
    }
  }
}


// ==========================================
// ЗАПУСК
// ==========================================

async function startServer() {

  try {

    await initDatabase();

    app.listen(
      PORT,
      () => {

        console.log(
          `✅ СК МЕТРОШОП сервер запущен на порту ${PORT}`
        );

        console.log(
          `💎 PT/₽ курс: ${PT_RUB_RATE}`
        );

        console.log(
          `💳 Реквизиты оплаты: ${
            PAYMENT_CARD
              ? "настроены"
              : "НЕ НАСТРОЕНЫ"
          }`
        );

        console.log(
          `👤 Получатель: ${
            PAYMENT_RECIPIENT
              ? "настроен"
              : "НЕ НАСТРОЕН"
          }`
        );

        console.log(
          `💬 Чат оплаты: ${
            PAYMENT_CHAT_ID
              ? "настроен"
              : "НЕ НАСТРОЕН"
          }`

        );

        console.log(
          `🗄️ PostgreSQL: подключён`
        );

        startTelegramPolling();
      }
    );

  } catch (error) {

    console.error(
      "❌ ОШИБКА ЗАПУСКА:",
      error
    );

    process.exit(1);
  }
}
