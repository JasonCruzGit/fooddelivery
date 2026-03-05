import dotenv from "dotenv";
import { app, ensureInitialized } from "./app.js";

dotenv.config();

const PORT = Number(process.env.PORT || 4000);

ensureInitialized()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize server files:", error);
    process.exit(1);
  });
