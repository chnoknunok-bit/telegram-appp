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

  return Number(    result.rows[0].uses || 0
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
}// ==========================================
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
            user.username,        );

      const productId =
        String(
          req.body?.productId ||
          ""
        );

      const gameId =
        String(
          req.body?.gameId ||
          ""
        ).trim();

      let quantity =
        Number(
          req.body?.quantity || 1
        );

      const product =
        PRODUCTS.find(
          (item) =>
            item.id === productId
        );

      if (!product) {
        return res.status(404).json({
          ok: false,
          message:
            "Товар не найден"
        });
      }

      if (!product.available) {
        return res.status(400).json({
          ok: false,
          message:
            "Этот товар пока недоступен"
        });
      }

      if (!gameId) {
        return res.status(400).json({
          ok: false,
          message:
            "Введите Game ID"
        });
      }

      if (
        !Number.isInteger(quantity)
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Количество должно быть целым числом"
        });
      }

      if (product.quantityEnabled) {

        if (
          quantity < 1 ||
          quantity >
            product.maxQuantity
        ) {
          return res.status(400).json({
            ok: false,
            message:
              `Можно купить от 1 до ${product.maxQuantity} шт.`
          });
        }

      } else {

        quantity = 1;
      }

      const total =
        Number(product.price) *
        quantity;

      if (total <= 0) {
        return res.status(400).json({
          ok: false,
          message:
            "Цена товара некорректна"
        });
      }

      await client.query(
        "BEGIN"
      );

      const lockedResult =
        await client.query(
          `
            SELECT *
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

      if (
        !lockedResult.rows.length
      ) {
        throw new Error(
          "Пользователь не найден"
        );
      }

      const lockedUser =
        lockedResult.rows[0];

      const currentBalance =
        Number(
          lockedUser.balance || 0
        );

      if (
        currentBalance < total
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "Недостаточно PT",
          balance:
            currentBalance,
          required:
            total
        });
      }

      const orderId =
        randomId("order_");

      await client.query(
        `
          UPDATE users
          SET
            balance = balance - $1,
            updated_at = NOW()
          WHERE telegram_id = $2
        `,
        [
          total,
          String(
            lockedUser.telegram_id
          )
        ]
      );

      await client.query(
        `
          INSERT INTO orders (
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
            user_username
          )
          VALUES (
            $1,
            $2,
            'waiting',

            $3,
            $4,
            $5,
            $6,
            $7,
            $8,

            $9,
            $10,
            $11
          )
        `,
        [
          orderId,
          String(
            lockedUser.telegram_id
          ),

          product.id,
          product.name,
          quantity,
          product.price,
          total,
          gameId,

          tgUser.first_name || "",
          tgUser.last_name || "",
          tgUser.username || ""
        ]
      );

      await addTransaction({
        telegramId:
          lockedUser.telegram_id,

        type:
          "purchase",

        amount:
          -total,

        description:
          `Покупка: ${product.name} × ${quantity}`,

        orderId,

        client
      });

      const newBalance =
        currentBalance - total;

      await client.query(
        "COMMIT"
      );

      const order = {
        id: orderId,
        telegramId:
          String(
            lockedUser.telegram_id
          ),

        status:
          "waiting",

        productId:
          product.id,

        productName:
          product.name,

        quantity,

        unitPrice:
          product.price,

        total,

        gameId,

        user: {
          telegramId:
            tgUser.id,

          firstName:
            tgUser.first_name || "",

          lastName:
            tgUser.last_name || "",

          username:
            tgUser.username || ""
        }
      };

      try {

        await sendOrderToStaff(
          order
        );

        await notifyOrderWaiting(
          order
        );

      } catch (telegramError) {

        const refundClient =
          await pool.connect();

        try {

          await refundClient.query(
            "BEGIN"
          );

          const refundUser =
            await refundClient.query(
              `
                SELECT *
                FROM users
                WHERE telegram_id = $1
                FOR UPDATE
              `,
              [
                String(
                  lockedUser.telegram_id
                )
              ]
            );

          if (
            refundUser.rows.length
          ) {

            await refundClient.query(
              `
                UPDATE users
                SET
                  balance =
                    balance + $1,
                  updated_at =
                    NOW()
                WHERE telegram_id = $2
              `,
              [
                total,
                String(
                  lockedUser.telegram_id
                )
              ]
            );

            await refundClient.query(
              `
                UPDATE orders
                SET status = 'cancelled'
                WHERE id = $1
              `,
              [
                orderId
              ]
            );

            await addTransaction({
              telegramId:
                lockedUser.telegram_id,

              type:
                "refund",

              amount:
                total,

              description:
                `Возврат за заказ ${orderId}: ошибка отправки`,

              orderId,

              client:
                refundClient
            });
          }

          await refundClient.query(
            "COMMIT"
          );

        } catch (refundError) {

          try {
            await refundClient.query(
              "ROLLBACK"
            );
          } catch {}

          console.error(
            "REFUND ERROR:",
            refundError.message
          );

        } finally {

          refundClient.release();
        }

        return res.status(500).json({
          ok: false,
          message:
            "Не удалось отправить заказ сотрудникам. PT возвращены."
        });
      }

      return res.json({
        ok: true,
        message:
          "Заказ создан",

        orderId,

        balance:
          newBalance,

        order: {
          id:
            order.id,

          productName:
            order.productName,

          quantity:
            order.quantity,

          total:
            order.total,

          status:
            order.status
        }
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "BUY ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Не удалось оформить заказ"
      });

    } finally {

      client.release();
    }
  }
);


// ==========================================
// УТИЛИТЫ СТАТУСА ЗАКАЗА
// ==========================================

function getStaffDisplayName(staff) {
  const name = [
    staff?.first_name || "",
    staff?.last_name || ""
  ]
    .join(" ")
    .trim();

  if (name) {
    return name;
  }

  if (staff?.username) {
    return `@${staff.username}`;
  }

  return "Сотрудник";
}

function getStaffUsername(staff) {
  return staff?.username
    ? `@${staff.username}`
    : "без username";
}

function buildStaffOrderText(
  order,
  status = "waiting",
  staff = null
) {
  const username =
    order.user?.username
      ? `@${order.user.username}`
      : "без username";

  let statusBlock =
    "⏳ СТАТУС: В ОЖИДАНИИ";

  if (status === "claimed") {
    const staffName =
      order.claimed_by_name ||
      getStaffDisplayName(staff);

    const staffUsername =
      order.claimed_by_username
        ? `@${order.claimed_by_username}`
        : getStaffUsername(staff);

    statusBlock =
      `🟡 СТАТУС: ЗАКАЗ ВЗЯТ\n` +
      `👤 Взял: ${staffName} (${staffUsername})`;
  }

  if (status === "completed") {
    const staffName =
      order.claimed_by_name ||
      getStaffDisplayName(staff);

    const staffUsername =
      order.claimed_by_username
        ? `@${order.claimed_by_username}`
        : "без username";

    statusBlock =
      `✅ СТАТУС: ЗАКАЗ ВЫПОЛНЕН\n` +
      `👤 Выполнил: ${staffName} (${staffUsername})`;
  }

  return (
    `📦 НОВЫЙ ЗАКАЗ\n\n` +
    `🆔 Заказ: ${order.id}\n` +
    `👤 Покупатель: ${username}\n` +
    `🎮 Game ID: ${order.gameId}\n\n` +
    `📦 Товар: ${order.productName}\n` +
    `🔢 Количество: ${order.quantity}\n` +
    `💰 Сумма: ${order.total} PT\n\n` +
    `${statusBlock}`
  );
}        );

      const productId =
        String(
          req.body?.productId ||
          ""
        );

      const gameId =
        String(
          req.body?.gameId ||
          ""
        ).trim();

      let quantity =
        Number(
          req.body?.quantity || 1
        );

      const product =
        PRODUCTS.find(
          (item) =>
            item.id === productId
        );

      if (!product) {
        return res.status(404).json({
          ok: false,
          message:
            "Товар не найден"
        });
      }

      if (!product.available) {
        return res.status(400).json({
          ok: false,
          message:
            "Этот товар пока недоступен"
        });
      }

      if (!gameId) {
        return res.status(400).json({
          ok: false,
          message:
            "Введите Game ID"
        });
      }

      if (
        !Number.isInteger(quantity)
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Количество должно быть целым числом"
        });
      }

      if (product.quantityEnabled) {

        if (
          quantity < 1 ||
          quantity >
            product.maxQuantity
        ) {
          return res.status(400).json({
            ok: false,
            message:
              `Можно купить от 1 до ${product.maxQuantity} шт.`
          });
        }

      } else {

        quantity = 1;
      }

      const total =
        Number(product.price) *
        quantity;

      if (total <= 0) {
        return res.status(400).json({
          ok: false,
          message:
            "Цена товара некорректна"
        });
      }

      await client.query(
        "BEGIN"
      );

      const lockedResult =
        await client.query(
          `
            SELECT *
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

      if (
        !lockedResult.rows.length
      ) {
        throw new Error(
          "Пользователь не найден"
        );
      }

      const lockedUser =
        lockedResult.rows[0];

      const currentBalance =
        Number(
          lockedUser.balance || 0
        );

      if (
        currentBalance < total
      ) {

        await client.query(
          "ROLLBACK"
        );

        return res.status(400).json({
          ok: false,
          message:
            "Недостаточно PT",
          balance:
            currentBalance,
          required:
            total
        });
      }

      const orderId =
        randomId("order_");

      await client.query(
        `
          UPDATE users
          SET
            balance = balance - $1,
            updated_at = NOW()
          WHERE telegram_id = $2
        `,
        [
          total,
          String(
            lockedUser.telegram_id
          )
        ]
      );

      await client.query(
        `
          INSERT INTO orders (
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
            user_username
          )
          VALUES (
            $1,
            $2,
            'waiting',

            $3,
            $4,
            $5,
            $6,
            $7,
            $8,

            $9,
            $10,
            $11
          )
        `,
        [
          orderId,
          String(
            lockedUser.telegram_id
          ),

          product.id,
          product.name,
          quantity,
          product.price,
          total,
          gameId,

          tgUser.first_name || "",
          tgUser.last_name || "",
          tgUser.username || ""
        ]
      );

      await addTransaction({
        telegramId:
          lockedUser.telegram_id,

        type:
          "purchase",

        amount:
          -total,

        description:
          `Покупка: ${product.name} × ${quantity}`,

        orderId,

        client
      });

      const newBalance =
        currentBalance - total;

      await client.query(
        "COMMIT"
      );

      const order = {
        id: orderId,
        telegramId:
          String(
            lockedUser.telegram_id
          ),

        status:
          "waiting",

        productId:
          product.id,

        productName:
          product.name,

        quantity,

        unitPrice:
          product.price,

        total,

        gameId,

        user: {
          telegramId:
            tgUser.id,

          firstName:
            tgUser.first_name || "",

          lastName:
            tgUser.last_name || "",

          username:
            tgUser.username || ""
        }
      };

      try {

        await sendOrderToStaff(
          order
        );

        // Уведомление покупателю не влияет на сам заказ:
        // если сообщение не отправится, заказ всё равно остаётся создан.
        await notifyOrderWaiting(
          order
        );

      } catch (telegramError) {

        const refundClient =
          await pool.connect();

        try {

          await refundClient.query(
            "BEGIN"
          );

          const refundUser =
            await refundClient.query(
              `
                SELECT *
                FROM users
                WHERE telegram_id = $1
                FOR UPDATE
              `,
              [
                String(
                  lockedUser.telegram_id
                )
              ]
            );

          if (
            refundUser.rows.length
          ) {

            await refundClient.query(
              `
                UPDATE users
                SET
                  balance =
                    balance + $1,
                  updated_at =
                    NOW()
                WHERE telegram_id = $2
              `,
              [
                total,
                String(
                  lockedUser.telegram_id
                )
              ]
            );

            await refundClient.query(
              `
                UPDATE orders
                SET status = 'cancelled'
                WHERE id = $1
              `,
              [
                orderId
              ]
            );

            await addTransaction({
              telegramId:
                lockedUser.telegram_id,

              type:
                "refund",

              amount:
                total,

              description:
                `Возврат за заказ ${orderId}: ошибка отправки`,

              orderId,

              client:
                refundClient
            });
          }

          await refundClient.query(
            "COMMIT"
          );

        } catch (refundError) {

          try {
            await refundClient.query(
              "ROLLBACK"
            );
          } catch {}

          console.error(
            "REFUND ERROR:",
            refundError.message
          );

        } finally {

          refundClient.release();
        }

        return res.status(500).json({
          ok: false,
          message:
            "Не удалось отправить заказ сотрудникам. PT возвращены."
        });
      }

      return res.json({
        ok: true,
        message:
          "Заказ создан",

        orderId,

        balance:
          newBalance,

        order: {
          id:
            order.id,

          productName:
            order.productName,

          quantity:
            order.quantity,

          total:
            order.total,

          status:
            order.status
        }
      });

    } catch (error) {

      try {
        await client.query(
          "ROLLBACK"
        );
      } catch {}

      console.error(
        "BUY ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Не удалось оформить заказ"
      });

    } finally {

      client.release();
    }
  }
);


// ==========================================
// УТИЛИТЫ СТАТУСА ЗАКАЗА
// ==========================================

function getStaffDisplayName(staff) {
  const name = [
    staff?.first_name || "",
    staff?.last_name || ""
  ]
    .join(" ")
    .trim();

  if (name) {
    return name;
  }

  if (staff?.username) {
    return `@${staff.username}`;
  }

  return "Сотрудник";
}

function getStaffUsername(staff) {
  return staff?.username
    ? `@${staff.username}`
    : "без username";
}

function buildStaffOrderText(
  order,
  status = "waiting",
  staff = null
) {
  const username =
    order.user?.username
      ? `@${order.user.username}`
      : "без username";

  let statusBlock =
    "⏳ СТАТУС: В ОЖИДАНИИ";

  if (status === "claimed") {
    const staffName =
      order.claimed_by_name ||
      getStaffDisplayName(staff);

    const staffUsername =
      order.claimed_by_username
        ? `@${order.claimed_by_username}`
        : getStaffUsername(staff);

    statusBlock =
      `🟡 СТАТУС: ЗАКАЗ ВЗЯТ\n` +
      `👤 Взял: ${staffName} (${staffUsername})`;
  }

  if (status === "completed") {
    const staffName =
      order.claimed_by_name ||
      getStaffDisplayName(staff);

    const staffUsername =
      order.claimed_by_username
        ? `@${order.claimed_by_username}`
        : "без username";

    statusBlock =
      `✅ СТАТУС: ЗАКАЗ ВЫПОЛНЕН\n` +
      `👤 Выполнил: ${staffName} (${staffUsername})`;
  }

  return (
    `📦 НОВЫЙ ЗАКАЗ\n\n` +
    `🆔 Заказ: ${order.id}\n` +
    `👤 Покупатель: ${username}\n` +
    `🎮 Game ID: ${order.gameId}\n\n` +
    `📦 Товар: ${order.productName}\n` +
    `🔢 Количество: ${order.quantity}\n` +
    `💰 Сумма: ${order.total} PT\n\n` +
    `${statusBlock}`
  );
}            percent,
            payment_rub,
            status,
            created_at
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
            NOW()
          )
        `,
        [
          paymentId,
          user.telegram_id,
          amount,
          bonusPoints,
          totalPoints,
          promoPercent || null,
          percent,
          paymentRub
        ]
      );

      const topup =
        {
          id:
            paymentId,

          telegramId:
            user.telegram_id,

          paymentRub:
            paymentRub,

          totalPoints:
            totalPoints,

          bonusPoints:
            bonusPoints,

          promoPercent:
            promoPercent || null,

          user:
            {
              username:
                user.username || "",

              firstName:
                user.first_name || "",

              lastName:
                user.last_name || ""
            }
        };

      try {
        await sendTopupToPaymentChat(
          topup
        );
      } catch (sendError) {

        await pool.query(
          `
            UPDATE topups
            SET status = 'rejected'
            WHERE id = $1
          `,
          [
            paymentId
          ]
        );

        throw sendError;
      }

      return res.json({
        ok: true,

        payment: {
          id:
            paymentId,

          amountPt:
            amount,

          bonusPoints:
            bonusPoints,

          totalPoints:
            totalPoints,

          paymentRub:
            paymentRub,

          card:
            PAYMENT_CARD,

          recipient:
            PAYMENT_RECIPIENT,

          status:
            "waiting_payment"
        }
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
          "Ошибка создания заявки"
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
            SELECT
              id,
              telegram_id,
              amount_pt,
              bonus_points,
              total_points,
              promo_percent,
              percent,
              payment_rub,
              status,
              created_at
            FROM topups
            WHERE id = $1
          `,
          [
            paymentId
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          message:
            "Заявка не найдена"
        });
      }

      const topup =
        result.rows[0];

      if (
        String(topup.telegram_id) !==
        String(user.telegram_id)
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "Нет доступа к этой заявке"
        });
      }

      if (
        topup.status ===
        "completed"
      ) {
        return res.json({
          ok: true,
          status:
            "completed",
          message:
            "Заявка уже подтверждена"
        });
      }

      if (
        topup.status ===
        "rejected"
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Заявка уже отклонена"
        });
      }

      if (
        topup.status ===
        "paid_waiting_confirmation"
      ) {
        return res.json({
          ok: true,
          status:
            "paid_waiting_confirmation",
          message:
            "Оплата уже отмечена. Ожидайте подтверждения."
        });
      }

      await pool.query(
        `
          UPDATE topups
          SET status = 'paid_waiting_confirmation'
          WHERE id = $1
            AND telegram_id = $2
            AND status = 'waiting_payment'
        `,
        [
          paymentId,
          user.telegram_id
        ]
      );

      return res.json({
        ok: true,

        status:
          "paid_waiting_confirmation",

        message:
          "Оплата отмечена. Ожидайте подтверждения сотрудником."
      });

    } catch (error) {

      console.error(
        "TOPUP MARK PAID ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Ошибка отметки оплаты"
      });
    }
  }
);


// ==========================================
// API: ПРОВЕРКА СТАТУСА ПОПОЛНЕНИЯ
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
            SELECT
              id,
              telegram_id,
              amount_pt,
              bonus_points,
              total_points,
              promo_percent,
              percent,
              payment_rub,
              status,
              created_at,
              completed_at
            FROM topups
            WHERE id = $1
          `,
          [
            paymentId
          ]
        );

      if (!result.rows.length) {
        return res.status(404).json({
          ok: false,
          message:
            "Заявка не найдена"
        });
      }

      const topup =
        result.rows[0];

      if (
        String(topup.telegram_id) !==
        String(user.telegram_id)
      ) {
        return res.status(403).json({
          ok: false,
          message:
            "Нет доступа к этой заявке"
        });
      }

      return res.json({
        ok: true,

        topup: {
          id:
            topup.id,

          amountPt:
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
              topup.percent || 0
            ),

          paymentRub:
            Number(
              topup.payment_rub
            ),

          status:
            topup.status,

          createdAt:
            topup.created_at,

          completedAt:
            topup.completed_at
        }
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
          "Ошибка получения статуса пополнения"
      });
    }
  }
);


// ==========================================
// TELEGRAM CALLBACK: ПОПОЛНЕНИЕ
// ==========================================

async function handleTopupConfirm(
  callbackQuery,
  paymentId
) {

  if (
    !PAYMENT_CHAT_ID ||
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(PAYMENT_CHAT_ID)
  ) {
    return;
  }

  const result =
    await pool.query(
      `
        SELECT
          id,
          telegram_id,
          amount_pt,
          bonus_points,
          total_points,
          promo_percent,
          status
        FROM topups
        WHERE id = $1
      `,
      [
        paymentId
      ]
    );

  if (!result.rows.length) {

    await answerCallback(
      callbackQuery.id,
      "Заявка не найдена",
      true
    );

    return;
  }

  const topup =
    result.rows[0];

  if (
    topup.status ===
    "completed"
  ) {

    await answerCallback(
      callbackQuery.id,
      "Эта заявка уже зачислена",
      true
    );

    return;
  }

  if (
    topup.status ===
    "rejected"
  ) {

    await answerCallback(
      callbackQuery.id,
      "Эта заявка уже отклонена",
      true
    );

    return;
  }

  if (
    topup.status !==
      "paid_waiting_confirmation" &&
    topup.status !==
      "waiting_payment"
  ) {

    await answerCallback(
      callbackQuery.id,
      "Нельзя подтвердить эту заявку",
      true
    );

    return;
  }

  const client =
    await pool.connect();

  try {

    await client.query(
      "BEGIN"
    );

    const locked =
      await client.query(
        `
          SELECT
            id,
            telegram_id,
            amount_pt,
            bonus_points,
            total_points,
            promo_percent,
            status
          FROM topups
          WHERE id = $1
          FOR UPDATE
        `,
        [
          paymentId
        ]
      );

    if (!locked.rows.length) {
      throw new Error(
        "Заявка не найдена"
      );
    }

    const lockedTopup =
      locked.rows[0];

    if (
      lockedTopup.status ===
      "completed"
    ) {

      await client.query(
        "ROLLBACK"
      );

      await answerCallback(
        callbackQuery.id,
        "Эта заявка уже зачислена",
        true
      );

      return;
    }

    await client.query(
      `
        UPDATE users
        SET balance = balance + $1
        WHERE telegram_id = $2
      `,
      [
        Number(
          lockedTopup.total_points
        ),
        lockedTopup.telegram_id
      ]
    );

    await client.query(
      `
        UPDATE topups
        SET
          status = 'completed',
          completed_at = NOW()
        WHERE id = $1
      `,
      [
        paymentId
      ]
    );

    await client.query(
      "COMMIT"
    );

    await answerCallback(
      callbackQuery.id,
      "PT успешно зачислены",
      false
    );

    try {

      await telegramRequest(
        "sendMessage",
        {
          chat_id:
            lockedTopup.telegram_id,

          text:
            `✅ Пополнение подтверждено!\n\n` +
            `💎 Зачислено: ${lockedTopup.total_points} PT\n` +
            `🎁 Бонус: ${lockedTopup.bonus_points} PT\n\n` +
            `🧾 Заявка: ${lockedTopup.id}`
        }
      );

    } catch (notifyError) {

      console.error(
        "TOPUP CONFIRM NOTIFY ERROR:",
        notifyError.message
      );
    }

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch (_) {}

    console.error(
      "TOPUP CONFIRM ERROR:",
      error.message
    );

    await answerCallback(
      callbackQuery.id,
      "Ошибка при зачислении",
      true
    );

  } finally {

    client.release();
  }
}


async function handleTopupReject(
  callbackQuery,
  paymentId
) {

  if (
    !PAYMENT_CHAT_ID ||
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(PAYMENT_CHAT_ID)
  ) {
    return;
  }

  const result =
    await pool.query(
      `
        SELECT
          id,
          telegram_id,
          status
        FROM topups
        WHERE id = $1
      `,
      [
        paymentId
      ]
    );

  if (!result.rows.length) {

    await answerCallback(
      callbackQuery.id,
      "Заявка не найдена",
      true
    );

    return;
  }

  const topup =
    result.rows[0];

  if (
    topup.status ===
    "completed"
  ) {

    await answerCallback(
      callbackQuery.id,
      "Заявка уже зачислена",
      true
    );

    return;
  }

  if (
    topup.status ===
    "rejected"
  ) {

    await answerCallback(
      callbackQuery.id,
      "Заявка уже отклонена",
      true
    );

    return;
  }

  await pool.query(
    `
      UPDATE topups
      SET status = 'rejected'
      WHERE id = $1
    `,
    [
      paymentId
    ]
  );

  await answerCallback(
    callbackQuery.id,
    "Заявка отклонена",
    false
  );

  try {

    await telegramRequest(
      "sendMessage",
      {
        chat_id:
          topup.telegram_id,

        text:
          `❌ Пополнение отклонено.\n\n` +
          `🧾 Заявка: ${topup.id}\n\n` +
          `Если вы уверены, что оплатили, обратитесь к сотруднику.`
      }
    );

  } catch (notifyError) {

    console.error(
      "TOPUP REJECT NOTIFY ERROR:",
      notifyError.message
    );
  }
}


// ==========================================
// TELEGRAM CALLBACK: ЗАКАЗ
// ==========================================

async function handleOrderClaim(
  callbackQuery,
  orderId
) {

  if (!STAFF_CHAT_ID) {
    return;
  }

  if (
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(STAFF_CHAT_ID)
  ) {
    return;
  }

  const staff =
    callbackQuery.from;

  const staffId =
    String(
      staff.id
    );

  const staffName =
    getStaffDisplayName(
      staff
    );

  const staffUsername =
    staff.username || "";

  const client =
    await pool.connect();

  let order;

  try {

    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
          SELECT
            *
          FROM orders
          WHERE id = $1
          FOR UPDATE
        `,
        [
          orderId
        ]
      );

    if (!result.rows.length) {

      await client.query(
        "ROLLBACK"
      );

      await answerCallback(
        callbackQuery.id,
        "Заказ не найден",
        true
      );

      return;
    }

    order =
      result.rows[0];

    if (
      order.status !==
      "waiting"
    ) {

      await client.query(
        "ROLLBACK"
      );

      await answerCallback(
        callbackQuery.id,
        "Этот заказ уже взят или выполнен",
        true
      );

      return;
    }

    const updated =
      await client.query(
        `
          UPDATE orders
          SET
            status = 'claimed',
            claimed_by_id = $1,
            claimed_by_name = $2,
            claimed_by_username = $3,
            claimed_at = NOW()
          WHERE id = $4
            AND status = 'waiting'
          RETURNING *
        `,
        [
          staffId,
          staffName,
          staffUsername,
          orderId
        ]
      );

    if (!updated.rows.length) {

      await client.query(
        "ROLLBACK"
      );

      await answerCallback(
        callbackQuery.id,
        "Заказ уже взял другой сотрудник",
        true
      );

      return;
    }

    order =
      updated.rows[0];

    await client.query(
      "COMMIT"
    );

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch (_) {}

    console.error(
      "ORDER CLAIM ERROR:",
      error.message
    );

    await answerCallback(
      callbackQuery.id,
      "Ошибка при взятии заказа",
      true
    );

    return;

  } finally {

    client.release();
  }

  await answerCallback(
    callbackQuery.id,
    "Заказ взят",
    false
  );

  try {

    await telegramRequest(
      "editMessageText",
      {
        chat_id:
          STAFF_CHAT_ID,

        message_id:
          callbackQuery.message.message_id,

        text:
          buildStaffOrderText(
            order,
            "claimed",
            staff
          ),

        reply_markup: {
          inline_keyboard: [
            [
              {
                text:
                  "✅ ЗАВЕРШИТЬ ЗАКАЗ",
                callback_data:
                  `complete:${order.id}`
              }
            ]
          ]
        }
      }
    );

  } catch (editError) {

    console.error(
      "ORDER CLAIM EDIT ERROR:",
      editError.message
    );
  }

  await notifyOrderClaimed(
    order,
    staffName,
    staffUsername
  );
}


async function handleOrderComplete(
  callbackQuery,
  orderId
) {

  if (!STAFF_CHAT_ID) {
    return;
  }

  if (
    String(
      callbackQuery.message?.chat?.id
    ) !==
    String(STAFF_CHAT_ID)
  ) {
    return;
  }

  const staff =
    callbackQuery.from;

  const staffId =
    String(
      staff.id
    );

  const client =
    await pool.connect();

  let order;

  try {

    await client.query(
      "BEGIN"
    );

    const result =
      await client.query(
        `
          SELECT
            *
          FROM orders
          WHERE id = $1
          FOR UPDATE
        `,
        [
          orderId
        ]
      );

    if (!result.rows.length) {

      await client.query(
        "ROLLBACK"
      );

      await answerCallback(
        callbackQuery.id,
        "Заказ не найден",
        true
      );

      return;
    }

    order =
      result.rows[0];

    if (
      order.status !==
      "claimed"
    ) {

      await client.query(
        "ROLLBACK"
      );

      await answerCallback(
        callbackQuery.id,
        "Заказ нельзя завершить",
        true
      );

      return;
    }

    if (
      String(
        order.claimed_by_id
      ) !==
      staffId
    ) {

      await client.query(
        "ROLLBACK"
      );

      await answerCallback(
        callbackQuery.id,
        "Завершить заказ может только сотрудник, который его взял",
        true
      );

      return;
    }

    const updated =
      await client.query(
        `
          UPDATE orders
          SET
            status = 'completed',
            completed_at = NOW()
          WHERE id = $1
            AND status = 'claimed'
            AND claimed_by_id = $2
          RETURNING *
        `,
        [
          orderId,
          staffId
        ]
      );

    if (!updated.rows.length) {

      await client.query(
        "ROLLBACK"
      );

      await answerCallback(
        callbackQuery.id,
        "Не удалось завершить заказ",
        true
      );

      return;
    }

    order =
      updated.rows[0];

    await client.query(
      "COMMIT"
    );

  } catch (error) {

    try {
      await client.query(
        "ROLLBACK"
      );
    } catch (_) {}

    console.error(
      "ORDER COMPLETE ERROR:",
      error.message
    );

    await answerCallback(
      callbackQuery.id,
      "Ошибка при завершении заказа",
      true
    );

    return;

  } finally {

    client.release();
  }

  await answerCallback(
    callbackQuery.id,
    "Заказ выполнен",
    false
  );

  try {

    await telegramRequest(
      "editMessageText",
      {
        chat_id:
          STAFF_CHAT_ID,

        message_id:
          callbackQuery.message.message_id,

        text:
          buildStaffOrderText(
            order,
            "completed",
            staff
          ),

        reply_markup: {
          inline_keyboard: []
        }
      }
    );

  } catch (editError) {

    console.error(
      "ORDER COMPLETE EDIT ERROR:",
      editError.message
    );
  }

  await notifyOrderCompleted(
    order
  );
}      const staffName =
        [
          staff.first_name || "",
          staff.last_name || ""
        ]
          .join(" ")
          .trim() ||
          "Сотрудник";

      try {

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
                      "❌ ЗАЯВКА ОТКЛОНЕНА",
                    callback_data:
                      "noop"
                  }
                ]
              ]
            }
          }
        );

      } catch (editError) {

        console.error(
          "EDIT REJECT TOPUP ERROR:",
          editError.message
        );
      }

      try {

        await telegramRequest(
          "sendMessage",
          {
            chat_id:
              topup.telegram_id,

            text:
              `❌ Пополнение отклонено.\n\n` +
              `💰 Сумма: ${topup.payment_rub} ₽\n` +
              `💎 Заявлено: ${topup.total_points} PT\n\n` +
              `👤 Проверил: ${staffName}\n\n` +
              `🧾 Заявка: ${topup.id}`
          }
        );

      } catch (notifyError) {

        console.error(
          "NOTIFY TOPUP REJECT ERROR:",
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
// TELEGRAM CALLBACK
// ==========================================

async function handleCallbackQuery(
  callbackQuery
) {

  const data =
    String(
      callbackQuery.data || ""
    );

  if (!data) {
    return;
  }

  if (
    data === "noop"
  ) {

    await answerCallback(
      callbackQuery.id
    );

    return;
  }

  if (
    data.startsWith(
      "topup_confirm:"
    )
  ) {

    const paymentId =
      data
        .slice(
          "topup_confirm:".length
        )
        .trim();

    try {

      const result =
        await handleTopupConfirm(
          callbackQuery,
          paymentId
        );

      await answerCallback(
        callbackQuery.id,
        `Зачислено ${result.totalPoints} PT`,
        false
      );

    } catch (error) {

      console.error(
        "TOPUP CONFIRM CALLBACK ERROR:",
        error.message
      );

      await answerCallback(
        callbackQuery.id,
        error.message ||
        "Ошибка подтверждения",
        true
      );
    }

    return;
  }

  if (
    data.startsWith(
      "topup_reject:"
    )
  ) {

    const paymentId =
      data
        .slice(
          "topup_reject:".length
        )
        .trim();

    try {

      const result =
        await handleTopupReject(
          callbackQuery,
          paymentId
        );

      await answerCallback(
        callbackQuery.id,
        "Заявка отклонена",
        false
      );

    } catch (error) {

      console.error(
        "TOPUP REJECT CALLBACK ERROR:",
        error.message
      );

      await answerCallback(
        callbackQuery.id,
        error.message ||
        "Ошибка отклонения",
        true
      );
    }

    return;
  }

  if (
    data.startsWith(
      "claim:"
    )
  ) {

    const orderId =
      data
        .slice(
          "claim:".length
        )
        .trim();

    try {

      await handleOrderClaim(
        callbackQuery,
        orderId
      );

    } catch (error) {

      console.error(
        "ORDER CLAIM CALLBACK ERROR:",
        error.message
      );

      await answerCallback(
        callbackQuery.id,
        error.message ||
        "Ошибка взятия заказа",
        true
      );
    }

    return;
  }

  if (
    data.startsWith(
      "complete:"
    )
  ) {

    const orderId =
      data
        .slice(
          "complete:".length
        )
        .trim();

    try {

      await handleOrderComplete(
        callbackQuery,
        orderId
      );

    } catch (error) {

      console.error(
        "ORDER COMPLETE CALLBACK ERROR:",
        error.message
      );

      await answerCallback(
        callbackQuery.id,
        error.message ||
        "Ошибка завершения заказа",
        true
      );
    }

    return;
  }

  await answerCallback(
    callbackQuery.id
  );
}


// ==========================================
// TELEGRAM UPDATES
// ==========================================

async function processTelegramUpdate(
  update
) {

  if (
    update.callback_query
  ) {

    await handleCallbackQuery(
      update.callback_query
    );

    return;
  }

  if (
    update.message
  ) {

    await handleTelegramMessage(
      update.message
    );

    return;
  }
}


// ==========================================
// TELEGRAM POLLING
// ==========================================

let telegramOffset = 0;

async function telegramPollingLoop() {

  if (!BOT_TOKEN) {

    console.error(
      "❌ BOT_TOKEN не настроен"
    );

    return;
  }

  while (true) {

    try {

      const updates =
        await telegramRequest(
          "getUpdates",
          {
            offset:
              telegramOffset,

            timeout:
              25,

            allowed_updates: [
              "message",
              "callback_query"
            ]
          }
        );

      if (
        Array.isArray(updates)
      ) {

        for (
          const update of updates
        ) {

          telegramOffset =
            update.update_id + 1;

          try {

            await processTelegramUpdate(
              update
            );

          } catch (updateError) {

            console.error(
              "TELEGRAM UPDATE ERROR:",
              updateError.message
            );
          }
        }
      }

    } catch (error) {

      console.error(
        "TELEGRAM POLLING ERROR:",
        error.message
      );

      await sleep(
        3000
      );
    }
  }
}


// ==========================================
// START SERVER
// ==========================================

app.get(
  "/",
  (req, res) => {

    res.json({
      ok: true,
      service:
        "СК МЕТРОШОП API",
      time:
        new Date().toISOString()
    });
  }
);


app.get(
  "/health",
  async (req, res) => {

    try {

      await pool.query(
        "SELECT 1"
      );

      return res.json({
        ok: true,
        database:
          "connected"
      });

    } catch (error) {

      return res.status(500).json({
        ok: false,
        database:
          "error",
        message:
          error.message
      });
    }
  }
);


async function startServer() {

  try {

    await initDatabase();

    app.listen(
      PORT,
      () => {

        console.log(
          `🚀 Server started on port ${PORT}`
        );

        console.log(
          `💎 PT_RUB_RATE: ${PT_RUB_RATE}`
        );

        console.log(
          `👥 STAFF_CHAT_ID: ${STAFF_CHAT_ID || "не настроен"}`
        );

        console.log(
          `💳 PAYMENT_CHAT_ID: ${PAYMENT_CHAT_ID || "не настроен"}`
        );
      }
    );

    telegramPollingLoop()
      .catch(
        (error) => {
          console.error(
            "FATAL TELEGRAM LOOP ERROR:",
            error.message
          );
        }
      );

  } catch (error) {

    console.error(
      "❌ SERVER START ERROR:",
      error
    );

    process.exit(
      1
    );
  }
}


startServer();    await telegramRequest(
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
                  "❌ ЗАЯВКА ОТКЛОНЕНА",

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
            `❌ Пополнение отклонено.\n\n` +
            `💰 Сумма: ${topup.payment_rub} ₽\n` +
            `💎 Заявлено: ${topup.total_points} PT\n\n` +
            `👤 Проверил: ${staffName}\n\n` +
            `🧾 Заявка: ${topup.id}`
        }
      );

    } catch (notifyError) {

      console.error(
        "NOTIFY TOPUP REJECT ERROR:",
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
// ПОЛЬЗОВАТЕЛЬСКИЕ ЗАКАЗЫ
// ==========================================

app.post(
  "/api/order/create",
  async (req, res) => {

    try {

      const {
        user
      } =
        await requireTelegramUser(
          req
        );

      const productId =
        String(
          req.body?.productId ||
          ""
        ).trim();

      const quantity =
        Math.max(
          1,
          Number(
            req.body?.quantity || 1
          )
        );

      if (!productId) {
        return res.status(400).json({
          ok: false,
          message:
            "Не выбран товар"
        });
      }

      if (
        !Number.isInteger(
          quantity
        ) ||
        quantity < 1
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Некорректное количество"
        });
      }

      const product =
        PRODUCTS.find(
          item =>
            String(item.id) ===
            productId
        );

      if (!product) {
        return res.status(404).json({
          ok: false,
          message:
            "Товар не найден"
        });
      }

      if (
        product.available ===
        false
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Этот товар сейчас недоступен"
        });
      }

      if (
        product.quantityEnabled &&
        product.maxQuantity &&
        quantity >
          Number(
            product.maxQuantity
          )
      ) {
        return res.status(400).json({
          ok: false,
          message:
            `Максимальное количество: ${product.maxQuantity}`
        });
      }

      const totalPrice =
        Number(
          product.price || 0
        ) *
        quantity;

      if (
        !Number.isFinite(
          totalPrice
        ) ||
        totalPrice <= 0
      ) {
        return res.status(400).json({
          ok: false,
          message:
            "Некорректная цена товара"
        });
      }

      const client =
        await pool.connect();

      let order;

      try {

        await client.query(
          "BEGIN"
        );

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
                user.telegram_id
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

        const dbUser =
          userResult.rows[0];

        const balance =
          Number(
            dbUser.balance || 0
          );

        if (
          balance <
          totalPrice
        ) {
          throw new Error(
            `Недостаточно PT. Нужно ${totalPrice} PT, у вас ${balance} PT`
          );
        }

        const orderId =
          generateOrderId();

        const newBalance =
          balance -
          totalPrice;

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
            "purchase",

          amount:
            -totalPrice,

          description:
            `Покупка: ${product.name}` +
            (
              quantity > 1
                ? ` × ${quantity}`
                : ""
            ),

          orderId,

          client
        });

        const insertResult =
          await client.query(
            `
              INSERT INTO orders (
                id,
                telegram_id,
                product_id,
                product_name,
                quantity,
                price,
                total_price,
                status,
                created_at
              )
              VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                'waiting',
                NOW()
              )
              RETURNING *
            `,
            [
              orderId,

              String(
                user.telegram_id
              ),

              String(
                product.id
              ),

              product.name,

              quantity,

              Number(
                product.price
              ),

              totalPrice
            ]
          );

        order =
          insertResult.rows[0];

        await client.query(
          "COMMIT"
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

      try {

        await sendOrderToStaff(
          order
        );

      } catch (staffError) {

        console.error(
          "SEND ORDER TO STAFF ERROR:",
          staffError.message
        );
      }

      return res.json({
        ok: true,

        order: {
          id:
            order.id,

          productId:
            order.product_id,

          productName:
            order.product_name,

          quantity:
            Number(
              order.quantity
            ),

          price:
            Number(
              order.price
            ),

          totalPrice:
            Number(
              order.total_price
            ),

          status:
            "waiting"
        }
      });

    } catch (error) {

      console.error(
        "ORDER CREATE ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Ошибка создания заказа"
      });
    }
  }
);


// ==========================================
// ПОЛУЧЕНИЕ ЗАКАЗОВ ПОЛЬЗОВАТЕЛЯ
// ==========================================

app.post(
  "/api/orders",
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
              product_id,
              product_name,
              quantity,
              price,
              total_price,
              status,
              claimed_by_name,
              claimed_by_username,
              claimed_at,
              completed_at,
              created_at
            FROM orders
            WHERE telegram_id = $1
            ORDER BY created_at DESC
          `,
          [
            String(
              user.telegram_id
            )
          ]
        );

      const orders =
        result.rows.map(
          order => ({
            id:
              order.id,

            productId:
              order.product_id,

            productName:
              order.product_name,

            quantity:
              Number(
                order.quantity
              ),

            price:
              Number(
                order.price
              ),

            totalPrice:
              Number(
                order.total_price
              ),

            status:
              order.status,

            claimedBy:
              order.claimed_by_name
                ? {
                    name:
                      order.claimed_by_name,

                    username:
                      order.claimed_by_username ||
                      ""
                  }
                : null,

            claimedAt:
              order.claimed_at,

            completedAt:
              order.completed_at,

            createdAt:
              order.created_at
          })
        );

      return res.json({
        ok: true,
        orders
      });

    } catch (error) {

      console.error(
        "GET ORDERS ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Ошибка получения заказов"
      });
    }
  }
);


// ==========================================
// ПОЛУЧЕНИЕ ОДНОГО ЗАКАЗА
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
            "Не указан заказ"
        });
      }

      const result =
        await pool.query(
          `
            SELECT
              id,
              telegram_id,
              product_id,
              product_name,
              quantity,
              price,
              total_price,
              status,
              claimed_by_name,
              claimed_by_username,
              claimed_at,
              completed_at,
              created_at
            FROM orders
            WHERE id = $1
              AND telegram_id = $2
          `,
          [
            orderId,

            String(
              user.telegram_id
            )
          ]
        );

      if (
        !result.rows.length
      ) {
        return res.status(404).json({
          ok: false,
          message:
            "Заказ не найден"
        });
      }

      const order =
        result.rows[0];

      return res.json({
        ok: true,

        order: {
          id:
            order.id,

          productId:
            order.product_id,

          productName:
            order.product_name,

          quantity:
            Number(
              order.quantity
            ),

          price:
            Number(
              order.price
            ),

          totalPrice:
            Number(
              order.total_price
            ),

          status:
            order.status,

          claimedBy:
            order.claimed_by_name
              ? {
                  name:
                    order.claimed_by_name,

                  username:
                    order.claimed_by_username ||
                    ""
                }
              : null,

          claimedAt:
            order.claimed_at,

          completedAt:
            order.completed_at,

          createdAt:
            order.created_at
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
// ОТМЕНА ЗАКАЗА
// ==========================================

app.post(
  "/api/order/cancel",
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
            "Не указан заказ"
        });
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
                AND telegram_id = $2
              FOR UPDATE
            `,
            [
              orderId,

              String(
                user.telegram_id
              )
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
            "Этот заказ уже нельзя отменить"
          );
        }

        const refund =
          Number(
            order.total_price || 0
          );

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
                user.telegram_id
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

        const currentUser =
          userResult.rows[0];

        const newBalance =
          Number(
            currentUser.balance || 0
          ) +
          refund;

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
            "refund",

          amount:
            refund,

          description:
            `Возврат за отмену заказа ${order.id}`,

          orderId:
            order.id,

          client
        });

        await client.query(
          `
            UPDATE orders
            SET
              status = 'cancelled',
              cancelled_at = NOW()
            WHERE id = $1
          `,
          [
            order.id
          ]
        );

        await client.query(
          "COMMIT"
        );

        return res.json({
          ok: true,

          balance:
            newBalance,

          orderId:
            order.id,

          status:
            "cancelled"
        });

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

    } catch (error) {

      console.error(
        "ORDER CANCEL ERROR:",
        error.message
      );

      return res.status(400).json({
        ok: false,
        message:
          error.message ||
          "Ошибка отмены заказа"
      });
    }
  }
);    await telegramRequest(
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


startServer();
