const express = require("express");
const crypto = require("crypto");

const app = express();

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, X-Telegram-Init-Data"
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

const PORT =
  process.env.PORT || 3000;

const BOT_TOKEN =
  process.env.BOT_TOKEN || "";

const STAFF_CHAT_ID =
  process.env.STAFF_CHAT_ID || "";


/* =========================================================
   API
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
   ХРАНИЛИЩА
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
   * Только процент к пополнению.
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
   * Только фиксированный бонус PT.
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
   TELEGRAM INIT DATA
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

  const calculated =
    Buffer.from(calculatedHash, "hex");

  const received =
    Buffer.from(hash, "hex");

  if (
    calculated.length !==
    received.length ||
    !crypto.timingSafeEqual(
      calculated,
      received
    )
  ) {
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
   ПОЛЬЗОВАТЕЛЬ
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

  } else {

    user.username =
      telegramUser.username || "";

    user.firstName =
      telegramUser.first_name || "";

    user.lastName =
      telegramUser.last_name || "";
  }

  return user;
}


/* =========================================================
   АВТОРИЗАЦИЯ TELEGRAM
   ========================================================= */

function requireTelegramUser(req) {

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

  const key =
    String(userId);

  if (!transactions.has(key)) {
    transactions.set(
      key,
      []
    );
  }

  transactions
    .get(key)
    .push(transaction);

  return transaction;
}


/* =========================================================
   ПРОЦЕНТНЫЙ ПРОМОКОД
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
      "Этот промокод нельзя использовать в поле процентного промокода."
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

  return {
    code,
    percent,
    bonus,
    total:
      amount + bonus
  };
}


/* =========================================================
   PT-ПРОМОКОД
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
    throw new Error(
      "Введите промокод."
    );
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
      "Этот промокод нельзя использовать здесь."
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
   ГЛАВНАЯ
   ========================================================= */

app.get("/", (req, res) => {

  res.json({
    ok: true,
    service: "СК МЕТРОШОП API",
    api: API_BASE
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
        user
      } =
        requireTelegramUser(req);

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
      } =
        requireTelegramUser(req);

      const history =
        transactions.get(
          String(user.id)
        ) || [];

      res.json(
        history
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
      } =
        requireTelegramUser(req);

      const amount =
        Number(
          req.body.amount
        );

      const promoPercent =
        req.body.promoPercent || "";

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

        ok: true,

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
      } =
        requireTelegramUser(req);

      const result =
        calculateBonusPromo(
          user,
          req.body.promoBonus
        );

      res.json({

        ok: true,

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
   СОВМЕСТИМОСТЬ СО СТАРЫМ FRONTEND
   ========================================================= */

app.post(
  "/api/promo/check",
  (req, res) => {

    try {

      const {
        user
      } =
        requireTelegramUser(req);

      const amount =
        Number(
          req.body.amount
        );

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
          req.body.promoCode || ""
        );

      res.json({

        ok: true,

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
       * Проверяем, что это именно
       * PT-промокод.
       */

      const checked =
        calculateBonusPromo(
          user,
          code
        );


      const bonus =
        Number(
          checked.bonus
        ) || 0;


      if (bonus <= 0) {

        return res.status(400).json({
          error:
            "У этого промокода нет бонуса."
        });
      }


      /*
       * Фиксируем использование
       * только после успешной проверки.
       */

      activatePromoCode(
        user,
        code
      );


      /*
       * Начисляем PT.
       */

      user.balance += bonus;


      /*
       * Записываем в историю.
       */

      addTransaction(
        user.id,
        "promo_bonus",
        bonus,
        "Активация PT-промокода"
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

      console.error(
        "Promo activate error:",
        error
      );


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
       * Ищем товар.
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
       * Получаем цену.
       */

      const price =
        Number(
          product.price
        ) || 0;


      /*
       * Бесплатные товары
       * пока недоступны для покупки.
       */

      if (price <= 0) {

        return res.status(400).json({
          error:
            "Этот товар пока недоступен для покупки."
        });
      }


      /*
       * Проверяем Game ID.
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

      if (
        !product.quantityEnabled
      ) {

        quantity = 1;

      } else {

        if (
          !Number.isInteger(quantity)
        ) {

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
       * Считаем итоговую стоимость.
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
       * Списываем PT.
       */

      user.balance -= total;


      /*
       * Создаём заказ.
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
       * Записываем покупку в историю.
       */

      addTransaction(
        user.id,
        "purchase",
        -total,
        `Покупка: ${product.name} × ${quantity}`
      );


      /*
       * Отправляем заказ сотрудникам.
       */

      try {

        await sendOrderToStaff(
          order
        );

      } catch (telegramError) {

        console.error(
          "Ошибка отправки заказа:",
          telegramError
        );


        /*
         * Если заказ не отправился —
         * возвращаем PT.
         */

        user.balance += total;


        orders.delete(
          orderId
        );


        addTransaction(
          user.id,
          "refund",
          total,
          "Возврат средств: заказ не удалось отправить."
        );


        return res.status(500).json({

          error:
            "Не удалось отправить заказ. PT возвращены.",

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
       * Промокод здесь только
       * на процент к пополнению.
       */

      let promoPercent =
        String(
          req.body.promoPercent || ""
        ).trim();


      /*
       * Старое поле оставляем
       * для совместимости.
       */

      if (
        !promoPercent &&
        String(
          req.body.promoCode || ""
        ).trim()
      ) {

        promoPercent =
          String(
            req.body.promoCode
          ).trim();
      }


      /*
       * PT-промокоды сюда не принимаем.
       */

      const promoBonus =
        String(
          req.body.promoBonus || ""
        ).trim();


      if (promoBonus) {

        const normalizedBonus =
          normalizePromoCode(
            promoBonus
          );


        const bonusPromo =
          PROMOCODES[
            normalizedBonus
          ];


        if (
          bonusPromo &&
          bonusPromo.type === "bonus"
        ) {

          return res.status(400).json({

            error:
              "PT-промокод нужно активировать через отдельную кнопку «Промокод PT»."

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


      const totalPoints =
        amount +
        percentBonus;


      /*
       * Создаём ID заявки.
       */

      const paymentId =
        crypto.randomUUID();


      const payment = {

        id:
          paymentId,

        userId:
          String(user.id),

        amount,

        promoPercent:
          percentResult.code,

        percent:
          percentResult.percent,

        percentBonus,

        totalPoints,

        status:
          "waiting_payment",

        createdAt:
          new Date().toISOString()

      };


      orders.set(
        `payment_${paymentId}`,
        payment
      );


      /*
       * Пока настоящей оплаты нет.
       * Баланс здесь НЕ увеличиваем.
       */

      res.json({

        ok: true,

        paymentId,

        amount,

        promoPercent:
          percentResult.code,

        percent:
          percentResult.percent,

        percentBonus,

        fixedBonus:
          0,

        totalPoints,

        paymentUrl:
          null,

        message:
          "Заявка рассчитана. Ручная оплата будет подключена следующим этапом."

      });

    } catch (error) {

      console.error(
        "Topup error:",
        error
      );


      res.status(400).json({

        error:
          error.message ||
          "Не удалось создать заявку."

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
   ПОЛУЧЕНИЕ ЗАКАЗА ПО ID
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
   TELEGRAM API
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

        method:
          "POST",

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


  if (
    !response.ok ||
    !result.ok
  ) {

    throw new Error(

      result.description ||
      `Telegram API error: ${response.status}`

    );
  }


  return result;
}


/* =========================================================
   ОТПРАВКА ЗАКАЗА СОТРУДНИКАМ
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
      ? `@${order.username}`
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
   TELEGRAM — ВЗЯТЬ ЗАКАЗ
   ========================================================= */

async function handleClaim(
  callbackQuery,
  orderId
) {

  const order =
    orders.get(orderId);

  if (!order) {

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          "Заказ не найден.",

        show_alert:
          true
      }
    );

    return;
  }


  if (
    order.status !== "waiting"
  ) {

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          "Этот заказ уже взят.",

        show_alert:
          true
      }
    );

    return;
  }


  const staff =
    callbackQuery.from;


  const staffName =
    [
      staff.first_name,
      staff.last_name
    ]
      .filter(Boolean)
      .join(" ") ||
    staff.username ||
    String(staff.id);


  order.status =
    "claimed";


  order.staffId =
    String(staff.id);


  order.staffUsername =
    staff.username || "";


  order.staffName =
    staffName;


  order.claimedAt =
    new Date().toISOString();


  orders.set(
    orderId,
    order
  );


  await telegramRequest(
    "answerCallbackQuery",
    {
      callback_query_id:
        callbackQuery.id,

      text:
        "Заказ взят."
    }
  );


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
                  `✅ ВЗЯТО: ${staffName}`,

                callback_data:
                  `complete:${orderId}`
              }
            ]

          ]

        }

      }
    );

  } catch (error) {

    console.error(
      "Ошибка обновления кнопки:",
      error
    );
  }
}


/* =========================================================
   TELEGRAM — ЗАВЕРШИТЬ ЗАКАЗ
   ========================================================= */

async function handleComplete(
  callbackQuery,
  orderId
) {

  const order =
    orders.get(orderId);


  if (!order) {

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          "Заказ не найден.",

        show_alert:
          true
      }
    );

    return;
  }


  if (
    order.status !== "claimed"
  ) {

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          "Этот заказ нельзя завершить.",

        show_alert:
          true
      }
    );

    return;
  }


  const staffId =
    String(
      callbackQuery.from.id
    );


  if (
    String(order.staffId) !==
    staffId
  ) {

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          "Завершить заказ может только тот, кто его взял.",

        show_alert:
          true
      }
    );

    return;
  }


  order.status =
    "completed";


  order.completedAt =
    new Date().toISOString();


  orders.set(
    orderId,
    order
  );


  await telegramRequest(
    "answerCallbackQuery",
    {
      callback_query_id:
        callbackQuery.id,

      text:
        "Заказ завершён."
    }
  );


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
                  "✅ ЗАКАЗ ЗАВЕРШЁН",

                callback_data:
                  "done"
              }
            ]

          ]

        }

      }
    );

  } catch (error) {

    console.error(
      "Ошибка обновления кнопки завершения:",
      error
    );
  }
}


/* =========================================================
   TELEGRAM CALLBACK ROUTER
   ========================================================= */

async function handleCallback(
  callbackQuery
) {

  const data =
    String(
      callbackQuery.data || ""
    );


  if (
    data === "done"
  ) {

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          "Заказ уже завершён."
      }
    );

    return;
  }


  const separator =
    data.indexOf(":");


  if (
    separator === -1
  ) {

    await telegramRequest(
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackQuery.id,

        text:
          "Некорректная команда."
      }
    );

    return;
  }


  const action =
    data.slice(
      0,
      separator
    );


  const orderId =
    data.slice(
      separator + 1
    );


  if (
    action === "claim"
  ) {

    await handleClaim(
      callbackQuery,
      orderId
    );

    return;
  }


  if (
    action === "complete"
  ) {

    await handleComplete(
      callbackQuery,
      orderId
    );

    return;
  }


  await telegramRequest(
    "answerCallbackQuery",
    {
      callback_query_id:
        callbackQuery.id,

      text:
        "Неизвестная команда."
    }
  );
}


/* =========================================================
   ОБРАБОТКА TELEGRAM UPDATE
   ========================================================= */

async function processTelegramUpdate(
  update
) {

  if (
    update &&
    update.callback_query
  ) {

    try {

      await handleCallback(
        update.callback_query
      );

    } catch (error) {

      console.error(
        "Callback handler error:",
        error
      );


      try {

        await telegramRequest(
          "answerCallbackQuery",
          {
            callback_query_id:
              update.callback_query.id,

            text:
              "Произошла ошибка."
          }
        );

      } catch (nestedError) {

        console.error(
          "Ошибка ответа callback:",
          nestedError
        );
      }
    }
  }
}


/* =========================================================
   TELEGRAM LONG POLLING
   ========================================================= */

let telegramOffset =
  0;


let telegramPolling =
  false;


async function startTelegramPolling() {

  if (
    telegramPolling ||
    !BOT_TOKEN
  ) {
    return;
  }


  telegramPolling =
    true;


  /*
   * Убираем webhook,
   * чтобы getUpdates работал.
   */

  try {

    await telegramRequest(
      "deleteWebhook",
      {
        drop_pending_updates:
          false
      }
    );

  } catch (error) {

    console.error(
      "Ошибка удаления webhook:",
      error
    );
  }


  console.log(
    "Telegram polling started."
  );


  while (telegramPolling) {

    try {

      const result =
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


      const updates =
        Array.isArray(
          result.result
        )
          ? result.result
          : [];


      for (
        const update
        of updates
      ) {

        telegramOffset =
          Number(
            update.update_id
          ) + 1;


        await processTelegramUpdate(
          update
        );
      }


    } catch (error) {

      console.error(
        "Telegram polling error:",
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


/* =========================================================
   ПРЕДУПРЕЖДЕНИЯ О НАСТРОЙКАХ
   ========================================================= */

function checkEnvironment() {

  console.log(
    "===================================="
  );

  console.log(
    "СК МЕТРОШОП SERVER"
  );

  console.log(
    "PORT:",
    PORT
  );

  console.log(
    "BOT_TOKEN:",
    BOT_TOKEN
      ? "OK"
      : "НЕ НАСТРОЕН"
  );

  console.log(
    "STAFF_CHAT_ID:",
    STAFF_CHAT_ID
      ? "OK"
      : "НЕ НАСТРОЕН"
  );

  console.log(
    "API:",
    API_BASE
  );

  console.log(
    "PROMOCODES:",
    Object.keys(PROMOCODES)
  );

  console.log(
    "===================================="
  );
}


/* =========================================================
   ЗАПУСК СЕРВЕРА
   ========================================================= */

app.listen(
  PORT,
  () => {

    console.log(
      `Server started on port ${PORT}`
    );


    checkEnvironment();


    if (BOT_TOKEN) {

      startTelegramPolling()
        .catch((error) => {

          console.error(
            "Telegram polling start error:",
            error
          );

        });

    } else {

      console.log(
        "Telegram polling не запущен."
      );

      console.log(
        "Причина: BOT_TOKEN отсутствует."
      );
    }
  }
);


/* =========================================================
   ОБРАБОТКА ОШИБОК NODE
   ========================================================= */

process.on(
  "unhandledRejection",
  (error) => {

    console.error(
      "Unhandled promise rejection:",
      error
    );

  }
);


process.on(
  "uncaughtException",
  (error) => {

    console.error(
      "Uncaught exception:",
      error
    );

  }
);
