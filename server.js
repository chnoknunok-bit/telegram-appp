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


/* =========================================================
   НАСТРОЙКИ
   ========================================================= */

const PORT = process.env.PORT || 3000;

const BOT_TOKEN =
  process.env.BOT_TOKEN || "";

const STAFF_CHAT_ID =
  process.env.STAFF_CHAT_ID || "";


/* =========================================================
   URL API
   ========================================================= */

const API_BASE =
  "https://telegram-appp.onrender.com";


/* =========================================================
   ТОВАРЫ
   ========================================================= */

const PRODUCTS = [

  {
    name: "Набор Фулл 6 + МК вк на обвесах",
    price: 25,
    quantityEnabled: true,
    maxQuantity: 10,
    escort: false
  },

  {
    name: "Набор фулл 6",
    price: 18,
    quantityEnabled: true,
    maxQuantity: 10,
    escort: false
  },

  {
    name: "Оружие МК вк",
    price: 0,
    quantityEnabled: false,
    maxQuantity: 1,
    escort: false
  },

  {
    name: "Сопровождение 7кк + вещи",
    price: 0,
    quantityEnabled: false,
    maxQuantity: 1,
    escort: true
  },

  {
    name: "Сопровождение 15кк + вещи",
    price: 0,
    quantityEnabled: false,
    maxQuantity: 1,
    escort: true
  },

  {
    name: "Сопровождение 20кк + вещи",
    price: 0,
    quantityEnabled: false,
    maxQuantity: 1,
    escort: true
  },

  {
    name: "Сопровождение 25кк + вещи",
    price: 0,
    quantityEnabled: false,
    maxQuantity: 1,
    escort: true
  }

];


/* =========================================================
   ПОЛЬЗОВАТЕЛИ / ЗАКАЗЫ / ТРАНЗАКЦИИ
   ========================================================= */

const users =
  new Map();

const orders =
  new Map();

const transactions =
  new Map();


/* =========================================================
   ПРОМОКОДЫ
   ========================================================= */

const PROMOCODES = {

  /*
   * Промокод только на процент к пополнению.
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
   * Промокоды только на фиксированный бонус PT.
   */

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


/* =========================================================
   НОРМАЛИЗАЦИЯ ПРОМОКОДА
   ========================================================= */

function normalizePromoCode(code) {

  return String(code || "")
    .trim()
    .toUpperCase();

}


/* =========================================================
   ПРОВЕРКА TELEGRAM INIT DATA
   ========================================================= */

function checkTelegramData(initData) {

  if (!initData) {
    throw new Error(
      "Не передан Telegram initData."
    );
  }

  if (!BOT_TOKEN) {
    throw new Error(
      "BOT_TOKEN не настроен на сервере."
    );
  }


  const params =
    new URLSearchParams(initData);


  const hash =
    params.get("hash");


  if (!hash) {
    throw new Error(
      "Telegram hash отсутствует."
    );
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


  /*
   * Секретный ключ Telegram WebApp.
   */

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
    throw new Error(
      "Неверные данные Telegram."
    );
  }


  const userRaw =
    params.get("user");


  if (!userRaw) {
    throw new Error(
      "Данные пользователя Telegram отсутствуют."
    );
  }


  let telegramUser;

  try {

    telegramUser =
      JSON.parse(userRaw);

  } catch (error) {

    throw new Error(
      "Не удалось прочитать данные Telegram."
    );
  }


  if (!telegramUser.id) {
    throw new Error(
      "Telegram ID пользователя отсутствует."
    );
  }


  return telegramUser;
}


/* =========================================================
   ПОЛУЧИТЬ / СОЗДАТЬ ПОЛЬЗОВАТЕЛЯ
   ========================================================= */

function getOrCreateUser(telegramUser) {

  const userId =
    String(telegramUser.id);


  let user =
    users.get(userId);


  if (!user) {

    user = {

      id: userId,

      username:
        telegramUser.username || "",

      firstName:
        telegramUser.first_name || "",

      lastName:
        telegramUser.last_name || "",

      balance: 0,

      usedPromoCodes:
        new Set(),

      createdAt:
        new Date().toISOString()
    };


    users.set(
      userId,
      user
    );
  }


  /*
   * Обновляем данные пользователя,
   * если они изменились в Telegram.
   */

  user.username =
    telegramUser.username || "";

  user.firstName =
    telegramUser.first_name || "";

  user.lastName =
    telegramUser.last_name || "";


  return user;
}


/* =========================================================
   ТРАНЗАКЦИЯ
   ========================================================= */

function addTransaction(
  userId,
  type,
  amount,
  description
) {

  const id =
    crypto.randomUUID();


  const transaction = {

    id,

    userId:

      String(userId),

    type,

    amount:

      Number(amount) || 0,

    description:

      String(description || ""),

    createdAt:

      new Date().toISOString()
  };


  if (!transactions.has(String(userId))) {
    transactions.set(
      String(userId),
      []
    );
  }


  transactions
    .get(String(userId))
    .push(transaction);


  return transaction;
}


/* =========================================================
   ПРОВЕРКА ПРОЦЕНТНОГО ПРОМОКОДА
   ========================================================= */

function calculatePercentPromo(
  user,
  amount,
  promoCode
) {

  const code =
    normalizePromoCode(
      promoCode
    );


  /*
   * Пустой промокод —
   * обычное пополнение.
   */

  if (!code) {

    return {

      code: "",

      percent: 0,

      bonus: 0,

      total: amount
    };
  }


  const promo =
    PROMOCODES[code];


  if (!promo) {
    throw new Error(
      "Промокод не найден."
    );
  }


  if (promo.type !== "percent") {

    throw new Error(
      "Этот промокод нельзя использовать для бонуса к пополнению."
    );
  }


  if (!promo.active) {

    throw new Error(
      "Промокод больше не активен."
    );
  }


  if (
    promo.maxUses !== null &&
    promo.maxUses !== undefined &&
    promo.uses >= promo.maxUses
  ) {

    throw new Error(
      "Лимит использования промокода исчерпан."
    );
  }


  if (
    user.usedPromoCodes &&
    user.usedPromoCodes.has(code)
  ) {

    throw new Error(
      "Вы уже использовали этот промокод."
    );
  }


  const percent =
    Number(promo.percent) || 0;


  const bonus =
    Math.floor(
      amount * percent / 100
    );


  const total =
    amount + bonus;


  return {

    code,

    percent,

    bonus,

    total
  };
}


/* =========================================================
   ПРОВЕРКА PT-ПРОМОКОДА
   ========================================================= */

function calculateBonusPromo(
  user,
  promoCode
) {

  const code =
    normalizePromoCode(
      promoCode
    );


  if (!code) {

    return {

      code: "",

      bonus: 0
    };
  }


  const promo =
    PROMOCODES[code];


  if (!promo) {

    throw new Error(
      "Промокод не найден."
    );
  }


  if (promo.type !== "bonus") {

    throw new Error(
      "Этот промокод не является PT-промокодом."
    );
  }


  if (!promo.active) {

    throw new Error(
      "Промокод больше не активен."
    );
  }


  if (
    promo.maxUses !== null &&
    promo.maxUses !== undefined &&
    promo.uses >= promo.maxUses
  ) {

    throw new Error(
      "Лимит использования промокода исчерпан."
    );
  }


  if (
    user.usedPromoCodes &&
    user.usedPromoCodes.has(code)
  ) {

    throw new Error(
      "Вы уже использовали этот промокод."
    );
  }


  return {

    code,

    bonus:
      Number(promo.bonus) || 0
  };
}


/* =========================================================
   АКТИВАЦИЯ ПРОМОКОДА
   ========================================================= */

function activatePromoCode(
  user,
  promoCode
) {

  const code =
    normalizePromoCode(
      promoCode
    );


  if (!code) {

    throw new Error(
      "Промокод не указан."
    );
  }


  const promo =
    PROMOCODES[code];


  if (!promo) {

    throw new Error(
      "Промокод не найден."
    );
  }


  if (!promo.active) {

    throw new Error(
      "Промокод не активен."
    );
  }


  if (!user.usedPromoCodes) {

    user.usedPromoCodes =
      new Set();
  }


  if (
    user.usedPromoCodes.has(code)
  ) {

    throw new Error(
      "Вы уже использовали этот промокод."
    );
  }


  if (
    promo.maxUses !== null &&
    promo.maxUses !== undefined &&
    promo.uses >= promo.maxUses
  ) {

    throw new Error(
      "Лимит использования промокода исчерпан."
    );
  }


  promo.uses += 1;


  user.usedPromoCodes.add(
    code
  );


  return promo;
}


/* =========================================================
   БЕЗОПАСНОЕ ПОЛУЧЕНИЕ INIT DATA
   ========================================================= */

function requireTelegramUser(
  req
) {

  const initData =
    req.body?.initData ||
    req.headers["x-telegram-init-data"] ||
    "";


  const telegramUser =
    checkTelegramData(initData);


  const user =
    getOrCreateUser(
      telegramUser
    );


  return {
    telegramUser,
    user
  };
}


/* =========================================================
   ГЛАВНАЯ
   ========================================================= */

app.get("/", (req, res) => {

  res.json({

    ok: true,

    service:
      "СК МЕТРОШОП API",

    api:
      API_BASE

  });

});


/* =========================================================
   ТОВАРЫ
   ========================================================= */

app.get(
  "/api/products",
  (req, res) => {

    res.json(PRODUCTS);

  }
);


/* =========================================================
   ПРОФИЛЬ
   ========================================================= */

app.post(
  "/api/profile",
  (req, res) => {

    try {

      const {
        telegramUser,
        user
      } = requireTelegramUser(req);


      res.json({

        id:
          user.id,

        username:
          user.username,

        firstName:
          user.firstName,

        balance:
          user.balance

      });

    } catch (error) {

      res.status(401).json({

        error:
          error.message ||
          "Ошибка авторизации Telegram."
      });

    }
  }
);


/* =========================================================
   ИСТОРИЯ
   ========================================================= */

app.post(
  "/api/history",
  (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const userTransactions =
        transactions.get(
          String(user.id)
        ) || [];


      res.json(
        userTransactions
      );

    } catch (error) {

      res.status(401).json({

        error:
          error.message ||
          "Ошибка авторизации Telegram."
      });

    }
  }
);


/* =========================================================
   ПРОВЕРКА ПРОЦЕНТНОГО ПРОМОКОДА
   ========================================================= */

app.post(
  "/api/promo/check-percent",
  (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const amount =
        Number(req.body.amount);


      const promoPercent =
        req.body.promoPercent;


      if (
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 1000000
      ) {

        return res.status(400).json({

          error:
            "Количество PT должно быть от 1 до 1 000 000."
        });
      }


      const result =
        calculatePercentPromo(
          user,
          amount,
          promoPercent
        );


      res.json({

        code:
          result.code,

        percent:
          result.percent,

        percentBonus:
          result.bonus,

        bonus:
          result.bonus,

        total:
          result.total,

        totalPoints:
          result.total

      });

    } catch (error) {

      res.status(400).json({

        error:
          error.message ||
          "Ошибка проверки промокода."
      });

    }
  }
);


/* =========================================================
   ПРОВЕРКА PT-ПРОМОКОДА
   ========================================================= */

app.post(
  "/api/promo/check-bonus",
  (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const promoBonus =
        req.body.promoBonus;


      const result =
        calculateBonusPromo(
          user,
          promoBonus
        );


      res.json({

        code:
          result.code,

        bonus:
          result.bonus

      });

    } catch (error) {

      res.status(400).json({

        error:
          error.message ||
          "Ошибка проверки PT-промокода."
      });

    }
  }
);


/* =========================================================
   СТАРЫЙ CHECK ПРОМОКОДА
   ОСТАВЛЯЕМ ДЛЯ СОВМЕСТИМОСТИ
   ========================================================= */

app.post(
  "/api/promo/check",
  (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const amount =
        Number(req.body.amount);


      const promoCode =
        req.body.promoCode || "";


      if (
        !Number.isInteger(amount) ||
        amount < 1
      ) {

        return res.status(400).json({

          error:
            "Некорректная сумма."
        });
      }


      const result =
        calculatePercentPromo(
          user,
          amount,
          promoCode
        );


      res.json({

        code:
          result.code,

        percent:
          result.percent,

        bonus:
          result.bonus,

        total:
          result.total

      });

    } catch (error) {

      res.status(400).json({

        error:
          error.message ||
          "Ошибка проверки промокода."
      });

    }
  }
);/* =========================================================
   АКТИВАЦИЯ ОТДЕЛЬНОГО PT-ПРОМОКОДА
   ========================================================= */

app.post(
  "/api/promo/activate",
  (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const code =
        normalizePromoCode(
          req.body.code
        );


      if (!code) {

        return res.status(400).json({
          error: "Введите промокод."
        });
      }


      /*
       * Проверяем именно PT-промокод.
       * Процентные промокоды здесь использовать нельзя.
       */

      const promo =
        calculateBonusPromo(
          user,
          code
        );


      /*
       * Фиксируем использование промокода.
       */

      activatePromoCode(
        user,
        code
      );


      /*
       * Начисляем бонус на баланс.
       */

      const bonus =
        Number(promo.bonus) || 0;


      if (bonus <= 0) {

        return res.status(400).json({
          error:
            "У этого промокода отсутствует бонус."
        });
      }


      user.balance += bonus;


      /*
       * Добавляем операцию в историю.
       */

      addTransaction(
        user.id,
        "promo_bonus",
        bonus,
        `Активация PT-промокода ${code}`
      );


      res.json({

        ok: true,

        code,

        bonus,

        balance:
          user.balance,

        message:
          `Промокод активирован. Начислено ${bonus} PT.`

      });

    } catch (error) {

      res.status(400).json({

        error:
          error.message ||
          "Не удалось активировать промокод."
      });

    }
  }
);


/* =========================================================
   ПОКУПКА ТОВАРА
   ========================================================= */

app.post(
  "/api/buy",
  async (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const productName =
        String(
          req.body.product || ""
        ).trim();


      const gameId =
        String(
          req.body.gameId || ""
        ).trim();


      let quantity =
        Number(
          req.body.quantity || 1
        );


      /*
       * Проверяем товар.
       */

      const product =
        PRODUCTS.find(
          item =>
            item.name === productName
        );


      if (!product) {

        return res.status(404).json({

          error:
            "Товар не найден."
        });
      }


      /*
       * Товары с нулевой ценой
       * пока оформить нельзя.
       */

      const price =
        Number(product.price) || 0;


      if (price <= 0) {

        return res.status(400).json({

          error:
            "Этот товар пока недоступен для покупки."
        });
      }


      /*
       * Проверяем игровой ID.
       */

      if (!gameId) {

        return res.status(400).json({

          error:
            "Введите игровой ID."
        });
      }


      /*
       * Проверяем количество.
       */

      if (!product.quantityEnabled) {

        quantity = 1;

      } else {

        if (!Number.isInteger(quantity)) {

          return res.status(400).json({

            error:
              "Количество должно быть целым числом."
          });
        }


        const maxQuantity =
          Number(
            product.maxQuantity || 1
          );


        if (
          quantity < 1 ||
          quantity > maxQuantity
        ) {

          return res.status(400).json({

            error:
              `Количество должно быть от 1 до ${maxQuantity}.`
          });
        }
      }


      /*
       * Итоговая стоимость.
       */

      const total =
        price * quantity;


      /*
       * Проверяем баланс.
       */

      if (
        Number(user.balance) < total
      ) {

        return res.status(400).json({

          error:
            "Недостаточно PT на балансе."
        });
      }


      /*
       * Списываем баланс.
       */

      user.balance -= total;


      /*
       * Создаём ID заказа.
       */

      const orderId =
        crypto.randomUUID();


      const order = {

        id:
          orderId,

        userId:
          String(user.id),

        username:
          user.username || "",

        firstName:
          user.firstName || "",

        product:
          product.name,

        gameId,

        quantity,

        price,

        total,

        status:
          "waiting",

        createdAt:
          new Date().toISOString()
      };


      orders.set(
        orderId,
        order
      );


      /*
       * Добавляем транзакцию.
       */

      addTransaction(
        user.id,
        "purchase",
        -total,
        `Покупка: ${product.name} × ${quantity}`
      );


      /*
       * Пытаемся отправить заказ в рабочий чат.
       */

      try {

        await sendOrderToStaff(
          order
        );

      } catch (telegramError) {

        console.error(
          "Ошибка отправки заказа в Telegram:",
          telegramError
        );


        /*
         * Если сообщение сотрудникам
         * не ушло — возвращаем деньги.
         */

        user.balance += total;

        orders.delete(orderId);

        /*
         * Добавляем возврат в историю.
         */

        addTransaction(
          user.id,
          "refund",
          total,
          "Возврат средств: заказ не удалось отправить."
        );


        return res.status(500).json({

          error:
            "Не удалось отправить заказ. PT возвращены на баланс.",

          balance:
            user.balance
        });
      }


      res.json({

        ok: true,

        orderId,

        product:
          product.name,

        quantity,

        total,

        balance:
          user.balance,

        message:
          "Заказ принят и отправлен сотрудникам."

      });

    } catch (error) {

      console.error(
        "Buy error:",
        error
      );


      res.status(400).json({

        error:
          error.message ||
          "Не удалось оформить заказ."
      });

    }
  }
);


/* =========================================================
   СОЗДАНИЕ ЗАЯВКИ НА ПОПОЛНЕНИЕ
   ========================================================= */

app.post(
  "/api/topup/create",
  (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const amount =
        Number(
          req.body.amount
        );


      if (
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 1000000
      ) {

        return res.status(400).json({

          error:
            "Количество PT должно быть от 1 до 1 000 000."
        });
      }


      /*
       * Только процентный промокод.
       */

      let promoPercent =
        req.body.promoPercent || "";


      /*
       * Старое поле оставляем для совместимости.
       * Если новое поле пустое, можем использовать promoCode.
       */

      if (
        !String(promoPercent).trim() &&
        String(req.body.promoCode || "").trim()
      ) {

        promoPercent =
          req.body.promoCode;
      }


      /*
       * PT-промокод через пополнение НЕ активируем.
       * Для него используется отдельный endpoint:
       *
       * POST /api/promo/activate
       */

      const promoBonus =
        String(
          req.body.promoBonus || ""
        ).trim();


      /*
       * Если по какой-то причине frontend
       * передал PT-код в поле promoBonus,
       * не активируем его автоматически.
       *
       * Это важно, чтобы один PT-код нельзя было
       * случайно или повторно активировать
       * через создание заявки.
       */

      if (promoBonus) {

        const normalizedBonus =
          normalizePromoCode(
            promoBonus
          );


        const promo =
          PROMOCODES[
            normalizedBonus
          ];


        if (
          promo &&
          promo.type === "bonus"
        ) {

          return res.status(400).json({

            error:
              "PT-промокод нужно активировать отдельно в разделе «Промокод PT»."
          });
        }
      }


      /*
       * Считаем процентный бонус.
       */

      const percentResult =
        calculatePercentPromo(
          user,
          amount,
          promoPercent
        );


      const percentBonus =
        Number(
          percentResult.bonus
        ) || 0;


      const fixedBonus =
        0;


      const totalPoints =
        amount +
        percentBonus +
        fixedBonus;


      /*
       * Уникальный ID заявки.
       */

      const paymentId =
        crypto.randomUUID();


      /*
       * Пока платёжная система
       * реально не подключена.
       */

      const payment = {

        id:
          paymentId,

        userId:
          String(user.id),

        amount,

        promoPercent:
          percentResult.code,

        percentBonus,

        fixedBonus,

        totalPoints,

        status:
          "waiting_payment",

        createdAt:
          new Date().toISOString()
      };


      /*
       * Можно хранить заявку отдельно
       * в orders только для текущей сессии,
       * но реальные платежи пока не подключены.
       */

      orders.set(
        `payment_${paymentId}`,
        payment
      );


      res.json({

        ok: true,

        paymentId,

        amount,

        promoPercent:
          percentResult.code,

        percent:
          percentResult.percent,

        percentBonus,

        fixedBonus,

        totalPoints,

        /*
         * Когда подключишь платёжку,
         * сюда можно будет вернуть реальную ссылку.
         */

        paymentUrl:
          null,

        message:
          "Заявка рассчитана. Ручная оплата будет подключена следующим этапом."

      });

    } catch (error) {

      console.error(
        "Topup create error:",
        error
      );


      res.status(400).json({

        error:
          error.message ||
          "Не удалось создать заявку на пополнение."
      });

    }
  }
);


/* =========================================================
   WEBHOOK ОПЛАТЫ
   ========================================================= */

app.post(
  "/api/payment/webhook",
  (req, res) => {

    res.status(501).json({

      ok: false,

      error:
        "Платёжная система пока не подключена."
    });

  }
);


/* =========================================================
   ПОЛУЧЕНИЕ ЗАКАЗА
   ========================================================= */

app.get(
  "/api/orders/:id",
  (req, res) => {

    try {

      const order =
        orders.get(
          req.params.id
        );


      if (!order) {

        return res.status(404).json({

          error:
            "Заказ не найден."
        });
      }


      res.json({
        ok: true,
        order
      });

    } catch (error) {

      res.status(500).json({

        error:
          "Ошибка получения заказа."
      });

    }
  }
);


/* =========================================================
   TELEGRAM BOT — ОТПРАВКА ЗАКАЗА СОТРУДНИКАМ
   ========================================================= */

async function telegramRequest(
  method,
  body
) {

  if (!BOT_TOKEN) {

    throw new Error(
      "BOT_TOKEN не настроен."
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

        body:
          JSON.stringify(body)
      }
    );


  const result =
    await response.json();


  if (!response.ok || !result.ok) {

    throw new Error(
      result.description ||
      `Telegram API error: ${response.status}`
    );
  }


  return result;
}


/* =========================================================
   ОТПРАВКА ЗАКАЗА В STAFF CHAT
   ========================================================= */

async function sendOrderToStaff(
  order
) {

  if (!STAFF_CHAT_ID) {

    throw new Error(
      "STAFF_CHAT_ID не настроен."
    );
  }


  const username =
    order.username
      ? "@" + order.username
      : "не указан";


  const text =

`🛒 НОВЫЙ ЗАКАЗ

📦 Товар:
${order.product}

🔢 Количество:
${order.quantity}

💎 Сумма:
${order.total} PT

🎮 Game ID:
${order.gameId}

👤 Пользователь:
${order.firstName || "Не указан"}

🔗 Username:
${username}

🆔 Telegram ID:
${order.userId}

📋 Order ID:
${order.id}`;


  const keyboard = {

    inline_keyboard: [

      [
        {
          text:
            "✅ ВЗЯТЬ ЗАКАЗ",

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
}/* =========================================================
   АКТИВАЦИЯ ОТДЕЛЬНОГО PT-ПРОМОКОДА
   ========================================================= */

app.post(
  "/api/promo/activate",
  (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const code =
        normalizePromoCode(
          req.body.code
        );


      if (!code) {

        return res.status(400).json({
          error: "Введите промокод."
        });
      }


      /*
       * Проверяем именно PT-промокод.
       * Процентные промокоды здесь использовать нельзя.
       */

      const promo =
        calculateBonusPromo(
          user,
          code
        );


      /*
       * Фиксируем использование промокода.
       */

      activatePromoCode(
        user,
        code
      );


      /*
       * Начисляем бонус на баланс.
       */

      const bonus =
        Number(promo.bonus) || 0;


      if (bonus <= 0) {

        return res.status(400).json({
          error:
            "У этого промокода отсутствует бонус."
        });
      }


      user.balance += bonus;


      /*
       * Добавляем операцию в историю.
       */

      addTransaction(
        user.id,
        "promo_bonus",
        bonus,
        `Активация PT-промокода ${code}`
      );


      res.json({

        ok: true,

        code,

        bonus,

        balance:
          user.balance,

        message:
          `Промокод активирован. Начислено ${bonus} PT.`

      });

    } catch (error) {

      res.status(400).json({

        error:
          error.message ||
          "Не удалось активировать промокод."
      });

    }
  }
);


/* =========================================================
   ПОКУПКА ТОВАРА
   ========================================================= */

app.post(
  "/api/buy",
  async (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const productName =
        String(
          req.body.product || ""
        ).trim();


      const gameId =
        String(
          req.body.gameId || ""
        ).trim();


      let quantity =
        Number(
          req.body.quantity || 1
        );


      /*
       * Проверяем товар.
       */

      const product =
        PRODUCTS.find(
          item =>
            item.name === productName
        );


      if (!product) {

        return res.status(404).json({

          error:
            "Товар не найден."
        });
      }


      /*
       * Товары с нулевой ценой
       * пока оформить нельзя.
       */

      const price =
        Number(product.price) || 0;


      if (price <= 0) {

        return res.status(400).json({

          error:
            "Этот товар пока недоступен для покупки."
        });
      }


      /*
       * Проверяем игровой ID.
       */

      if (!gameId) {

        return res.status(400).json({

          error:
            "Введите игровой ID."
        });
      }


      /*
       * Проверяем количество.
       */

      if (!product.quantityEnabled) {

        quantity = 1;

      } else {

        if (!Number.isInteger(quantity)) {

          return res.status(400).json({

            error:
              "Количество должно быть целым числом."
          });
        }


        const maxQuantity =
          Number(
            product.maxQuantity || 1
          );


        if (
          quantity < 1 ||
          quantity > maxQuantity
        ) {

          return res.status(400).json({

            error:
              `Количество должно быть от 1 до ${maxQuantity}.`
          });
        }
      }


      /*
       * Итоговая стоимость.
       */

      const total =
        price * quantity;


      /*
       * Проверяем баланс.
       */

      if (
        Number(user.balance) < total
      ) {

        return res.status(400).json({

          error:
            "Недостаточно PT на балансе."
        });
      }


      /*
       * Списываем баланс.
       */

      user.balance -= total;


      /*
       * Создаём ID заказа.
       */

      const orderId =
        crypto.randomUUID();


      const order = {

        id:
          orderId,

        userId:
          String(user.id),

        username:
          user.username || "",

        firstName:
          user.firstName || "",

        product:
          product.name,

        gameId,

        quantity,

        price,

        total,

        status:
          "waiting",

        createdAt:
          new Date().toISOString()
      };


      orders.set(
        orderId,
        order
      );


      /*
       * Добавляем транзакцию.
       */

      addTransaction(
        user.id,
        "purchase",
        -total,
        `Покупка: ${product.name} × ${quantity}`
      );


      /*
       * Пытаемся отправить заказ в рабочий чат.
       */

      try {

        await sendOrderToStaff(
          order
        );

      } catch (telegramError) {

        console.error(
          "Ошибка отправки заказа в Telegram:",
          telegramError
        );


        /*
         * Если сообщение сотрудникам
         * не ушло — возвращаем деньги.
         */

        user.balance += total;

        orders.delete(orderId);

        /*
         * Добавляем возврат в историю.
         */

        addTransaction(
          user.id,
          "refund",
          total,
          "Возврат средств: заказ не удалось отправить."
        );


        return res.status(500).json({

          error:
            "Не удалось отправить заказ. PT возвращены на баланс.",

          balance:
            user.balance
        });
      }


      res.json({

        ok: true,

        orderId,

        product:
          product.name,

        quantity,

        total,

        balance:
          user.balance,

        message:
          "Заказ принят и отправлен сотрудникам."

      });

    } catch (error) {

      console.error(
        "Buy error:",
        error
      );


      res.status(400).json({

        error:
          error.message ||
          "Не удалось оформить заказ."
      });

    }
  }
);


/* =========================================================
   СОЗДАНИЕ ЗАЯВКИ НА ПОПОЛНЕНИЕ
   ========================================================= */

app.post(
  "/api/topup/create",
  (req, res) => {

    try {

      const {
        user
      } = requireTelegramUser(req);


      const amount =
        Number(
          req.body.amount
        );


      if (
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > 1000000
      ) {

        return res.status(400).json({

          error:
            "Количество PT должно быть от 1 до 1 000 000."
        });
      }


      /*
       * Только процентный промокод.
       */

      let promoPercent =
        req.body.promoPercent || "";


      /*
       * Старое поле оставляем для совместимости.
       * Если новое поле пустое, можем использовать promoCode.
       */

      if (
        !String(promoPercent).trim() &&
        String(req.body.promoCode || "").trim()
      ) {

        promoPercent =
          req.body.promoCode;
      }


      /*
       * PT-промокод через пополнение НЕ активируем.
       * Для него используется отдельный endpoint:
       *
       * POST /api/promo/activate
       */

      const promoBonus =
        String(
          req.body.promoBonus || ""
        ).trim();


      /*
       * Если по какой-то причине frontend
       * передал PT-код в поле promoBonus,
       * не активируем его автоматически.
       *
       * Это важно, чтобы один PT-код нельзя было
       * случайно или повторно активировать
       * через создание заявки.
       */

      if (promoBonus) {

        const normalizedBonus =
          normalizePromoCode(
            promoBonus
          );


        const promo =
          PROMOCODES[
            normalizedBonus
          ];


        if (
          promo &&
          promo.type === "bonus"
        ) {

          return res.status(400).json({

            error:
              "PT-промокод нужно активировать отдельно в разделе «Промокод PT»."
          });
        }
      }


      /*
       * Считаем процентный бонус.
       */

      const percentResult =
        calculatePercentPromo(
          user,
          amount,
          promoPercent
        );


      const percentBonus =
        Number(
          percentResult.bonus
        ) || 0;


      const fixedBonus =
        0;


      const totalPoints =
        amount +
        percentBonus +
        fixedBonus;


      /*
       * Уникальный ID заявки.
       */

      const paymentId =
        crypto.randomUUID();


      /*
       * Пока платёжная система
       * реально не подключена.
       */

      const payment = {

        id:
          paymentId,

        userId:
          String(user.id),

        amount,

        promoPercent:
          percentResult.code,

        percentBonus,

        fixedBonus,

        totalPoints,

        status:
          "waiting_payment",

        createdAt:
          new Date().toISOString()
      };


      /*
       * Можно хранить заявку отдельно
       * в orders только для текущей сессии,
       * но реальные платежи пока не подключены.
       */

      orders.set(
        `payment_${paymentId}`,
        payment
      );


      res.json({

        ok: true,

        paymentId,

        amount,

        promoPercent:
          percentResult.code,

        percent:
          percentResult.percent,

        percentBonus,

        fixedBonus,

        totalPoints,

        /*
         * Когда подключишь платёжку,
         * сюда можно будет вернуть реальную ссылку.
         */

        paymentUrl:
          null,

        message:
          "Заявка рассчитана. Ручная оплата будет подключена следующим этапом."

      });

    } catch (error) {

      console.error(
        "Topup create error:",
        error
      );


      res.status(400).json({

        error:
          error.message ||
          "Не удалось создать заявку на пополнение."
      });

    }
  }
);


/* =========================================================
   WEBHOOK ОПЛАТЫ
   ========================================================= */

app.post(
  "/api/payment/webhook",
  (req, res) => {

    res.status(501).json({

      ok: false,

      error:
        "Платёжная система пока не подключена."
    });

  }
);


/* =========================================================
   ПОЛУЧЕНИЕ ЗАКАЗА
   ========================================================= */

app.get(
  "/api/orders/:id",
  (req, res) => {

    try {

      const order =
        orders.get(
          req.params.id
        );


      if (!order) {

        return res.status(404).json({

          error:
            "Заказ не найден."
        });
      }


      res.json({
        ok: true,
        order
      });

    } catch (error) {

      res.status(500).json({

        error:
          "Ошибка получения заказа."
      });

    }
  }
);


/* =========================================================
   TELEGRAM BOT — ОТПРАВКА ЗАКАЗА СОТРУДНИКАМ
   ========================================================= */

async function telegramRequest(
  method,
  body
) {

  if (!BOT_TOKEN) {

    throw new Error(
      "BOT_TOKEN не настроен."
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

        body:
          JSON.stringify(body)
      }
    );


  const result =
    await response.json();


  if (!response.ok || !result.ok) {

    throw new Error(
      result.description ||
      `Telegram API error: ${response.status}`
    );
  }


  return result;
}


/* =========================================================
   ОТПРАВКА ЗАКАЗА В STAFF CHAT
   ========================================================= */

async function sendOrderToStaff(
  order
) {

  if (!STAFF_CHAT_ID) {

    throw new Error(
      "STAFF_CHAT_ID не настроен."
    );
  }


  const username =
    order.username
      ? "@" + order.username
      : "не указан";


  const text =

`🛒 НОВЫЙ ЗАКАЗ

📦 Товар:
${order.product}

🔢 Количество:
${order.quantity}

💎 Сумма:
${order.total} PT

🎮 Game ID:
${order.gameId}

👤 Пользователь:
${order.firstName || "Не указан"}

🔗 Username:
${username}

🆔 Telegram ID:
${order.userId}

📋 Order ID:
${order.id}`;


  const keyboard = {

    inline_keyboard: [

      [
        {
          text:
            "✅ ВЗЯТЬ ЗАКАЗ",

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
