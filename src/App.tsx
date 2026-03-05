import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type Addon = { id: string; name: string; price: number };
type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  enabled: boolean;
  addons: Addon[];
};
type CartItem = {
  key: string;
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  selectedAddons: Addon[];
  image: string;
};
type CheckoutForm = {
  customerName: string;
  contactNumber: string;
  address: string;
  fulfillmentType: "delivery" | "pickup";
  deliveryDistanceKm: string;
  notes: string;
};

const money = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 2,
});

const initialForm: CheckoutForm = {
  customerName: "",
  contactNumber: "",
  address: "",
  fulfillmentType: "delivery",
  deliveryDistanceKm: "3",
  notes: "",
};

function App() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>(["All"]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutForm, setCheckoutForm] = useState(initialForm);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [successPopupMessage, setSuccessPopupMessage] = useState("");
  const [pendingRedirectUrl, setPendingRedirectUrl] = useState("");
  const [redirectCountdown, setRedirectCountdown] = useState(0);

  const [activeItem, setActiveItem] = useState<MenuItem | null>(null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);

  const [adminMode, setAdminMode] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [adminLogin, setAdminLogin] = useState({ username: "", password: "" });
  const [newItem, setNewItem] = useState({
    name: "",
    description: "",
    price: "",
    image: "",
    category: "",
  });

  const fetchMenu = async () => {
    const params = new URLSearchParams();
    if (activeCategory !== "All") params.set("category", activeCategory);
    if (search.trim()) params.set("q", search.trim());

    const response = await fetch(`/api/menu?${params.toString()}`);
    if (!response.ok) throw new Error("Failed to load menu.");
    const data = await response.json();
    setCategories(["All", ...data.categories]);
    setMenu(data.items);
  };

  useEffect(() => {
    fetchMenu().catch((err: Error) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, search]);

  useEffect(() => {
    if (!pendingRedirectUrl || redirectCountdown <= 0) return;

    const timer = window.setInterval(() => {
      setRedirectCountdown((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          window.location.href = pendingRedirectUrl;
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [pendingRedirectUrl, redirectCountdown]);

  const cartTotal = useMemo(
    () =>
      cart.reduce((sum, item) => {
        const addonTotal = item.selectedAddons.reduce((addonSum, addon) => addonSum + addon.price, 0);
        return sum + (item.unitPrice + addonTotal) * item.quantity;
      }, 0),
    [cart],
  );

  const deliveryFeeEstimate = useMemo(() => {
    if (checkoutForm.fulfillmentType !== "delivery") return 0;
    const distance = Number(checkoutForm.deliveryDistanceKm);
    if (!Number.isFinite(distance) || distance <= 0) return 60;
    if (distance <= 3) return 60;
    const extraKm = Math.ceil(distance - 3);
    return 60 + extraKm * 5;
  }, [checkoutForm.deliveryDistanceKm, checkoutForm.fulfillmentType]);

  const estimatedGrandTotal = useMemo(
    () => cartTotal + deliveryFeeEstimate,
    [cartTotal, deliveryFeeEstimate],
  );

  const addToCart = (item: MenuItem, addonIds: string[]) => {
    const selectedAddons = item.addons.filter((addon) => addonIds.includes(addon.id));
    const key = `${item.id}-${selectedAddons.map((addon) => addon.id).sort().join(",")}`;

    setCart((current) => {
      const existing = current.find((entry) => entry.key === key);
      if (existing) {
        return current.map((entry) =>
          entry.key === key ? { ...entry, quantity: entry.quantity + 1 } : entry,
        );
      }

      return [
        ...current,
        {
          key,
          itemId: item.id,
          name: item.name,
          unitPrice: item.price,
          quantity: 1,
          image: item.image,
          selectedAddons,
        },
      ];
    });
    setStatusMessage(`${item.name} added to cart.`);
  };

  const updateQuantity = (key: string, nextQty: number) => {
    setCart((current) =>
      current
        .map((entry) => (entry.key === key ? { ...entry, quantity: Math.max(0, nextQty) } : entry))
        .filter((entry) => entry.quantity > 0),
    );
  };

  const handlePlaceOrder = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setStatusMessage("");
    setSuccessPopupMessage("");
    setPendingRedirectUrl("");
    setRedirectCountdown(0);

    if (!cart.length) {
      setError("Your cart is empty.");
      return;
    }

    setIsSubmittingOrder(true);
    try {
      const response = await fetch("/api/orders/place", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...checkoutForm,
          items: cart.map((item) => ({
            itemId: item.itemId,
            quantity: item.quantity,
            selectedAddons: item.selectedAddons.map((addon) => addon.id),
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Order placement failed.");

      const sentDirectly = Boolean(data.directSend?.sent);
      if (sentDirectly) {
        const successText = `Order ${data.orderId} sent successfully to the restaurant Messenger inbox.`;
        setStatusMessage(successText);
        setSuccessPopupMessage(successText);
      } else {
        const reason = data.directSend?.reason ? ` (${data.directSend.reason})` : "";
        const successText = `Order ${data.orderId} created. Redirecting to Messenger fallback${reason}...`;
        setStatusMessage(successText);
        setSuccessPopupMessage(successText);
        setPendingRedirectUrl(data.messengerUrl);
        setRedirectCountdown(3);
      }
      setCart([]);
      setCheckoutForm(initialForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to place order.");
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const handleAdminLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adminLogin),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Admin login failed.");
      return;
    }
    setAdminToken(data.token);
    setStatusMessage("Admin authenticated.");
  };

  const handleAddMenuItem = async (event: FormEvent) => {
    event.preventDefault();
    if (!adminToken) return;

    const response = await fetch("/api/admin/items", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        ...newItem,
        price: Number(newItem.price),
        enabled: true,
        addons: [],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Failed to add menu item.");
      return;
    }

    setStatusMessage(`Added menu item: ${data.name}`);
    setNewItem({ name: "", description: "", price: "", image: "", category: "" });
    fetchMenu().catch(() => null);
  };

  const handleToggleItem = async (item: MenuItem) => {
    if (!adminToken) return;
    const response = await fetch(`/api/admin/items/${item.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ enabled: !item.enabled }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Failed to update item.");
      return;
    }
    setStatusMessage(`${data.name} is now ${data.enabled ? "enabled" : "disabled"}.`);
    fetchMenu().catch(() => null);
  };

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="tag">Fast Delivery</p>
          <h1>Urban Bites</h1>
          <p className="subtitle">Order your favorites and send final checkout directly to Messenger.</p>
        </div>
        <button className="secondary-btn" onClick={() => setAdminMode((value) => !value)}>
          {adminMode ? "Close Admin" : "Admin Panel"}
        </button>
      </header>

      <section className="controls">
        <input
          className="search"
          placeholder="Search meals, drinks, snacks..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="chips">
          {categories.map((category) => (
            <button
              key={category}
              className={activeCategory === category ? "chip active" : "chip"}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}
      {statusMessage ? <p className="ok">{statusMessage}</p> : null}

      <main className="layout">
        <section className="menu-grid">
          {menu.map((item) => (
            <article key={item.id} className="card">
              <img src={item.image} alt={item.name} />
              <div className="card-body">
                <h3>{item.name}</h3>
                <p>{item.description}</p>
                <div className="meta-row">
                  <span>{money.format(item.price)}</span>
                  <span>{item.category}</span>
                </div>
                {!!item.addons.length && (
                  <p className="addons-line">Add-ons: {item.addons.map((addon) => addon.name).join(", ")}</p>
                )}
                <div className="card-actions">
                  <button
                    className="secondary-btn"
                    onClick={() => {
                      setActiveItem(item);
                      setSelectedAddonIds([]);
                    }}
                  >
                    View Details
                  </button>
                  <button className="primary-btn" onClick={() => addToCart(item, [])}>
                    Add
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>

        <aside className="panel">
          <h2>Cart Summary</h2>
          {!cart.length && <p className="muted">No items yet.</p>}
          {cart.map((entry) => {
            const addonTotal = entry.selectedAddons.reduce((sum, addon) => sum + addon.price, 0);
            return (
              <div key={entry.key} className="cart-item">
                <div>
                  <h4>{entry.name}</h4>
                  {entry.selectedAddons.length > 0 && (
                    <p className="muted">
                      + {entry.selectedAddons.map((addon) => addon.name).join(", ")}
                    </p>
                  )}
                  <p className="muted">
                    {money.format(entry.unitPrice + addonTotal)} each
                  </p>
                </div>
                <div className="qty">
                  <button onClick={() => updateQuantity(entry.key, entry.quantity - 1)}>-</button>
                  <span>{entry.quantity}</span>
                  <button onClick={() => updateQuantity(entry.key, entry.quantity + 1)}>+</button>
                </div>
              </div>
            );
          })}

          <div className="summary-row">
            <span>Subtotal</span>
            <span>{money.format(cartTotal)}</span>
          </div>
          <div className="summary-row">
            <span>Estimated Delivery Fee</span>
            <span>{money.format(deliveryFeeEstimate)}</span>
          </div>
          <p className="total">Estimated Grand Total: {money.format(estimatedGrandTotal)}</p>

          <form className="checkout" onSubmit={handlePlaceOrder}>
            <h3>Checkout</h3>
            <input
              placeholder="Customer Name"
              value={checkoutForm.customerName}
              onChange={(event) => setCheckoutForm((form) => ({ ...form, customerName: event.target.value }))}
              required
            />
            <input
              placeholder="Contact Number"
              value={checkoutForm.contactNumber}
              onChange={(event) => setCheckoutForm((form) => ({ ...form, contactNumber: event.target.value }))}
              required
            />
            <input
              placeholder="Delivery Address or Pickup Note"
              value={checkoutForm.address}
              onChange={(event) => setCheckoutForm((form) => ({ ...form, address: event.target.value }))}
              required
            />
            <select
              value={checkoutForm.fulfillmentType}
              onChange={(event) =>
                setCheckoutForm((form) => ({
                  ...form,
                  fulfillmentType: event.target.value as "delivery" | "pickup",
                }))
              }
            >
              <option value="delivery">Delivery</option>
              <option value="pickup">Pickup</option>
            </select>
            {checkoutForm.fulfillmentType === "delivery" && (
              <input
                type="number"
                min={0}
                step="0.1"
                placeholder="Estimated distance (km)"
                value={checkoutForm.deliveryDistanceKm}
                onChange={(event) =>
                  setCheckoutForm((form) => ({ ...form, deliveryDistanceKm: event.target.value }))
                }
                required
              />
            )}
            <textarea
              placeholder="Order Notes (optional)"
              value={checkoutForm.notes}
              onChange={(event) => setCheckoutForm((form) => ({ ...form, notes: event.target.value }))}
            />
            <button type="submit" className="primary-btn" disabled={isSubmittingOrder}>
              {isSubmittingOrder ? "Placing Order..." : "Place Order to Messenger"}
            </button>
          </form>
        </aside>
      </main>

      {adminMode && (
        <section className="admin">
          <h2>Restaurant Admin Panel</h2>
          {!adminToken ? (
            <form className="admin-form" onSubmit={handleAdminLogin}>
              <input
                placeholder="Admin Username"
                value={adminLogin.username}
                onChange={(event) => setAdminLogin((prev) => ({ ...prev, username: event.target.value }))}
                required
              />
              <input
                type="password"
                placeholder="Admin Password"
                value={adminLogin.password}
                onChange={(event) => setAdminLogin((prev) => ({ ...prev, password: event.target.value }))}
                required
              />
              <button className="primary-btn" type="submit">
                Login
              </button>
            </form>
          ) : (
            <>
              <form className="admin-form" onSubmit={handleAddMenuItem}>
                <h3>Add Menu Item</h3>
                <input
                  placeholder="Item name"
                  value={newItem.name}
                  onChange={(event) => setNewItem((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
                <input
                  placeholder="Description"
                  value={newItem.description}
                  onChange={(event) => setNewItem((prev) => ({ ...prev, description: event.target.value }))}
                  required
                />
                <input
                  type="number"
                  min={1}
                  step="0.01"
                  placeholder="Price"
                  value={newItem.price}
                  onChange={(event) => setNewItem((prev) => ({ ...prev, price: event.target.value }))}
                  required
                />
                <input
                  placeholder="Image URL"
                  value={newItem.image}
                  onChange={(event) => setNewItem((prev) => ({ ...prev, image: event.target.value }))}
                  required
                />
                <input
                  placeholder="Category"
                  value={newItem.category}
                  onChange={(event) => setNewItem((prev) => ({ ...prev, category: event.target.value }))}
                  required
                />
                <button className="primary-btn" type="submit">
                  Save Item
                </button>
              </form>
              <div className="admin-list">
                {menu.map((item) => (
                  <div key={`admin-${item.id}`} className="admin-item">
                    <span>
                      {item.name} - {money.format(item.price)}
                    </span>
                    <button className="secondary-btn" onClick={() => handleToggleItem(item)}>
                      {item.enabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {activeItem && (
        <div className="modal-backdrop" onClick={() => setActiveItem(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <img src={activeItem.image} alt={activeItem.name} />
            <h3>{activeItem.name}</h3>
            <p>{activeItem.description}</p>
            <p className="total">Base price: {money.format(activeItem.price)}</p>
            {!!activeItem.addons.length && (
              <div className="addon-list">
                {activeItem.addons.map((addon) => (
                  <label key={addon.id} className="addon-option">
                    <input
                      type="checkbox"
                      checked={selectedAddonIds.includes(addon.id)}
                      onChange={(event) =>
                        setSelectedAddonIds((current) =>
                          event.target.checked
                            ? [...current, addon.id]
                            : current.filter((value) => value !== addon.id),
                        )
                      }
                    />
                    {addon.name} (+{money.format(addon.price)})
                  </label>
                ))}
              </div>
            )}
            <div className="card-actions">
              <button className="secondary-btn" onClick={() => setActiveItem(null)}>
                Cancel
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  addToCart(activeItem, selectedAddonIds);
                  setActiveItem(null);
                }}
              >
                Add to Cart
              </button>
            </div>
          </div>
        </div>
      )}

      {successPopupMessage && (
        <div
          className="success-backdrop"
          onClick={() => {
            setSuccessPopupMessage("");
            setPendingRedirectUrl("");
            setRedirectCountdown(0);
          }}
        >
          <div className="success-popup" onClick={(event) => event.stopPropagation()}>
            <div className="success-icon" aria-hidden="true">
              ✓
            </div>
            <h3>Order placed successfully!</h3>
            <p>{successPopupMessage}</p>
            {pendingRedirectUrl && redirectCountdown > 0 && (
              <p className="countdown">Redirecting to Messenger in {redirectCountdown}s...</p>
            )}
            <button
              className="primary-btn"
              onClick={() => {
                setSuccessPopupMessage("");
                setPendingRedirectUrl("");
                setRedirectCountdown(0);
              }}
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
