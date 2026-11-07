import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import os from "node:os";
// Restricted preview containers may hide network interfaces. Vite only needs
// this list for its startup URL banner; binding and host checks remain intact.
try {
  os.networkInterfaces();
} catch {
  os.networkInterfaces = () => ({});
}
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
});
