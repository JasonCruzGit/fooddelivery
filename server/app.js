import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "data");
const MENU_FILE = path.join(DATA_DIR, "menu.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

const envValue = (value, fallback = "") => {
  const next = String(value ?? "").trim();
  return next || fallback;
};

const ADMIN_USERNAME = envValue(process.env.ADMIN_USERNAME, "admin");
const ADMIN_PASSWORD = envValue(process.env.ADMIN_PASSWORD, "admin123");
const PAGE_USERNAME = envValue(process.env.MESSENGER_PAGE_USERNAME, "yourrestaurantpage");
const PAGE_URL = envValue(process.env.MESSENGER_PAGE_URL);
const MESSENGER_MODE = envValue(process.env.MESSENGER_MODE, "deeplink").toLowerCase();
const MESSENGER_PAGE_ACCESS_TOKEN = envValue(process.env.MESSENGER_PAGE_ACCESS_TOKEN);
const MESSENGER_RECIPIENT_ID = envValue(process.env.MESSENGER_RECIPIENT_ID);
const SUPABASE_URL = envValue(process.env.SUPABASE_URL);
const SUPABASE_SERVICE_ROLE_KEY = envValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

const adminTokens = new Map();
let ensureFilesPromise = null;

const baseOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many order attempts. Please wait 1 minute." },
});

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "250kb" }));
app.use(async (_req, _res, next) => {
  try {
    await ensureInitialized();
    next();
  } catch (error) {
    next(error);
  }
});

const sanitizeText = (value) =>
  String(value ?? "")
    .replace(/[<>]/g, "")
    .trim();

const nowIso = () => new Date().toISOString();

async function ensureFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(MENU_FILE);
  } catch {
    const seed = {
      categories: ["Meals", "Drinks", "Snacks", "Desserts"],
      items: [
        {
          id: "meal-burger-classic",
          name: "Classic Chicken Burger",
          description: "Crispy chicken fillet, lettuce, tomato, and house sauce.",
          price: 149,
          image:
            "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80",
          category: "Meals",
          enabled: true,
          addons: [
            { id: "addon-extra-cheese", name: "Extra Cheese", price: 25 },
            { id: "addon-bacon", name: "Bacon", price: 35 },
          ],
        },
        {
          id: "meal-rice-bowl",
          name: "BBQ Rice Bowl",
          description: "Smoky BBQ chicken over garlic rice.",
          price: 179,
          image:
            "https://images.unsplash.com/photo-1604909052743-94e838986d24?auto=format&fit=crop&w=900&q=80",
          category: "Meals",
          enabled: true,
          addons: [{ id: "addon-extra-rice", name: "Extra Rice", price: 30 }],
        },
        {
          id: "drink-iced-tea",
          name: "Iced Tea",
          description: "Fresh brewed black tea with lemon.",
          price: 59,
          image:
            "https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=80",
          category: "Drinks",
          enabled: true,
          addons: [{ id: "addon-large-size", name: "Large Size", price: 20 }],
        },
        {
          id: "snack-fries",
          name: "Crispy Fries",
          description: "Golden potato fries with sea salt.",
          price: 89,
          image:
            "https://images.unsplash.com/photo-1585109649139-366815a0d713?auto=format&fit=crop&w=900&q=80",
          category: "Snacks",
          enabled: true,
          addons: [{ id: "addon-cheese-dip", name: "Cheese Dip", price: 25 }],
        },
        {
          id: "dessert-brownie",
          name: "Fudge Brownie",
          description: "Chocolate brownie with dark ganache.",
          price: 95,
          image:
            "https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=900&q=80",
          category: "Desserts",
          enabled: true,
          addons: [],
        },
      ],
    };
    await fs.writeFile(MENU_FILE, JSON.stringify(seed, null, 2), "utf8");
  }

  try {
    await fs.access(ORDERS_FILE);
  } catch {
    await fs.writeFile(ORDERS_FILE, JSON.stringify([], null, 2), "utf8");
  }
}

async function ensureInitialized() {
  if (!ensureFilesPromise) ensureFilesPromise = ensureFiles();
  return ensureFilesPromise;
}

async function readJson(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const addonSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  price: z.number().nonnegative(),
});

const menuItemSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().min(2).max(300),
  price: z.number().positive(),
  image: z.string().url(),
  category: z.string().min(2).max(40),
  enabled: z.boolean().optional(),
  addons: z.array(addonSchema).optional(),
});

const cartItemSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(1).max(30),
  selectedAddons: z.array(z.string()).optional(),
});

const placeOrderSchema = z.object({
  customerName: z.string().min(2).max(100),
  contactNumber: z.string().min(7).max(25),
  address: z.string().min(3).max(200),
  fulfillmentType: z.enum(["delivery", "pickup"]),
  notes: z.string().max(300).optional(),
  items: z.array(cartItemSchema).min(1),
});

function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (adminTokens.get(token) < Date.now()) {
    adminTokens.delete(token);
    return res.status(401).json({ error: "Session expired" });
  }
  return next();
}

function buildOrderMessage(order) {
  const itemLines = order.items
    .map((item) => {
      const addonsText = item.addons.length
        ? ` (+ ${item.addons.map((a) => a.name).join(", ")})`
        : "";
      return `${item.quantity}x ${item.name}${addonsText}`;
    })
    .join("\n");

  return [
    `Customer Name: ${order.customerName}`,
    `Phone: ${order.contactNumber}`,
    `Fulfillment: ${order.fulfillmentType}`,
    `Address: ${order.address}`,
    "Order:",
    itemLines,
    `Total: ₱${order.total.toFixed(2)}`,
    `Notes: ${order.notes || "N/A"}`,
    `Order ID: ${order.id}`,
    `Date: ${order.createdAt}`,
  ].join("\n");
}

function resolveMessengerPageTarget() {
  if (!PAGE_URL) return PAGE_USERNAME;

  try {
    const parsed = new URL(PAGE_URL);
    const id = parsed.searchParams.get("id");
    if (id) return id;

    const slug = parsed.pathname.replace(/^\/+/, "").trim();
    if (!slug || slug === "profile.php") return PAGE_USERNAME;
    return slug;
  } catch {
    return PAGE_URL.replace(/^https?:\/\/(www\.)?facebook\.com\//i, "").trim() || PAGE_USERNAME;
  }
}

function buildMessengerDeepLink(message) {
  const target = resolveMessengerPageTarget();
  return `https://m.me/${encodeURIComponent(target)}?text=${encodeURIComponent(message)}`;
}

async function tryDirectMessengerSend(message) {
  if (MESSENGER_MODE !== "api" || !MESSENGER_PAGE_ACCESS_TOKEN || !MESSENGER_RECIPIENT_ID) {
    return { sent: false, reason: "Direct API mode not configured." };
  }

  const response = await fetch(
    `https://graph.facebook.com/v19.0/me/messages?access_token=${encodeURIComponent(
      MESSENGER_PAGE_ACCESS_TOKEN,
    )}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_type: "RESPONSE",
        recipient: { id: MESSENGER_RECIPIENT_ID },
        message: { text: message },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    return { sent: false, reason: text };
  }

  return { sent: true };
}

async function logOrder(order, message, directSend) {
  if (supabaseAdmin) {
    const { error } = await supabaseAdmin.from("orders").insert({
      order_id: order.id,
      customer_name: order.customerName,
      contact_number: order.contactNumber,
      address: order.address,
      fulfillment_type: order.fulfillmentType,
      notes: order.notes,
      items: order.items,
      total: order.total,
      message_text: message,
      messenger_sent: Boolean(directSend?.sent),
      messenger_reason: directSend?.reason || null,
      created_at: order.createdAt,
    });

    if (!error) return { storage: "supabase" };
    console.error("Supabase logging failed, using file backup:", error.message);
  }

  const allOrders = await readJson(ORDERS_FILE, []);
  allOrders.unshift(order);
  await writeJson(ORDERS_FILE, allOrders);
  return { storage: "file" };
}

app.get("/api/health", (_, res) => {
  res.json({ status: "ok", time: nowIso() });
});

app.get("/api/categories", async (_, res) => {
  const data = await readJson(MENU_FILE, { categories: [], items: [] });
  res.json(data.categories);
});

app.get("/api/menu", async (req, res) => {
  const data = await readJson(MENU_FILE, { categories: [], items: [] });
  const queryCategory = sanitizeText(req.query.category || "");
  const querySearch = sanitizeText(req.query.q || "").toLowerCase();

  const filtered = data.items.filter((item) => {
    if (!item.enabled) return false;
    if (queryCategory && queryCategory !== "All" && item.category !== queryCategory) return false;
    if (!querySearch) return true;
    const haystack = `${item.name} ${item.description} ${item.category}`.toLowerCase();
    return haystack.includes(querySearch);
  });

  res.json({ categories: data.categories, items: filtered });
});

app.post("/api/admin/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid login payload" });

  const username = sanitizeText(parsed.data.username);
  const password = sanitizeText(parsed.data.password);
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = randomUUID();
  adminTokens.set(token, Date.now() + 1000 * 60 * 60 * 8);
  return res.json({ token });
});

app.get("/api/admin/menu", authRequired, async (_, res) => {
  const data = await readJson(MENU_FILE, { categories: [], items: [] });
  res.json(data);
});

app.post("/api/admin/items", authRequired, async (req, res) => {
  const parsed = menuItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid item payload" });

  const data = await readJson(MENU_FILE, { categories: [], items: [] });
  const payload = parsed.data;
  const category = sanitizeText(payload.category);

  if (!data.categories.includes(category)) data.categories.push(category);

  const newItem = {
    id: randomUUID(),
    name: sanitizeText(payload.name),
    description: sanitizeText(payload.description),
    price: Number(payload.price),
    image: sanitizeText(payload.image),
    category,
    enabled: payload.enabled ?? true,
    addons: (payload.addons || []).map((addon) => ({
      id: addon.id || randomUUID(),
      name: sanitizeText(addon.name),
      price: Number(addon.price),
    })),
  };

  data.items.unshift(newItem);
  await writeJson(MENU_FILE, data);
  return res.status(201).json(newItem);
});

app.put("/api/admin/items/:id", authRequired, async (req, res) => {
  const itemId = sanitizeText(req.params.id);
  const data = await readJson(MENU_FILE, { categories: [], items: [] });
  const index = data.items.findIndex((item) => item.id === itemId);
  if (index === -1) return res.status(404).json({ error: "Item not found" });

  const merged = { ...data.items[index], ...req.body };
  const parsed = menuItemSchema.safeParse(merged);
  if (!parsed.success) return res.status(400).json({ error: "Invalid update payload" });

  data.items[index] = {
    ...data.items[index],
    ...parsed.data,
    name: sanitizeText(parsed.data.name),
    description: sanitizeText(parsed.data.description),
    category: sanitizeText(parsed.data.category),
    image: sanitizeText(parsed.data.image),
    addons: (parsed.data.addons || []).map((addon) => ({
      id: addon.id || randomUUID(),
      name: sanitizeText(addon.name),
      price: Number(addon.price),
    })),
  };

  await writeJson(MENU_FILE, data);
  return res.json(data.items[index]);
});

app.post("/api/orders/place", baseOrderLimiter, async (req, res) => {
  const parsed = placeOrderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order payload" });

  const menuData = await readJson(MENU_FILE, { categories: [], items: [] });
  const enabledItems = new Map(menuData.items.filter((item) => item.enabled).map((item) => [item.id, item]));

  const normalizedItems = [];
  let total = 0;

  for (const cartItem of parsed.data.items) {
    const menuItem = enabledItems.get(cartItem.itemId);
    if (!menuItem) return res.status(400).json({ error: `Item unavailable: ${cartItem.itemId}` });

    const selectedAddons = (cartItem.selectedAddons || [])
      .map((id) => menuItem.addons.find((addon) => addon.id === id))
      .filter(Boolean);

    const addonTotal = selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
    const lineTotal = (menuItem.price + addonTotal) * cartItem.quantity;
    total += lineTotal;

    normalizedItems.push({
      itemId: menuItem.id,
      name: menuItem.name,
      quantity: cartItem.quantity,
      unitPrice: menuItem.price,
      addons: selectedAddons,
      lineTotal,
    });
  }

  const order = {
    id: `ord_${Date.now()}`,
    customerName: sanitizeText(parsed.data.customerName),
    contactNumber: sanitizeText(parsed.data.contactNumber),
    address: sanitizeText(parsed.data.address),
    fulfillmentType: parsed.data.fulfillmentType,
    notes: sanitizeText(parsed.data.notes || ""),
    items: normalizedItems,
    total,
    createdAt: nowIso(),
  };

  const message = buildOrderMessage(order);
  const fallbackMessengerUrl = buildMessengerDeepLink(message);
  const directSend = await tryDirectMessengerSend(message);
  const logging = await logOrder(order, message, directSend);

  return res.json({
    success: true,
    orderId: order.id,
    message,
    messengerUrl: fallbackMessengerUrl,
    directSend,
    logging,
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

export { app, ensureInitialized };
