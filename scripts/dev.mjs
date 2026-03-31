import { spawn } from "node:child_process";

const commands = [
  ["npm", ["run", "dev:server"]],
  ["npm", ["run", "dev:client"]],
];

console.log("Starting dev servers...");
console.log("Open http://localhost:5173 for the React app.");
console.log("The API server runs on http://localhost:8787.");

const children = commands.map(([command, args]) =>
  spawn(command, args, {
    stdio: "inherit",
    shell: true,
  }),
);

function shutdown() {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
}

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown();
      process.exit(code);
    }
  });
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});
