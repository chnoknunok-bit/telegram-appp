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
// ПРОВЕРКА ПРОЦЕНТНОГО ПРОМО
// ==========================================

async function calculatePercentPromo(
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
                Number(
                  row.amount
                ),
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
// ПРОМО: ПРОВЕРКА ПРОЦЕНТА
// ==========================================

app.post(
  "/api/promo/check-percent",
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
          req.body?.code
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

      return res.json({
        ok: true,
        code:
          result.code,
        type:
          "percent",
        percent:
          result.percent
      });

    } catch (error) {

      console.error(
        "PROMO CHECK ERROR:",
        error.message
      );

      return res.status(401).json({
        ok: false,
        message:
          error.message ||
          "Ошибка проверки промокода"
      });
    }
  }
);


// ==========================================
// ПРОМО: ПРОВЕРКА PT
// ==========================================

app.post(
  "/api/promo/check-bonus",
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
          req.body?.code
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

      return res.json({
        ok: true,
        code:
          result.code,
        type:
          "bonus",
        bonus:
          result.bonus
      });

    } catch (error) {

      console.error(
        "BONUS PROMO CHECK ERROR:",
        error.message
      );

      return res.status(401).json({
        ok: false,
        message:
          error.message ||
          "Ошибка проверки промокода"
      });
    }
  }
);


// ==========================================
// СОВМЕСТИМОСТЬ: PROMO CHECK
// ==========================================

app.post(
  "/api/promo/check",
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
          req.body?.code
        );

      const percentResult =
        await calculatePercentPromo(
          user,
          code
        );

      if (percentResult.ok) {

        return res.json({
          ok: true,
          code:
            percentResult.code,
          type:
            "percent",
          percent:
            percentResult.percent,
          bonus: 0
        });
      }

      const bonusResult =
        await calculateBonusPromo(
          user,
          code
        );

      if (bonusResult.ok) {

        return res.json({
          ok: true,
          code:
            bonusResult.code,
          type:
            "bonus",
          percent: 0,
          bonus:
            bonusResult.bonus
        });
      }

      return res.status(400).json({
        ok: false,
        message:
          percentResult.message ||
          bonusResult.message ||
          "Промокод недействителен"
      });

    } catch (error) {

      console.error(
        "PROMO CHECK COMPATIBILITY ERROR:",
        error.message
      );

      return res.status(401).json({
        ok: false,
        message:
          error.message ||
          "Ошибка проверки промокода"
      });
    }
  }
);// ==========================================
// API: СТАТУС ЗАКАЗА
// ==========================================

app.post(
  "/api/order/status",
  async (req, res) => {
    try {
      const {
        user
      } =
        await requireTelegramUser(
          req
        );

      const orderId =
        String(
          req.body?.orderId ||
          ""
        ).trim();

      if (!orderId) {
        return res.status(400).json({
          ok: false,
          message:
            "Не указан ID заказа"
        });
      }

      const result =
        await pool.query(
          `
            SELECT
              id,
              telegram_id,
              status,
              product_id,
              product_name,
              quantity,
              unit_price,
              total,
              game_id,
              user_first_name,
              user_last_name,
              user_username,
              claimed_by_id,
              claimed_by_name,
              claimed_by_username,
              created_at,
              completed_at
            FROM orders
            WHERE id = $1
          `,
          [
            orderId
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          message:
            "Заказ не найден"
        });
      }

      const order =
        result.rows[0];

      if (
        String(order.telegram_id) !==
        String(user.telegram_id)
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "Нет доступа к этому заказу"
        });
      }

      return res.json({
        ok: true,

        order: {
          id: order.id,

          status:
            order.status,

          productName:
            order.product_name,

          quantity:
            Number(order.quantity),

          unitPrice:
            Number(order.unit_price),

          total:
            Number(order.total),

          gameId:
            order.game_id,

          claimedBy:
            order.claimed_by_id
              ? {
                  id:
                    String(
                      order.claimed_by_id
                    ),

                  name:
                    order.claimed_by_name ||
                    "Сотрудник",

                  username:
                    order.claimed_by_username ||
                    ""
                }
              : null,

          createdAt:
            order.created_at,

          completedAt:
            order.completed_at
        }
      });

    } catch (error) {
      console.error(
        "ORDER STATUS ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Ошибка получения статуса заказа"
      });
    }
  }
);


// ==========================================
// API: СОЗДАНИЕ ЗАЯВКИ НА ПОПОЛНЕНИЕ
// ==========================================

app.post(
  "/api/topup/create",
  async (req, res) => {

    try {

      const {
        tgUser,
        user
      } =
        await requireTelegramUser(
          req
        );

      const amount =
        Number(
          req.body?.amount || 0
        );

      if (
        !Number.isInteger(amount)
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Количество PT должно быть целым числом"
        });
      }

      if (
        amount < 1 ||
        amount > 1000000
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Сумма пополнения должна быть от 1 до 1 000 000 PT"
        });
      }

      const promoPercent =
        normalizePromoCode(
          req.body?.promoPercent
        );

      let percent = 0;

      if (promoPercent) {

        const promoResult =
          await calculatePercentPromo(
            user,
            promoPercent
          );

        if (!promoResult.ok) {
          return res.status(400).json({
            ok: false,
            message:
              promoResult.message
          });
        }

        percent =
          promoResult.percent;
      }

      const bonusPoints =
        Math.floor(
          amount *
          (percent / 100)
        );

      const totalPoints =
        amount +
        bonusPoints;

      const paymentRub =
        Math.ceil(
          amount *
          PT_RUB_RATE
        );

      if (
        !Number.isFinite(
          paymentRub
        ) ||
        paymentRub <= 0
      ) {
        return res.status(500).json({
          ok: false,
          message:
            "Некорректный курс PT/₽"
        });
      }

      if (
        !PAYMENT_CARD ||
        !PAYMENT_RECIPIENT
      ) {
        return res.status(500).json({
          ok: false,
          message:
            "Реквизиты оплаты ещё не настроены"
        });
      }

      const paymentId =
        randomId("topup_");

      await pool.query(
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
          paymentId,

          String(
            user.telegram_id
          ),

          amount,
          bonusPoints,
          totalPoints,

          promoPercent || null,

          percent,
          paymentRub,

          tgUser.first_name || "",
          tgUser.last_name || "",
          tgUser.username || ""
        ]
      );

      return res.json({
        ok: true,

        paymentId,

        amountPT:
          amount,

        bonusPoints,

        totalPoints,

        paymentRub,

        promoPercent:
          promoPercent || null,

        payment: {
          card:
            PAYMENT_CARD,

          recipient:
            PAYMENT_RECIPIENT
        },

        status:
          "waiting_payment",

        message:
          "Заявка создана. Выполните перевод и нажмите «Я оплатил»."
      });

    } catch (error) {

      console.error(
        "TOPUP CREATE ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Не удалось создать заявку"
      });
    }
  }
);


// ==========================================
// API: ПОЛЬЗОВАТЕЛЬ НАЖАЛ «Я ОПЛАТИЛ»
// ==========================================

app.post(
  "/api/topup/mark-paid",
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

      const paymentId =
        String(
          req.body?.paymentId ||
          ""
        ).trim();

      if (!paymentId) {
        return res.status(400).json({
          ok: false,
          message:
            "Не указан ID заявки"
        });
      }

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

        await client.query(
          "ROLLBACK"
        );

        return res.status(404).json({
          ok: false,
          message:
            "Заявка не найдена"
        });
      }

      const topup =
        result.rows[0];

      if (
        String(
          topup.telegram_id
        ) !==
        String(
          user.telegram_id
        )
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(403).json({
          ok: false,
          message:
            "Это не ваша заявка"
        });
      }

      if (
        topup.status ===
        "paid_waiting_confirmation"
      ) {

        await client.query(
          "COMMIT"
        );

        return res.json({
          ok: true,
          status:
            topup.status,
          message:
            "Заявка уже отправлена на проверку"
        });
      }

      if (
        topup.status !==
        "waiting_payment"
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "Эта заявка больше не может быть оплачена"
        });
      }

      await client.query(
        `
          UPDATE topups
          SET
            status =
              'paid_waiting_confirmation',

            paid_at =
              NOW()

          WHERE id = $1
        `,
        [
          paymentId
        ]
      );

      await client.query(
        "COMMIT"
      );

      const topupForTelegram = {
        id:
          topup.id,

        telegramId:
          topup.telegram_id,

        amountPT:
          Number(
            topup.amount_pt
          ),

        bonusPoints:
          Number(
            topup.bonus_points
          ),

        totalPoints:
          Number(
            topup.total_points
          ),

        promoPercent:
          topup.promo_percent,

        percent:
          Number(
            topup.percent
          ),

        paymentRub:
          Number(
            topup.payment_rub
          ),

        user: {
          firstName:
            topup.user_first_name || "",

          lastName:
            topup.user_last_name || "",

          username:
            topup.user_username || ""
        }
      };

      try {

        await sendTopupToPaymentChat(
          topupForTelegram
        );

      } catch (telegramError) {

        await pool.query(
          `
            UPDATE topups
            SET
              status =
                'waiting_payment',

              paid_at = NULL

            WHERE id = $1
              AND status =
                'paid_waiting_confirmation'
          `,
          [
            paymentId
          ]
        );

        return res.status(500).json({
          ok: false,
          message:
            "Не удалось отправить заявку в чат оплаты. Попробуйте ещё раз."
        });
      }

      return res.json({
        ok: true,

        paymentId,

        status:
          "paid_waiting_confirmation",

        message:
          "Заявка отправлена на проверку. Ожидайте подтверждения оплаты."
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "MARK PAID ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Не удалось отметить оплату"
      });

    } finally {

      client.release();

    }
  }
);


// ==========================================
// API: СТАТУС ПОПОЛНЕНИЯ
// ==========================================// API: СТАТУС ПОПОЛНЕНИЯ
// ==========================================

app.post(
  "/api/topup/status",
  async (req, res) => {

    try {

      const {
        user
      } =
        await requireTelegramUser(
          req
        );

      const paymentId =
        String(
          req.body?.paymentId ||
          ""
        ).trim();

      if (!paymentId) {
        return res.status(400).json({
          ok: false,
          message:
            "Не указан ID заявки"
        });
      }

      const result =
        await pool.query(
          `
            SELECT *
            FROM topups
            WHERE id = $1
          `,
          [
            paymentId
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Заявка не найдена"
        });
      }

      const topup =
        result.rows[0];

      if (
        String(
          topup.telegram_id
        ) !==
        String(
          user.telegram_id
        )
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "Нет доступа к этой заявке"
        });
      }

      return res.json({
        ok: true,

        paymentId:
          topup.id,

        status:
          topup.status,

        amountPT:
          Number(
            topup.amount_pt
          ),

        bonusPoints:
          Number(
            topup.bonus_points
          ),

        totalPoints:
          Number(
            topup.total_points
          ),

        paymentRub:
          Number(
            topup.payment_rub
          ),

        createdAt:
          topup.created_at,

        paidAt:
          topup.paid_at,

        confirmedAt:
          topup.confirmed_at
      });

    } catch (error) {

      console.error(
        "TOPUP STATUS ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Ошибка получения статуса"
      });
    }
  }
);


// ==========================================
// ПОЛУЧИТЬ ПОЛЬЗОВАТЕЛЯ ИЗ БД
// ==========================================

async function getUserByTelegramId(
  telegramId,
  client = null
) {
  const executor =
    client || pool;

  const result =
    await executor.query(
      `
        SELECT *
        FROM users
        WHERE telegram_id = $1
      `,
      [
        String(
          telegramId
        )
      ]
    );

  if (
    !result.rows.length
  ) {
    return null;
  }

  return result.rows[0];
}


// ==========================================
// ПОДТВЕРЖДЕНИЕ ПОПОЛНЕНИЯ
// ==========================================

async function handleTopupConfirm(
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

    const topupResult =
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
      !topupResult.rows.length
    ) {
      throw new Error(
        "Заявка на пополнение не найдена"
      );
    }

    const topup =
      topupResult.rows[0];

    if (
      topup.status ===
      "completed"
    ) {
      throw new Error(
        "PT по этой заявке уже были начислены"
      );
    }

    if (
      topup.status !==
      "paid_waiting_confirmation"
    ) {
      throw new Error(
        `Нельзя подтвердить заявку в статусе: ${topup.status}`
      );
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
        "Пользователь заявки не найден"
      );
    }

    const user =
      userResult.rows[0];

    const promoCode =
      topup.promo_percent
        ? normalizePromoCode(
            topup.promo_percent
          )
        : "";

    let finalBonus = 0;

    // ========================================
    // ПРОВЕРКА ПРОЦЕНТНОГО ПРОМОКОДА
    // ========================================

    if (promoCode) {

      const promoResult =
        await calculatePercentPromo(
          user,
          promoCode
        );

      if (!promoResult.ok) {
        throw new Error(
          `Промокод ${promoCode} больше нельзя применить: ${promoResult.message}`
        );
      }

      const expectedBonus =
        Math.floor(
          Number(
            topup.amount_pt
          ) *
          (
            Number(
              promoResult.percent
            ) / 100
          )
        );

      if (
        expectedBonus !==
          Number(
            topup.bonus_points
          ) ||
        Number(
          promoResult.percent
        ) !==
          Number(
            topup.percent
          )
      ) {
        throw new Error(
          "Данные бонуса заявки не совпадают с текущими условиями промокода"
        );
      }

      finalBonus =
        expectedBonus;

      // Активируем промокод
      // только после подтверждения оплаты.
      await activatePromoCode(
        user,
        promoCode,
        client
      );
    }

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

    // Обновляем сам текст заказа в рабочем чате.
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

    // Сообщаем покупателю, что заказ уже взят.
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

    // Обновляем весь текст заказа в рабочем чате.
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
