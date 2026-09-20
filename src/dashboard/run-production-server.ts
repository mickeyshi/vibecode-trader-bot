import { createDashboardServer, loadDashboardServerConfig } from "./production-server.js";

const config = loadDashboardServerConfig();
const server = createDashboardServer(config);

server.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      service: "dashboard",
      status: "listening",
      host: config.host,
      port: config.port,
      remoteAccess: false
    })
  );
});

function shutdown(): void {
  server.close((error) => {
    if (error) {
      console.error("Dashboard server shutdown failed.");
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
