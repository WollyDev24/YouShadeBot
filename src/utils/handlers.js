import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function loadCommands(client) {
  const dir = path.join(__dirname, "..", "commands");
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const mod = await import(path.join(dir, file));
    const cmd = mod.default;
    if (!cmd?.data) continue;
    client.commands.set(cmd.data.name, cmd);
    console.log(`[commands] loaded /${cmd.data.name}`);
  }
}

export async function loadEvents(client) {
  const dir = path.join(__dirname, "..", "events");
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const mod = await import(path.join(dir, file));
    const evt = mod.default;
    if (evt?.name) {
      if (evt.once) {
        client.once(evt.name, (...args) => evt.execute(client, ...args));
      } else {
        client.on(evt.name, (...args) => evt.execute(client, ...args));
      }
      console.log(`[events] loaded ${evt.name}`);
    }
  }
}
