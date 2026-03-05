import { app, ensureInitialized } from "../server/app.js";

ensureInitialized().catch((error) => {
  console.error("Initialization error:", error);
});

export default app;
